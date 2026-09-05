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
    const state = createHerdrState(gw, undefined, { replaySettleMs: 0, replayMaxMs: 0 });
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
    const state = createHerdrState(gw, undefined, { replaySettleMs: 0, replayMaxMs: 0 });
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

  test("pin freezes worktreeRoot while pane/agent fields keep tracking raw focus", async () => {
    const gw = createFakeHerdr(snapshot);
    const state = createHerdrState(gw, undefined, { replaySettleMs: 0, replayMaxMs: 0 });
    await settle();
    const panes = [...state.get().panes.values()];
    const initial = panes.find((p) => p.pane_id === state.get().focusedPaneId)!;
    const other = panes.find((p) => p.pane_id !== state.get().focusedPaneId)!;
    const initialCwd = initial.foreground_cwd ?? initial.cwd!;
    const otherCwd = other.foreground_cwd ?? other.cwd!;
    const resolver = fakeResolver({
      [initialCwd]: {
        root: initialCwd,
        commonDir: `${initialCwd}/.git`,
        branch: "main",
        isMain: true,
      },
      [otherCwd]: {
        root: otherCwd,
        commonDir: `${otherCwd}/.git`,
        branch: "feature",
        isMain: false,
      },
    });
    const tracker = createFocusTracker({ state, gateway: gw, resolver, pollMs: 1_000_000 });
    tracker.onChange(() => {});
    await settle();

    tracker.pin(initialCwd);
    await settle();
    expect(tracker.pinned()).toBe(initialCwd);

    gw.focusPane(other.pane_id);
    await settle();
    // The newly-focused pane belongs to a *different* worktree than the pin, so
    // its agent must not leak into the payload (Item 5) — the pinned worktree's
    // own agent-bearing pane (the original `initial` pane) is used instead.
    expect(tracker.get().pane).toBe(initial.pane_id);
    expect(tracker.get().agent).toBe(initial.agent ?? null);
    // ...and the pinned worktree root stays put.
    expect(tracker.get().worktreeRoot).toBe(initialCwd);

    tracker.pin(null);
    await settle();
    expect(tracker.get().worktreeRoot).toBe(otherCwd);
  });

  test("polls the focused pane and re-resolves when foreground_cwd drifts without an event", async () => {
    const gw = createFakeHerdr(snapshot);
    const state = createHerdrState(gw, undefined, { replaySettleMs: 0, replayMaxMs: 0 });
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

  test("pinned root never attributes another worktree's agent to the payload", async () => {
    const gw = createFakeHerdr(snapshot);
    const state = createHerdrState(gw, undefined, { replaySettleMs: 0, replayMaxMs: 0 });
    await settle();

    // Focused pane (wE:p1, worktree "herdr-web") has an agent of its own.
    const focused = state.get().panes.get(state.get().focusedPaneId!)!;
    const focusedCwd = focused.foreground_cwd ?? focused.cwd!;
    expect(focused.agent).not.toBeNull();

    // Pin a *different* worktree ("lesson-rebuild-planning", panes w1:p14/w1:p16)
    // that also has agent-bearing panes.
    const pinnedPane = state.get().panes.get("w1:p14")!;
    const pinnedCwd = pinnedPane.foreground_cwd ?? pinnedPane.cwd!;
    expect(pinnedPane.agent).not.toBeNull();
    expect(pinnedCwd).not.toBe(focusedCwd);

    const resolver = fakeResolver({
      [focusedCwd]: {
        root: focusedCwd,
        commonDir: `${focusedCwd}/.git`,
        branch: "main",
        isMain: true,
      },
      [pinnedCwd]: {
        root: pinnedCwd,
        commonDir: `${pinnedCwd}/.git`,
        branch: "main",
        isMain: true,
      },
    });
    const tracker = createFocusTracker({ state, gateway: gw, resolver, pollMs: 1_000_000 });
    tracker.onChange(() => {});
    await settle();

    tracker.pin(pinnedCwd);
    await settle();

    const payload = tracker.get();
    expect(payload.worktreeRoot).toBe(pinnedCwd);
    // The agent must never be attributed to the focused pane's worktree (B)
    // when it differs from the pinned worktree (A): either it's null, or it
    // comes from a pane that itself resolves to the pinned root.
    if (payload.agent !== null) {
      expect(payload.pane).not.toBe(focused.pane_id);
      expect(payload.pane).not.toBeNull();
      expect([pinnedPane.pane_id, "w1:p16"]).toContain(payload.pane as string);
      expect(payload.agentSession).toEqual(
        (payload.pane === "w1:p16"
          ? state.get().panes.get("w1:p16")!.agent_session
          : pinnedPane.agent_session) ?? null,
      );
    }
  });
});
