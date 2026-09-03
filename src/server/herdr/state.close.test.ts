import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import snapshotJson from "../../contract/__fixtures__/snapshot.json";
import { SessionSnapshotSchema } from "../../contract/herdr";
import { applyEvent, stateFromSnapshot } from "./state";

const snapshot = v.parse(SessionSnapshotSchema, snapshotJson);

describe("workspace_closed / tab_closed drop their panes", () => {
  test("workspace_closed removes the workspace, its tabs and panes", () => {
    const s0 = stateFromSnapshot(snapshot);
    const ws = [...s0.workspaces.keys()][0]!;
    const before = [...s0.panes.values()].filter((p) => p.workspace_id === ws).length;
    expect(before).toBeGreaterThan(0);
    const s1 = applyEvent(s0, {
      event: "workspace_closed",
      data: { type: "workspace_closed", workspace_id: ws },
    } as never);
    expect(s1.workspaces.has(ws)).toBe(false);
    expect([...s1.panes.values()].some((p) => p.workspace_id === ws)).toBe(false);
    expect([...s1.tabs.values()].some((t) => t.workspace_id === ws)).toBe(false);
  });

  test("tab_closed removes the tab's panes", () => {
    const s0 = stateFromSnapshot(snapshot);
    const tab = [...s0.tabs.keys()][0]!;
    const s1 = applyEvent(s0, {
      event: "tab_closed",
      data: { type: "tab_closed", tab_id: tab },
    } as never);
    expect([...s1.panes.values()].some((p) => p.tab_id === tab)).toBe(false);
  });
});
