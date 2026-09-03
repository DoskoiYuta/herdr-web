import { execFile } from "node:child_process";
import { mkdtemp, realpath as realpathAsync, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "bun:test";
import { okAsync, type ResultAsync } from "neverthrow";
import * as v from "valibot";
import { ConfigSchema } from "../contract/config";
import type { Anchor } from "../contract/review";
import { resolveWorktree } from "./git/resolve";
import type { ChangedInfo } from "./git/poller";
import {
  attachReviewToRuntime,
  attachWorktreeMissingToReview,
  createRuntimeWithFakeHerdr,
} from "./bootstrap";
import type { Runtime } from "./bootstrap";
import { openDb } from "./db/client";
import { applyMigrations } from "./db/migrate";
import { createReviewRuntime } from "./review/runtime";
import type { WorktreeResolver } from "./herdr/tree";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
  return stdout.trim();
}

function fakeResolver(map: Record<string, string>): WorktreeResolver {
  return {
    async resolve(path) {
      const commonDir = map[path];
      return commonDir ? { root: path, commonDir, branch: "main", isMain: true } : null;
    },
  };
}

function fakeOnRepoChanged(): {
  onRepoChanged: Pick<Runtime, "onRepoChanged">["onRepoChanged"];
  fire: (info: ChangedInfo) => void;
} {
  const listeners = new Set<(info: ChangedInfo) => void>();
  return {
    onRepoChanged: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    fire: (info) => {
      for (const cb of listeners) cb(info);
    },
  };
}

/** A no-op onRootWatched — most attachReviewToRuntime tests don't exercise this path. */
function noopOnRootWatched(): Pick<Runtime, "onRootWatched">["onRootWatched"] {
  return () => () => {};
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/**
 * Some paths under test do genuine async I/O (fs.realpath resolves on the
 * libuv threadpool, not just the microtask queue) — a plain `flush()` (pure
 * `Promise.resolve()` loop) can settle before that I/O completes. Poll with
 * real timers instead of guessing a tick count.
 */
async function waitUntil(check: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error("waitUntil: timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("attachReviewToRuntime", () => {
  // F2/F3: the first repo-changed observed for a root must pass prevHead: null
  // (unknown), never `head` itself — otherwise reanchorAfterChange's rebase-detection
  // would see prevHead === head and misread every commit as "always reachable from
  // this worktree", which is exactly the cross-worktree hijack F2 fixes.
  test("passes prevHead: null on the first repo-changed for a root, then the real previous head", async () => {
    const { onRepoChanged, fire } = fakeOnRepoChanged();
    const calls: { prevHead: string | null; head: string }[] = [];
    const resolver = fakeResolver({ "/repo": "/repo/.git" });

    attachReviewToRuntime(
      { onRepoChanged, onRootWatched: noopOnRootWatched(), resolver },
      {
        reanchorAfterChange: (input) => {
          calls.push({ prevHead: input.prevHead, head: input.head });
          return okAsync([]) as ResultAsync<unknown, never>;
        },
        gitHistory: { headOf: async () => null },
      },
    );

    fire({ root: "/repo", reason: "head", head: "h1" });
    await flush();
    fire({ root: "/repo", reason: "head", head: "h2" });
    await flush();

    expect(calls).toEqual([
      { prevHead: null, head: "h1" },
      { prevHead: "h1", head: "h2" },
    ]);
  });

  test("an unborn branch (head: null) records nothing and is skipped", async () => {
    const { onRepoChanged, fire } = fakeOnRepoChanged();
    const calls: { prevHead: string | null; head: string }[] = [];
    const resolver = fakeResolver({ "/repo": "/repo/.git" });

    attachReviewToRuntime(
      { onRepoChanged, onRootWatched: noopOnRootWatched(), resolver },
      {
        reanchorAfterChange: (input) => {
          calls.push({ prevHead: input.prevHead, head: input.head });
          return okAsync([]) as ResultAsync<unknown, never>;
        },
        gitHistory: { headOf: async () => null },
      },
    );

    fire({ root: "/repo", reason: "head", head: null });
    await flush();
    fire({ root: "/repo", reason: "head", head: "h1" });
    await flush();

    // still null prevHead for h1 — the unborn-branch tick above must not have been recorded
    expect(calls).toEqual([{ prevHead: null, head: "h1" }]);
  });
});

describe("attachWorktreeMissingToReview", () => {
  test("forwards a missing worktree to outdateWorktree", async () => {
    const listeners = new Set<(root: string) => void>();
    const runtime = {
      onWorktreeMissing: (cb: (root: string) => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    };
    const calls: string[] = [];

    attachWorktreeMissingToReview(runtime, {
      outdateWorktree: (input) => {
        calls.push(input.worktreeRoot);
        return okAsync([]) as ResultAsync<unknown[], never>;
      },
    });

    for (const cb of listeners) cb("/gone");
    await flush();

    expect(calls).toEqual(["/gone"]);
  });

  // Item 11: when outdateWorktree matched 0 reviews (e.g. the worktree path
  // herdr reported doesn't line up with any review's stored `worktreeRoot`,
  // often a /tmp vs /private/tmp realpath mismatch), that must be logged —
  // silently doing nothing here is exactly the kind of thing plan.md's
  // operator-visibility rule calls out.
  test("logs when outdateWorktree matched zero reviews", async () => {
    const listeners = new Set<(root: string) => void>();
    const runtime = {
      onWorktreeMissing: (cb: (root: string) => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    };
    const infos: unknown[][] = [];

    attachWorktreeMissingToReview(
      runtime,
      {
        outdateWorktree: () => okAsync([]) as ResultAsync<unknown[], never>,
      },
      { error: () => {}, info: (...args: unknown[]) => infos.push(args) },
    );

    for (const cb of listeners) cb("/gone");
    await flush();

    expect(infos.length).toBeGreaterThan(0);
  });

  test("does not log when outdateWorktree matched at least one review", async () => {
    const listeners = new Set<(root: string) => void>();
    const runtime = {
      onWorktreeMissing: (cb: (root: string) => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    };
    const infos: unknown[][] = [];

    attachWorktreeMissingToReview(
      runtime,
      {
        outdateWorktree: () => okAsync([{ id: "r1" }]) as ResultAsync<unknown[], never>,
      },
      { error: () => {}, info: (...args: unknown[]) => infos.push(args) },
    );

    for (const cb of listeners) cb("/gone");
    await flush();

    expect(infos).toHaveLength(0);
  });
});

const ANCHOR: Anchor = { side: "new", line: "x", before: [], after: [], lineHint: 1, hash: "h" };

describe("createRuntime: worktree_removed gateway event", () => {
  // Item 11: herdr reports its own (non-realpath'd) path for the worktree; a
  // review's `worktreeRoot` is always stored realpath'd (git/resolve.ts). On
  // macOS $TMPDIR is itself a /tmp -> /private/tmp symlink, so without
  // realpath'ing the incoming event path here, `outdateWorktree` would compare
  // against the wrong string and match nothing.
  //
  // Item 8: by the time `worktree_removed` fires, the worktree directory is
  // usually already deleted, so realpath'ing the leaf path itself would
  // ENOENT. Model the real $TMPDIR-style scenario instead: an ANCESTOR
  // directory is a symlink, and the worktree directory under it still
  // exists (not yet cleaned up) at event time — the fix must resolve the
  // symlinked parent and rejoin the (still-real) leaf.
  test("realpath's the worktree_removed path's parent before forwarding it as missing", async () => {
    const realParent = await mkdtemp(join(tmpdir(), "hw-bootstrap-real-"));
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(realParent, "wt"));
    const linkParent = await mkdtemp(join(tmpdir(), "hw-bootstrap-linkdir-"));
    const link = join(linkParent, "link");
    await symlink(realParent, link);
    const rawPath = join(link, "wt");

    const config = v.parse(ConfigSchema, {});
    const { runtime, fake } = createRuntimeWithFakeHerdr(config, {
      version: "1",
      protocol: 20,
      workspaces: [],
      tabs: [],
      panes: [],
      agents: [],
    });

    const missing: string[] = [];
    runtime.onWorktreeMissing((root) => missing.push(root));

    fake.emit({
      event: "worktree_removed",
      data: {
        type: "worktree_removed",
        workspace_id: "w1",
        workspace: null,
        worktree: {
          path: rawPath,
          is_bare: false,
          is_detached: false,
          is_prunable: false,
          is_linked_worktree: true,
          label: "l",
          branch: null,
          open_workspace_id: null,
        },
        forced: false,
      },
    });

    const expectedReal = join(await realpathAsync(realParent), "wt");
    await waitUntil(async () => missing.length > 0);
    runtime.stop();

    expect(missing).toEqual([expectedReal]);

    await rm(realParent, { recursive: true, force: true });
    await rm(linkParent, { recursive: true, force: true });
  });

  // Item 8: the worktree directory itself no longer exists at event time (the
  // common case — herdr fires `worktree_removed` after deleting it). realpath
  // must still resolve through a symlinked PARENT directory even though the
  // leaf (already-deleted) path can never itself be realpath'd.
  test("resolves through a symlinked parent even when the worktree leaf no longer exists", async () => {
    const realParent = await mkdtemp(join(tmpdir(), "hw-bootstrap-real-"));
    const linkParent = await mkdtemp(join(tmpdir(), "hw-bootstrap-linkdir-"));
    const link = join(linkParent, "link");
    await symlink(realParent, link);
    // "some-worktree-name" is never created — it's already gone by the time
    // worktree_removed fires.
    const rawPath = join(link, "some-worktree-name");

    const config = v.parse(ConfigSchema, {});
    const { runtime, fake } = createRuntimeWithFakeHerdr(config, {
      version: "1",
      protocol: 20,
      workspaces: [],
      tabs: [],
      panes: [],
      agents: [],
    });

    const missing: string[] = [];
    runtime.onWorktreeMissing((root) => missing.push(root));

    fake.emit({
      event: "worktree_removed",
      data: {
        type: "worktree_removed",
        workspace_id: "w1",
        workspace: null,
        worktree: {
          path: rawPath,
          is_bare: false,
          is_detached: false,
          is_prunable: false,
          is_linked_worktree: true,
          label: "l",
          branch: null,
          open_workspace_id: null,
        },
        forced: false,
      },
    });

    const expectedReal = join(await realpathAsync(realParent), "some-worktree-name");
    await waitUntil(async () => missing.length > 0);
    runtime.stop();

    expect(missing).toEqual([expectedReal]);

    await rm(realParent, { recursive: true, force: true });
    await rm(linkParent, { recursive: true, force: true });
  });

  // Missing-test (b): the whole path from a real gateway `worktree_removed`
  // event, through createRuntime + attachWorktreeMissingToReview, into
  // outdateWorktree actually marking a review outdated.
  test("worktree_removed flows through createRuntime + attachWorktreeMissingToReview to outdate a review", async () => {
    // A review's worktreeRoot is always stored realpath'd (as git/resolve.ts
    // does for the real app) — match that here so this test isolates the
    // createRuntime -> attachWorktreeMissingToReview -> outdateWorktree wiring,
    // not the realpath behavior itself (covered by the test above).
    const real = await realpathAsync(await mkdtemp(join(tmpdir(), "hw-bootstrap-e2e-")));

    const config = v.parse(ConfigSchema, {});
    const { runtime, fake } = createRuntimeWithFakeHerdr(config, {
      version: "1",
      protocol: 20,
      workspaces: [],
      tabs: [],
      panes: [],
      agents: [],
    });

    const db = openDb(":memory:");
    applyMigrations(db);
    const review = createReviewRuntime({ config, db, onEvent: () => {} });

    const created = await review.routes.createReview({
      repo: `${real}/.git`,
      worktreeRoot: real,
      target: { kind: "worktree", root: real },
      path: "a.ts",
      anchor: ANCHOR,
      createdAtHead: "head0",
      viewedAs: { from: "WORKTREE", to: "WORKTREE" },
      body: "why?",
    });
    const reviewId = created._unsafeUnwrap().id;

    const detach = attachWorktreeMissingToReview(runtime, review);

    fake.emit({
      event: "worktree_removed",
      data: {
        type: "worktree_removed",
        workspace_id: "w1",
        workspace: null,
        worktree: {
          path: real,
          is_bare: false,
          is_detached: false,
          is_prunable: false,
          is_linked_worktree: true,
          label: "l",
          branch: null,
          open_workspace_id: null,
        },
        forced: false,
      },
    });

    await waitUntil(async () => (await review.repository.get(reviewId))?.status === "outdated");
    detach();
    runtime.stop();

    expect((await review.repository.get(reviewId))?.status).toBe("outdated");

    await rm(real, { recursive: true, force: true });
  });
});

// Item 1: a review created while its worktree is NOT the focused/pinned root
// never gets a repo-changed tick to reconcile against, because the poller
// only polls watched roots and its first tick after watch() just seeds its
// cache (never fires onChanged). Focusing a pane on that root must itself
// trigger an immediate reconciliation against the current HEAD.
describe("Item 1: onRootWatched reconciles a newly-watched worktree", () => {
  test("commit-binds a worktree review once its root becomes focused, without waiting for a poll tick", async () => {
    // realpath'd up front (as git/resolve.ts's WorktreeInfo.root always is, via
    // `git rev-parse --show-toplevel`) so it matches what the resolver / focus
    // tracker will report, and what a real review's `worktreeRoot` would be.
    const root = await realpathAsync(await mkdtemp(join(tmpdir(), "hw-bootstrap-onrootwatched-")));
    await git(root, "init", "-q", "-b", "main");
    await writeFile(join(root, "a.txt"), "one\ntwo\nthree\n");
    await git(root, "add", ".");
    await git(root, "commit", "-q", "-m", "init");
    const head0 = await git(root, "rev-parse", "HEAD");

    const wt = await resolveWorktree(root);
    if (!wt) throw new Error("resolveWorktree failed to resolve the temp repo");

    const config = v.parse(ConfigSchema, {});
    // No pane is focused initially, so createRuntime never watches `root` —
    // matching the "review created on an unwatched worktree" scenario.
    const { runtime, fake } = createRuntimeWithFakeHerdr(config, {
      version: "1",
      protocol: 20,
      workspaces: [
        {
          workspace_id: "w1",
          number: 1,
          label: "w1",
          focused: false,
          pane_count: 1,
          tab_count: 1,
          active_tab_id: "t1",
          agent_status: "idle",
        },
      ],
      tabs: [
        {
          tab_id: "t1",
          workspace_id: "w1",
          number: 1,
          label: "t1",
          focused: false,
          pane_count: 1,
          agent_status: "idle",
        },
      ],
      panes: [
        {
          pane_id: "p1",
          terminal_id: "term1",
          workspace_id: "w1",
          tab_id: "t1",
          focused: false,
          agent_status: "idle",
          revision: 1,
          cwd: root,
          foreground_cwd: root,
        },
      ],
      agents: [],
    });

    const db = openDb(":memory:");
    applyMigrations(db);
    const review = createReviewRuntime({ config, db, onEvent: () => {} });

    // Draft change: "four" is already in the worktree but not yet committed.
    await writeFile(join(root, "a.txt"), "one\ntwo\nthree\nfour\n");
    const anchor: Anchor = {
      side: "new",
      line: "four",
      before: ["three"],
      after: [],
      lineHint: 4,
      hash: "h",
    };
    const created = await review.routes.createReview({
      repo: wt.commonDir,
      worktreeRoot: root,
      target: { kind: "worktree", root },
      path: "a.txt",
      anchor,
      createdAtHead: head0,
      viewedAs: { from: "WORKTREE", to: "WORKTREE" },
      body: "why?",
    });
    const reviewId = created._unsafeUnwrap().id;
    expect((await review.repository.get(reviewId))?.target).toEqual({ kind: "worktree", root });

    const detach = attachReviewToRuntime(runtime, review);

    // The draft change lands as a real commit while `root` is still unwatched
    // (no pane is focused on it) — the poller never sees this happen.
    await git(root, "commit", "-qam", "add four");
    const head1 = await git(root, "rev-parse", "HEAD");
    expect(head1).not.toBe(head0);

    // Wait for the initial session.snapshot load (async) before focusing —
    // otherwise focusPane's event could race ahead of it and be clobbered.
    await waitUntil(async () => runtime.state.get().panes.size > 0);

    // Now the pane on `root` becomes focused: createRuntime's focus.onChange
    // handler watches `root` and (Item 1's fix) fires onRootWatched, which
    // attachReviewToRuntime must use to reconcile immediately.
    fake.focusPane("p1");

    await waitUntil(async () => (await review.repository.get(reviewId))?.target.kind === "commit");
    detach();
    runtime.stop();

    const finalReview = await review.repository.get(reviewId);
    expect(finalReview?.target).toEqual({ kind: "commit", hash: head1 });

    await rm(root, { recursive: true, force: true });
  });
});
