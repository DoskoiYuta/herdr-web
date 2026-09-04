import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { herdrApi } from "./api";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function workspace(overrides: Record<string, unknown> = {}) {
  return {
    workspace_id: "w1",
    number: 1,
    label: "my-workspace",
    focused: false,
    pane_count: 1,
    tab_count: 1,
    active_tab_id: "w1:t1",
    agent_status: "unknown",
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("herdrApi", () => {
  test("createWorkspace() POSTs /api/herdr/workspace with cwd/label/focus and parses the id", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ workspaceId: "w1" }, 201));
    const result = await herdrApi.createWorkspace({
      cwd: "/repo",
      label: "my-workspace",
      focus: true,
    });
    expect(result).toEqual({ workspaceId: "w1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/api/herdr/workspace");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual({
      cwd: "/repo",
      label: "my-workspace",
      focus: true,
    });
  });

  test("createWorkspace() throws on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "forbidden" }, 403));
    await expect(herdrApi.createWorkspace({ cwd: "/nope" })).rejects.toThrow(/403/);
  });

  test("renameWorkspace() POSTs /api/herdr/workspace/:id/rename and parses the workspace", async () => {
    const w = workspace({ label: "renamed" });
    fetchMock.mockResolvedValueOnce(jsonResponse({ workspace: w }));
    const result = await herdrApi.renameWorkspace("w1", "renamed");
    expect(result.workspace.label).toBe("renamed");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/api/herdr/workspace/w1/rename");
    expect(JSON.parse(init!.body as string)).toEqual({ label: "renamed" });
  });

  test("closeWorkspace() POSTs /api/herdr/workspace/:id/close with confirm: true", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const result = await herdrApi.closeWorkspace("w1", { confirm: true });
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/api/herdr/workspace/w1/close");
    expect(JSON.parse(init!.body as string)).toEqual({ confirm: true });
  });

  test("closeWorkspace() throws on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "internal" }, 500));
    await expect(herdrApi.closeWorkspace("w1", { confirm: true })).rejects.toThrow(/500/);
  });

  test("panePreview() GETs /api/herdr/pane-preview with the pane id as a query param and parses the response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        pane: "p1",
        workspaceLabel: "ws-1",
        tabLabel: "tab-1",
        title: "claude working",
        agent: "claude",
        agentStatus: "working",
        agentSession: "sess-abc12345",
        layout: null,
        tail: ["line 1", "line 2"],
      }),
    );
    const result = await herdrApi.panePreview("p1");
    expect(result.workspaceLabel).toBe("ws-1");
    expect(result.tail).toEqual(["line 1", "line 2"]);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/api/herdr/pane-preview");
    expect(String(url)).toContain("pane=p1");
  });

  test("panePreview() throws on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "not-found" }, 404));
    await expect(herdrApi.panePreview("missing")).rejects.toThrow(/404/);
  });
});
