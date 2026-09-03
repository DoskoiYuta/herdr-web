import { mkdtemp, realpath as realpathAsync, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { okAsync, type ResultAsync } from "neverthrow";
import * as v from "valibot";
import { ConfigSchema } from "../contract/config";
import type { Anchor } from "../contract/review";
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
      { onRepoChanged, resolver },
      {
        reanchorAfterChange: (input) => {
          calls.push({ prevHead: input.prevHead, head: input.head });
          return okAsync([]) as ResultAsync<unknown, never>;
        },
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
      { onRepoChanged, resolver },
      {
        reanchorAfterChange: (input) => {
          calls.push({ prevHead: input.prevHead, head: input.head });
          return okAsync([]) as ResultAsync<unknown, never>;
        },
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
  test("realpath's the worktree_removed path before forwarding it as missing", async () => {
    const real = await mkdtemp(join(tmpdir(), "hw-bootstrap-real-"));
    const linkParent = await mkdtemp(join(tmpdir(), "hw-bootstrap-linkdir-"));
    const link = join(linkParent, "wt");
    await symlink(real, link);

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
          path: link,
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

    const expectedReal = await realpathAsync(real);
    await waitUntil(async () => missing.length > 0);
    runtime.stop();

    expect(missing).toEqual([expectedReal]);

    await rm(real, { recursive: true, force: true });
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
