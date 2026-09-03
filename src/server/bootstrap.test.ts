import { describe, expect, test } from "bun:test";
import { okAsync, type ResultAsync } from "neverthrow";
import type { ChangedInfo } from "./git/poller";
import { attachReviewToRuntime, attachWorktreeMissingToReview } from "./bootstrap";
import type { Runtime } from "./bootstrap";
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
        return okAsync([]) as ResultAsync<unknown, never>;
      },
    });

    for (const cb of listeners) cb("/gone");
    await flush();

    expect(calls).toEqual(["/gone"]);
  });
});
