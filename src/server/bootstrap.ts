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
    onStatus({ root, error }) {
      if (error) logger.warn(`poller ${root}: ${error}`);
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
    herdrStatus: () => gateway.status(),
    stop() {
      unsubscribeFocus();
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
 */
export function attachReviewToRuntime(
  runtime: Pick<Runtime, "onRepoChanged" | "resolver">,
  review: {
    reanchorAfterChange: (input: {
      repo: string;
      worktreeRoot: string;
      prevHead: string;
      head: string;
    }) => ResultAsync<unknown, never>;
  },
  logger: Pick<typeof console, "error"> = console,
): () => void {
  const lastHead = new Map<string, string>();
  return runtime.onRepoChanged((info) => {
    void (async () => {
      const head = info.head;
      if (!head) return;
      const prevHead = lastHead.get(info.root) ?? head;
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
