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
    const tracker = createFocusTracker({ state, gateway: gw, resolver, pollMs: 1_000_000 });
    await settle();
    expect(tracker.get().pane).toBe(focusedPane.pane_id);
    expect(tracker.get().worktreeRoot).toBe(cwd);
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
    const tracker = createFocusTracker({ state, gateway: gw, resolver, pollMs: 1_000_000 });
    const seen: (string | null)[] = [];
    tracker.onChange((p) => seen.push(p.worktreeRoot));
    gw.focusPane(other.pane_id);
    await settle();
    expect(tracker.get().pane).toBe(other.pane_id);
    expect(tracker.get().worktreeRoot).toBe(cwd);
    expect(seen).toContain(cwd);
  });

  // 無いと壊れる: hw worktree use で宣言しても、ツール領域の追従先が herdr の
  // foreground_cwd（agent 本体の cwd）のままになり、宣言した worktree に切り替わらない。
  test("reports the declared worktree override for the focused pane instead of its foreground_cwd", async () => {
    const gw = createFakeHerdr(snapshot);
    const state = createHerdrState(gw);
    await settle();
    const paneId = state.get().focusedPaneId!;
    const declaredRoot = "/declared/wt";
    const resolver = fakeResolver({
      [declaredRoot]: {
        root: declaredRoot,
        commonDir: `${declaredRoot}/.git`,
        branch: "wt",
        isMain: false,
      },
    });
    const tracker = createFocusTracker({ state, gateway: gw, resolver, pollMs: 1_000_000 });
    await settle();

    state.setWorktreeOverride(paneId, declaredRoot);
    await settle();

    expect(tracker.get().worktreeRoot).toBe(declaredRoot);
  });

  // 無いと壊れる: poll が effectiveCwd（= 宣言済みの root）で前回値と比較すると、
  // 宣言中は本体が本当に移動しても値が変わって見えず、patchPane が二度と呼ばれない
  // ため reducer の自動解除が一生発火せず、宣言が永久に残る。
  test("polling notices the pane's real cwd drifting even while a worktree override is active, and drops the override", async () => {
    const gw = createFakeHerdr(snapshot);
    const state = createHerdrState(gw);
    await settle();
    const paneId = state.get().focusedPaneId!;
    const declaredRoot = "/declared/wt";
    const movedRoot = "/moved/elsewhere";
    const resolver = fakeResolver({
      [declaredRoot]: {
        root: declaredRoot,
        commonDir: `${declaredRoot}/.git`,
        branch: "wt",
        isMain: false,
      },
      [movedRoot]: {
        root: movedRoot,
        commonDir: `${movedRoot}/.git`,
        branch: "moved",
        isMain: false,
      },
    });
    const tracker = createFocusTracker({ state, gateway: gw, resolver, pollMs: 10 });
    tracker.onChange(() => {});
    await settle();

    state.setWorktreeOverride(paneId, declaredRoot);
    await settle();
    expect(tracker.get().worktreeRoot).toBe(declaredRoot);

    // Mutate the gateway's pane record directly (no pane_updated event), simulating
    // the agent binary itself really moving while the override is in effect.
    gw.setForegroundCwdSilently(paneId, movedRoot);
    await new Promise((r) => setTimeout(r, 60));

    expect(state.get().paneWorktreeOverrides.has(paneId)).toBe(false);
    expect(tracker.get().worktreeRoot).toBe(movedRoot);
    tracker.stop();
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
    const tracker = createFocusTracker({ state, gateway: gw, resolver, pollMs: 10 });
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
});
