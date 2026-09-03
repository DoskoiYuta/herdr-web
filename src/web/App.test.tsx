import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ServerEventMessage } from "@contract/events";
import { App } from "./App";

// xterm.js は実 canvas / WebGL コンテキストを要求するため jsdom では動かせない。
// レイアウトのテストではターミナルの中身自体は関心の対象外なのでモックする。
vi.mock("@/components/terminal/Terminal", () => ({
  Terminal: ({ className }: { className?: string }) => (
    <div data-testid="terminal-stub" className={className} />
  ),
}));

// DiffPanel/GraphPanel は実 API 呼び出し（gitApi 経由の fetch）を行う。App の
// レイアウト・フォーカス追従テストの関心の外なのでスタブする。
vi.mock("@/components/diff/DiffPanel", () => ({
  DiffPanel: ({ repo }: { repo: string }) => <div data-testid="diff-panel-stub">{repo}</div>,
}));
vi.mock("@/components/graph/GraphPanel", () => ({
  GraphPanel: () => <div data-testid="graph-panel-stub" />,
}));

vi.mock("@/lib/api", () => ({
  configApi: {
    get: vi.fn(async () => ({
      terminal: { fontFamily: "monospace", fontSize: 13, lineHeight: 1 },
      graphInitialCommits: 200,
    })),
  },
  gitApi: {
    root: vi.fn(async (path: string) => ({
      root: path,
      commonDir: `${path}/.git`,
      branch: "main",
      isMain: true,
      head: "abc123",
      rootCommit: "abc123",
    })),
  },
  reviewApi: {
    list: vi.fn(async () => []),
  },
}));

type EventsHandlers = {
  onMessage: (message: ServerEventMessage) => void;
  onStatus?: (status: string) => void;
};

const sendMock = vi.fn();
const closeMock = vi.fn();
const handlersLog: EventsHandlers[] = [];

vi.mock("@/lib/eventsSocket", () => ({
  connectEvents: vi.fn((_loc: unknown, opts: EventsHandlers) => {
    handlersLog.push(opts);
    return { send: sendMock, close: closeMock };
  }),
}));

function latestHandlers(): EventsHandlers {
  const h = handlersLog[handlersLog.length - 1];
  if (!h) throw new Error("connectEvents was not called");
  return h;
}

/** herdrStore の setState は React イベントハンドラの外から呼ばれるので act() で包む。 */
function emit(message: ServerEventMessage) {
  act(() => {
    latestHandlers().onMessage(message);
  });
}

function focusMessage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    type: "focus",
    pane: "p1",
    workspace: "w1",
    cwd: "/repo",
    foregroundCwd: "/repo",
    worktreeRoot: "/Users/dev/project",
    repoKey: "/Users/dev/project/.git",
    agent: "claude",
    agentStatus: "working",
    agentSession: { source: "herdr:claude", agent: "claude", kind: "id", value: "sess-1" },
    ...overrides,
  } as ServerEventMessage;
}

function renderApp() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    sendMock.mockClear();
    closeMock.mockClear();
    handlersLog.length = 0;
  });

  test("renders the three-column layout skeleton", () => {
    renderApp();
    expect(screen.getByLabelText("サイドバー")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-stub")).toBeInTheDocument();
    expect(screen.getByText("herdr 未接続 / worktree 未選択")).toBeInTheDocument();
    expect(screen.getAllByRole("separator").length).toBeGreaterThan(0);
  });

  test("collapsing the tool area hides its content and its divider", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "ツール領域を折りたたむ" }));
    expect(screen.queryByText("herdr 未接続 / worktree 未選択")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ツール領域を開く" })).toBeInTheDocument();
  });

  test("persists the collapsed state to localStorage", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "ツール領域を折りたたむ" }));
    const stored = JSON.parse(localStorage.getItem("herdr-web:layout") ?? "{}");
    expect(stored.toolCollapsed).toBe(true);
  });

  test("a focus message switches the displayed worktree in the tool pane", () => {
    renderApp();
    emit(focusMessage());
    expect(screen.getByText("project")).toBeInTheDocument();
    expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent("/Users/dev/project");
    expect(screen.getByText("claude · working")).toBeInTheDocument();
  });

  test("a later focus message follows to the new worktree when not pinned", () => {
    renderApp();
    emit(focusMessage());
    emit(focusMessage({ worktreeRoot: "/Users/dev/other", repoKey: "/Users/dev/other/.git" }));
    expect(screen.getByText("other")).toBeInTheDocument();
  });

  test("pinning sends a pin message and keeps display on the pinned root even if focus moves elsewhere", () => {
    renderApp();
    emit(focusMessage());
    fireEvent.click(screen.getByLabelText("ピン留め"));
    expect(sendMock).toHaveBeenCalledWith({ type: "pin", worktreeRoot: "/Users/dev/project" });

    // サーバーは pin を確認する focus を送り返す（worktreeRoot は変わらない）——
    // 表示は常に focus.worktreeRoot に従う。
    emit(focusMessage());
    expect(screen.getByText("project")).toBeInTheDocument();
  });

  test("unpinning sends pin:null", () => {
    renderApp();
    emit(focusMessage());
    fireEvent.click(screen.getByLabelText("ピン留め"));
    sendMock.mockClear();
    fireEvent.click(screen.getByLabelText("ピン留めを解除"));
    expect(sendMock).toHaveBeenCalledWith({ type: "pin", worktreeRoot: null });
  });

  test("the manual open-path fallback pins to the opened root", async () => {
    renderApp();
    fireEvent.change(screen.getByLabelText("リポジトリのパスを開く"), {
      target: { value: "/tmp/manual" },
    });
    fireEvent.click(screen.getByRole("button", { name: "開く" }));
    await screen.findByText("manual");
    expect(sendMock).toHaveBeenCalledWith({ type: "pin", worktreeRoot: "/tmp/manual" });
  });

  test("unpinning the manual open-path fallback clears it (no focus to fall back to, so repoKey and worktreeRoot don't drift apart)", async () => {
    renderApp();
    fireEvent.change(screen.getByLabelText("リポジトリのパスを開く"), {
      target: { value: "/tmp/manual" },
    });
    fireEvent.click(screen.getByRole("button", { name: "開く" }));
    await screen.findByText("manual");

    fireEvent.click(screen.getByLabelText("ピン留めを解除"));
    expect(screen.getByText("herdr 未接続 / worktree 未選択")).toBeInTheDocument();
  });

  test("clicking a sidebar workspace row sends focus-pane", () => {
    renderApp();
    emit({
      type: "tree",
      repos: [
        {
          key: "/Users/dev/project/.git",
          name: "project",
          counts: { blocked: 0, done: 0 },
          worktrees: [
            {
              root: "/Users/dev/project",
              branch: "main",
              isMain: true,
              panes: [
                {
                  paneId: "p1",
                  workspaceId: "w1",
                  workspaceLabel: "w1",
                  tabId: "t1",
                  tabLabel: null,
                  label: "session",
                  agent: "claude",
                  agentStatus: "working",
                  terminalTitleStripped: null,
                  focused: false,
                  cwd: "/Users/dev/project",
                  foregroundCwd: "/Users/dev/project",
                },
              ],
            },
          ],
        },
      ],
    });
    fireEvent.click(screen.getByTestId("workspace-row-w1"));
    expect(sendMock).toHaveBeenCalledWith({ type: "focus-pane", pane: "p1" });
  });
});
