import { homedir } from "node:os";
import type { ResultAsync } from "neverthrow";
import { join } from "node:path";
import type { Config } from "../contract/config";
import { createEventHub, wireHerdrToHub, type WiredHerdr } from "./events/broadcast";
import { createEventsWss } from "./events/ws";
import { createPollerRegistry, type ChangedInfo } from "./git/poller";
import { invalidateAll, resolveWorktree } from "./git/resolve";
import { createFocusTracker } from "./herdr/focus";
import { createFakeHerdr } from "./herdr/fake";
import type { HerdrGateway } from "./herdr/gateway";
import { createHerdrSocketClient } from "./herdr/socket-client";
import { createHerdrState } from "./herdr/state";
import type { WorktreeResolver } from "./herdr/tree";

export type RuntimeDeps = {
  config: Config;
  /** テスト用。省略時は実ソケットに接続する。 */
  gateway?: HerdrGateway;
  resolver?: WorktreeResolver;
  logger?: Pick<typeof console, "error" | "warn" | "info">;
};

export function herdrSocketPath(config: Config): string {
  return (
    config.herdrSocketPath ??
    process.env.HERDR_SOCKET_PATH ??
    join(homedir(), ".config", "herdr", "herdr.sock")
  );
}

/** git/resolve.ts を herdr 層の WorktreeResolver ポートに合わせる。 */
export const gitWorktreeResolver: WorktreeResolver = {
  resolve: (path) => resolveWorktree(path),
};

/**
 * herdr 接続 → 状態 → フォーカス追従 → イベント配信 → フォーカス中 worktree のポーリング、
 * までを 1 か所で組み立てる。main.ts はこれを http サーバーに結線するだけにする。
 */
export function createRuntime(deps: RuntimeDeps) {
  const { config, logger = console } = deps;
  const gateway =
    deps.gateway ?? createHerdrSocketClient({ socketPath: herdrSocketPath(config), logger });
  const resolver = deps.resolver ?? gitWorktreeResolver;
  const state = createHerdrState(gateway, logger);
  const focus = createFocusTracker({
    state,
    gateway,
    resolver,
    pollMs: config.focusPollMs,
    logger,
  });
  const hub = createEventHub();
  const wired: WiredHerdr = wireHerdrToHub({ state, gateway, focus, resolver, hub, logger });

  const repoChangedListeners = new Set<(info: ChangedInfo) => void>();
  // F6: a poller failure classified "missing" (ENOENT / "not a git repository")
  // means the worktree root itself is gone — distinct from every other poller
  // error, which is just logged.
  const worktreeMissingListeners = new Set<(root: string) => void>();
  const pollers = createPollerRegistry({
    intervalMs: config.pollIntervalMs,
    onChanged(info) {
      hub.broadcast({
        type: "repo-changed",
        worktreeRoot: info.root,
        reason: info.reason,
        head: info.head,
      });
      if (info.reason !== "status") {
        // branch / HEAD が変わったので cwd → worktree の解決結果を捨てて tree とフォーカスを再計算する
        invalidateAll();
        focus.refresh();
        wired.refreshTree();
      }
      for (const cb of repoChangedListeners) {
        try {
          cb(info);
        } catch (err) {
          logger.error("repo-changed listener threw", err);
        }
      }
    },
    onStatus({ root, error, kind }) {
      if (error) logger.warn(`poller ${root}: ${error}`);
      if (kind === "missing") {
        for (const cb of worktreeMissingListeners) {
          try {
            cb(root);
          } catch (err) {
            logger.error("worktree-missing listener threw", err);
          }
        }
      }
    },
  });

  // フォーカス中（またはピン留め中）の worktree だけをポーリングする（plan F3-4）
  let watchedRoot: string | null = null;
  const unsubscribeFocus = focus.onChange((payload) => {
    const next = payload.worktreeRoot;
    if (next === watchedRoot) return;
    if (watchedRoot) pollers.unwatch(watchedRoot);
    if (next) pollers.watch(next);
    watchedRoot = next;
  });

  const eventsWss = createEventsWss({
    hub,
    onClientMessage: (m) => wired.handleClientMessage(m),
    logger,
  });

  // F6: herdr itself can report a worktree's removal (e.g. `EnterWorktree`/agent-driven
  // cleanup) before the next poll tick would notice — forward it the same way as a
  // poller "missing" classification.
  const unsubscribeWorktreeRemoved = gateway.subscribe((event) => {
    if (event.data.type !== "worktree_removed") return;
    const path = event.data.worktree.path;
    for (const cb of worktreeMissingListeners) {
      try {
        cb(path);
      } catch (err) {
        logger.error("worktree-missing listener threw", err);
      }
    }
  });

  return {
    gateway,
    state,
    focus,
    hub,
    wired,
    pollers,
    eventsWss,
    resolver,
    onRepoChanged(cb: (info: ChangedInfo) => void): () => void {
      repoChangedListeners.add(cb);
      return () => repoChangedListeners.delete(cb);
    },
    /** F6: fires with a worktree root that just disappeared (poller ENOENT, or herdr's `worktree_removed`). */
    onWorktreeMissing(cb: (root: string) => void): () => void {
      worktreeMissingListeners.add(cb);
      return () => worktreeMissingListeners.delete(cb);
    },
    herdrStatus: () => gateway.status(),
    stop() {
      unsubscribeFocus();
      unsubscribeWorktreeRemoved();
      pollers.stopAll();
      wired.stop();
      focus.stop();
      gateway.close();
    },
  };
}

export type Runtime = ReturnType<typeof createRuntime>;

/** テストや herdr 無し起動のためのフェイク付きランタイム。 */
export function createRuntimeWithFakeHerdr(
  config: Config,
  snapshot: Parameters<typeof createFakeHerdr>[0],
) {
  const gateway = createFakeHerdr(snapshot);
  return { runtime: createRuntime({ config, gateway }), fake: gateway };
}

/**
 * repo-changed → 再アンカー。root ごとに直前の HEAD を覚え、変化のたびに
 * reanchorAfterChange を回す（status 変化でも「行が消えた」検出のために回す）。
 *
 * F2/F3: `prevHead` は root ごとに実際に観測した直前の HEAD だけを渡す — 未観測
 * （起動直後にこの root で最初に受け取った repo-changed）なら `null` を渡し、
 * reanchorAfterChange 側で rebase 検出をスキップさせる。以前のように「未観測なら
 * head 自身を prevHead として渡す」実装だと、常に `prevHead === head` になって
 * commit-bound レビューの祖先チェックが常に「一致」扱いになり、他 worktree の
 * squash/rebase をこの worktree のものと誤認するクロス worktree ハイジャックの
 * 温床になっていた。
 */
export function attachReviewToRuntime(
  runtime: Pick<Runtime, "onRepoChanged" | "resolver">,
  review: {
    reanchorAfterChange: (input: {
      repo: string;
      worktreeRoot: string;
      prevHead: string | null;
      head: string;
    }) => ResultAsync<unknown, never>;
  },
  logger: Pick<typeof console, "error"> = console,
): () => void {
  const lastHead = new Map<string, string>();
  return runtime.onRepoChanged((info) => {
    void (async () => {
      const head = info.head;
      if (!head) return; // unborn branch: 何も記録しない
      const prevHead = lastHead.get(info.root) ?? null;
      lastHead.set(info.root, head);
      const wt = await runtime.resolver.resolve(info.root).catch(() => null);
      if (!wt) return;
      await review.reanchorAfterChange({
        repo: wt.commonDir,
        worktreeRoot: info.root,
        prevHead,
        head,
      });
    })().catch((err) => logger.error("reanchor after repo-changed failed", err));
  });
}

/**
 * F6: worktree が消えた（poller の ENOENT / herdr の `worktree_removed`）ことを
 * outdateWorktree に橋渡しする。
 */
export function attachWorktreeMissingToReview(
  runtime: Pick<Runtime, "onWorktreeMissing">,
  review: {
    outdateWorktree: (input: { worktreeRoot: string }) => ResultAsync<unknown, never>;
  },
  logger: Pick<typeof console, "error"> = console,
): () => void {
  return runtime.onWorktreeMissing((root) => {
    void (async () => {
      await review.outdateWorktree({ worktreeRoot: root });
    })().catch((err) => logger.error("outdate worktree after removal failed", err));
  });
}
