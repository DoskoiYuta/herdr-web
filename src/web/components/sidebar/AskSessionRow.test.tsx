import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Ask } from "@contract/ask";
import type { WorkspaceGroup } from "@/lib/repoWorkspaces";
import { AskSessionRow } from "./AskSessionRow";

const resolve = vi.fn();

vi.mock("@/lib/api", () => ({
  askApi: {
    resolve: (...args: unknown[]) => resolve(...args),
  },
}));

function ask(overrides: Partial<Ask> = {}): Ask {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    repo: "/repo/.git",
    worktreeRoot: "/repo",
    path: "src/a.ts",
    anchor: { side: "new", lines: ["x"], before: [], after: [], lineHint: 42, hash: "deadbeef" },
    createdAtHead: "abc123",
    status: "open",
    session: { kind: "herdr", label: "ask:abc12345", agent: "claude" },
    thread: [
      { seq: 0, author: "user", body: "why?", at: "2026-09-05T00:00:00.000Z", agentSession: null },
    ],
    lastPrompt: null,
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    ...overrides,
  };
}

function workspace(overrides: Partial<WorkspaceGroup> = {}): WorkspaceGroup {
  return {
    workspaceId: "w-ask",
    workspaceLabel: "ask:abc12345",
    panes: [
      {
        paneId: "p1",
        workspaceId: "w-ask",
        workspaceLabel: "ask:abc12345",
        tabId: "t1",
        tabLabel: null,
        label: null,
        agent: "claude",
        agentStatus: "working",
        terminalTitleStripped: null,
        focused: false,
        cwd: "/repo",
        foregroundCwd: "/repo",
        ask: true,
        branch: "main",
        isMain: true,
        worktreeRoot: "/repo",
      },
    ],
    ...overrides,
  };
}

function defaultProps() {
  return {
    workspace: workspace(),
    ask: ask(),
    focusedPaneId: null as string | null,
    onSelectPane: vi.fn(),
    onOpenAskFile: vi.fn(),
    onResolved: vi.fn(),
  };
}

beforeEach(() => {
  resolve.mockReset();
  resolve.mockResolvedValue(ask({ status: "resolved" }));
});

function openMenu() {
  fireEvent.contextMenu(screen.getByTestId("ask-session-row-w-ask"));
}

describe("AskSessionRow", () => {
  // 無いと壊れる: エージェント名が出ないと、どのエージェントが答えている質問
  // セッションかがサイドバー上で見分けられない。
  test("shows 質問 · <agent> · <path 末尾>, and clicking selects its first pane", () => {
    const onSelectPane = vi.fn();
    render(<AskSessionRow {...defaultProps()} onSelectPane={onSelectPane} />);
    expect(screen.getByText("質問 · claude · a.ts")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ask-session-row-w-ask"));
    expect(onSelectPane).toHaveBeenCalledWith("p1");
  });

  test("falls back to 不明 when the session has no agent recorded", () => {
    render(
      <AskSessionRow
        {...defaultProps()}
        ask={ask({ session: { kind: "herdr", label: "ask:abc12345", agent: null } })}
      />,
    );
    expect(screen.getByText("質問 · 不明 · a.ts")).toBeInTheDocument();
  });

  test("falls back to the workspace label when there's no matching ask", () => {
    render(<AskSessionRow {...defaultProps()} ask={undefined} />);
    expect(screen.getByText("ask:abc12345")).toBeInTheDocument();
  });

  test("aria-current follows focusedPaneId matching the row's pane, not pane.focused", () => {
    render(<AskSessionRow {...defaultProps()} focusedPaneId="p1" />);
    expect(screen.getByTestId("ask-session-row-w-ask")).toHaveAttribute("aria-current", "true");
  });

  // 無いと壊れる: フォーカスの視覚的な手がかりが aria-current だけになり、
  // 画面を見ているユーザーがどの質問セッションにフォーカスがあるか分からなくなる。
  test.each([
    ["shows the focus dot when focusedPaneId matches the row's pane", "p1", true],
    ["hides the focus dot otherwise", null, false],
  ])("%s", (_label, focusedPaneId, expectDot) => {
    render(<AskSessionRow {...defaultProps()} focusedPaneId={focusedPaneId} />);
    const dot = screen.queryByTestId("focus-dot");
    expect(dot !== null).toBe(expectDot);
  });

  test("right-click opens a menu with 対象ファイルを開く and 解決 when a matching ask is given", () => {
    render(<AskSessionRow {...defaultProps()} />);
    openMenu();
    expect(screen.getByText("対象ファイルを開く").closest('[role="menuitem"]')).not.toHaveAttribute(
      "data-disabled",
    );
    expect(screen.getByText("解決").closest('[role="menuitem"]')).not.toHaveAttribute(
      "data-disabled",
    );
  });

  test("対象ファイルを開く calls onOpenAskFile with the ask's worktree/path/line", () => {
    const onOpenAskFile = vi.fn();
    render(<AskSessionRow {...defaultProps()} onOpenAskFile={onOpenAskFile} />);
    openMenu();
    fireEvent.click(screen.getByText("対象ファイルを開く"));
    expect(onOpenAskFile).toHaveBeenCalledWith({
      worktreeRoot: "/repo",
      path: "src/a.ts",
      line: 42,
    });
  });

  test("解決 opens a confirm dialog naming the path; confirming calls askApi.resolve and onResolved", async () => {
    const onResolved = vi.fn();
    render(<AskSessionRow {...defaultProps()} onResolved={onResolved} />);
    openMenu();
    fireEvent.click(screen.getByText("解決"));

    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "解決" }));

    await vi.waitFor(
      () => {
        expect(resolve).toHaveBeenCalledWith("01ARZ3NDEKTSV4RRFFQ69G5FAV");
        expect(onResolved).toHaveBeenCalled();
      },
      { timeout: 40_000 },
    );
  }, 45_000);

  test("no matching ask disables both menu items with a hint", () => {
    render(<AskSessionRow {...defaultProps()} ask={undefined} />);
    openMenu();
    expect(screen.getByText("対象ファイルを開く").closest('[role="menuitem"]')).toHaveAttribute(
      "data-disabled",
    );
    expect(screen.getByText("解決").closest('[role="menuitem"]')).toHaveAttribute("data-disabled");
    expect(screen.getByText("対応する質問が見つかりません")).toBeInTheDocument();
  });
});
