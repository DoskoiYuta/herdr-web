import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import snapshotFixture from "./__fixtures__/snapshot.json" with { type: "json" };
import {
  HerdrEventEnvelopeSchema,
  PaneInfoSchema,
  PingResultSchema,
  SessionSnapshotSchema,
  WorkspaceCreatedResultSchema,
  WorkspaceInfoResultSchema,
} from "./herdr";

describe("SessionSnapshotSchema", () => {
  test("parses a real session.snapshot captured from herdr 0.8.2", () => {
    const r = v.safeParse(SessionSnapshotSchema, snapshotFixture);
    expect(r.success).toBe(true);
  });

  test("keeps foreground_cwd and agent_session on pane records", () => {
    const snap = v.parse(SessionSnapshotSchema, snapshotFixture);
    const withAgent = snap.panes.find((p) => p.agent_session);
    expect(withAgent?.foreground_cwd).toBeTruthy();
    expect(withAgent?.agent_session?.kind).toBe("id");
  });

  test("rejects a payload missing required fields", () => {
    const r = v.safeParse(SessionSnapshotSchema, { version: "0.8.2" });
    expect(r.success).toBe(false);
  });

  test("ignores unknown fields (N6)", () => {
    const r = v.safeParse(PaneInfoSchema, {
      pane_id: "p1",
      terminal_id: "t1",
      workspace_id: "w1",
      tab_id: "t1",
      focused: true,
      agent_status: "idle",
      revision: 1,
      some_future_field: { nested: true },
    });
    expect(r.success).toBe(true);
  });
});

describe("PingResultSchema", () => {
  test("parses the live pong response", () => {
    const r = v.safeParse(PingResultSchema, { type: "pong", version: "0.8.2", protocol: 20 });
    expect(r.success).toBe(true);
  });
});

describe("HerdrEventEnvelopeSchema", () => {
  test("parses a pane_updated event observed live", () => {
    const r = v.safeParse(HerdrEventEnvelopeSchema, {
      event: "pane_updated",
      data: {
        type: "pane_updated",
        pane: {
          pane_id: "wE:p1",
          terminal_id: "term_1",
          workspace_id: "wE",
          tab_id: "wE:t1",
          focused: true,
          agent_status: "working",
          revision: 2,
          cwd: "/Users/yuta/github.com/DoskoiYuta/herdr-web",
          foreground_cwd: "/Users/yuta/github.com/DoskoiYuta/herdr-web",
        },
      },
    });
    expect(r.success).toBe(true);
  });

  test("parses a pane_focused event observed live", () => {
    const r = v.safeParse(HerdrEventEnvelopeSchema, {
      event: "pane_focused",
      data: { type: "pane_focused", pane_id: "w2:p1K", workspace_id: "w2" },
    });
    expect(r.success).toBe(true);
  });

  test("rejects an unknown event type", () => {
    const r = v.safeParse(HerdrEventEnvelopeSchema, {
      event: "something_new",
      data: { type: "something_new" },
    });
    expect(r.success).toBe(false);
  });
});

describe("WorkspaceCreatedResultSchema", () => {
  test("parses workspace.create's result observed live against herdr 0.8.2", () => {
    const r = v.safeParse(WorkspaceCreatedResultSchema, {
      type: "workspace_created",
      workspace: {
        workspace_id: "wF",
        number: 6,
        label: "hw-test",
        focused: false,
        pane_count: 1,
        tab_count: 1,
        active_tab_id: "wF:t1",
        agent_status: "unknown",
      },
      tab: {
        tab_id: "wF:t1",
        workspace_id: "wF",
        number: 1,
        label: "1",
        focused: false,
        pane_count: 1,
        agent_status: "unknown",
      },
      root_pane: {
        pane_id: "wF:p1",
        terminal_id: "term_65a902e07bf0e26",
        workspace_id: "wF",
        tab_id: "wF:t1",
        focused: false,
        cwd: "/Users/yuta/github.com/DoskoiYuta/herdr-web",
        foreground_cwd: "/Users/yuta/github.com/DoskoiYuta/herdr-web",
        agent_status: "unknown",
        revision: 0,
      },
    });
    expect(r.success).toBe(true);
  });
});

describe("WorkspaceInfoResultSchema", () => {
  test("parses workspace.rename's result observed live against herdr 0.8.2", () => {
    const r = v.safeParse(WorkspaceInfoResultSchema, {
      type: "workspace_info",
      workspace: {
        workspace_id: "wF",
        number: 6,
        label: "hw-test-renamed",
        focused: false,
        pane_count: 1,
        tab_count: 1,
        active_tab_id: "wF:t1",
        agent_status: "unknown",
      },
    });
    expect(r.success).toBe(true);
  });
});
