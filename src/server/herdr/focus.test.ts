import { describe, expect, test } from "bun:test";
import snapshotFixture from "../../contract/__fixtures__/snapshot.json" with { type: "json" };
import { SessionSnapshotSchema } from "../../contract/herdr";
import * as v from "valibot";
import { createFakeHerdr } from "./fake";
import { createHerdrState } from "./state";
import { createFocusTracker } from "./focus";
import type { WorktreeInfo, WorktreeResolver } from "./tree";

const snapshot = v.parse(SessionSnapshotSchema, snapshotFixture);

function fakeResolver(map: Record<string, WorktreeInfo | null>): WorktreeResolver {
  return {
    async resolve(path: string) {
      return path in map ? map[path]! : null;
    },
  };
}

const noWorktrees = async () => [];
const noSubRepos = async () => [];

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

describe("createFocusTracker", () => {
  test("computes the focus payload for the initially focused pane", async () => {
    const gw = createFakeHerdr(snapshot);
    const state = createHerdrState(gw);
    await settle();
    const focusedPane = state.get().panes.get(state.get().focusedPaneId!)!;
    const cwd = focusedPane.foreground_cwd ?? focusedPane.cwd!;
    const resolver = fakeResolver({
      [cwd]: { root: cwd, commonDir: `${cwd}/.git`, branch: "main", isMain: true },
    });
    const tracker = createFocusTracker({
      state,
      gateway: gw,
      resolver,
      listWorktrees: noWorktrees,
      listSubRepos: noSubRepos,
      pollMs: 1_000_000,
    });
    await settle();
    expect(tracker.get().pane).toBe(focusedPane.pane_id);
    expect(tracker.get().worktreeRoot).toBe(cwd);
    expect(tracker.get().selectionIsDefault).toBe(true);
  });

  test("re-resolves and notifies when the focused pane changes", async () => {
    const gw = createFakeHerdr(snapshot);
    const state = createHerdrState(gw);
    await settle();
    const panes = [...state.get().panes.values()];
    const other = panes.find((p) => p.pane_id !== state.get().focusedPaneId)!;
    const cwd = other.foreground_cwd ?? other.cwd!;
    const resolver = fakeResolver({
      [cwd]: { root: cwd, commonDir: `${cwd}/.git`, branch: "feature", isMain: false },
    });
    const tracker = createFocusTracker({
      state,
      gateway: gw,
      resolver,
      listWorktrees: noWorktrees,
      listSubRepos: noSubRepos,
      pollMs: 1_000_000,
    });
    const seen: (string | null)[] = [];
    tracker.onChange((p) => seen.push(p.worktreeRoot));
    gw.focusPane(other.pane_id);
    await settle();
    expect(tracker.get().pane).toBe(other.pane_id);
    expect(tracker.get().worktreeRoot).toBe(cwd);
    expect(seen).toContain(cwd);
  });

  test("polls the focused pane and re-resolves when foreground_cwd drifts without an event", async () => {
    const gw = createFakeHerdr(snapshot);
    const state = createHerdrState(gw);
    await settle();
    const paneId = state.get().focusedPaneId!;
    const pane = state.get().panes.get(paneId)!;
    const cwdA = pane.foreground_cwd ?? pane.cwd!;
    const cwdB = "/some/other/worktree";
    const resolver = fakeResolver({
      [cwdA]: { root: cwdA, commonDir: `${cwdA}/.git`, branch: "main", isMain: true },
      [cwdB]: { root: cwdB, commonDir: `${cwdB}/.git`, branch: "b", isMain: false },
    });
    const tracker = createFocusTracker({
      state,
      gateway: gw,
      resolver,
      listWorktrees: noWorktrees,
      listSubRepos: noSubRepos,
      pollMs: 10,
    });
    tracker.onChange(() => {});
    await settle();
    expect(tracker.get().worktreeRoot).toBe(cwdA);

    // Mutate the gateway's pane record directly (no pane_updated event), simulating
    // a foreground_cwd change herdr doesn't announce (§12-1).
    gw.setForegroundCwdSilently(paneId, cwdB);
    await new Promise((r) => setTimeout(r, 60));

    expect(tracker.get().worktreeRoot).toBe(cwdB);
    // The store itself must be patched too (Item 2) — not just this tracker's
    // local payload — so other readers (routes/hw.ts whoami, the notifier,
    // any future recompute() without a paneOverride) see the fresh pane.
    expect(state.get().panes.get(paneId)?.foreground_cwd).toBe(cwdB);
    tracker.stop();
  });

  // 無いと壊れる: フォーカス中ワークスペースに保存済み選択があっても focus
  // メッセージが cwd の worktree しか報告せず、Web UI のツール領域が選択と
  // ずれたまま追従してしまう。
  test("reports the saved selection for the focused pane's workspace, not its cwd's worktree", async () => {
    const gw = createFakeHerdr(snapshot);
    const state = createHerdrState(gw);
    await settle();
    const pane = state.get().panes.get(state.get().focusedPaneId!)!;
    const cwd = pane.foreground_cwd ?? pane.cwd!;
    const resolver = fakeResolver({
      [cwd]: { root: cwd, commonDir: `${cwd}/.git`, branch: "main", isMain: true },
    });
    state.setSelection({
      workspaceId: pane.workspace_id,
      repoKey: `${cwd}/.git`,
      worktreeRoot: "/repo-feature",
      subRepoId: null,
      subWorktreeRoot: null,
    });
    const tracker = createFocusTracker({
      state,
      gateway: gw,
      resolver,
      listWorktrees: async () => [
        { root: cwd, branch: "main", head: "h1", isMain: true },
        { root: "/repo-feature", branch: "feature", head: "h2", isMain: false },
      ],
      listSubRepos: noSubRepos,
      pollMs: 1_000_000,
    });
    await settle();
    expect(tracker.get().worktreeRoot).toBe("/repo-feature");
    expect(tracker.get().selectionIsDefault).toBe(false);
  });
});
