import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Ask } from "@contract/ask";
import type { WorkspaceGroup } from "@/lib/repoWorkspaces";
import { renderWithStore } from "@/testing/renderWithRouter";
import { AskSessionGroup } from "./AskSessionGroup";

const list = vi.fn();
const resolve = vi.fn();

vi.mock("@/lib/api", () => ({
  askApi: {
    list: (...args: unknown[]) => list(...args),
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
    session: { kind: "herdr", label: "ask:abc12345" },
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
    workspaces: [workspace()],
    repoKey: "/repo/.git",
    collapsed: false,
    onToggleCollapse: vi.fn(),
    onSelectPane: vi.fn(),
    onOpenAskFile: vi.fn(),
  };
}

function openMenu() {
  fireEvent.contextMenu(screen.getByTestId("ask-session-row-w-ask"));
}

/** Menu items render disabled until the ask-list query resolves and matches
 * the row's workspace label — wait for that before interacting with them.
 * A generous timeout: this environment's async/query settling is much
 * slower than the fake-timer-free default budget. */
async function waitForMatchedItem(label: string) {
  await vi.waitFor(
    () => {
      expect(screen.getByText(label).closest('[role="menuitem"]')).not.toHaveAttribute(
        "data-disabled",
      );
    },
    { timeout: 20_000, interval: 100 },
  );
}

beforeEach(() => {
  list.mockReset();
  resolve.mockReset();
  list.mockResolvedValue([ask()]);
  resolve.mockResolvedValue(ask({ status: "resolved" }));
});

describe("AskSessionGroup", () => {
  test("renders nothing when there are no ask workspaces", () => {
    renderWithStore(<AskSessionGroup {...defaultProps()} workspaces={[]} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("shows the workspace label and status icon, and clicking selects its first pane", () => {
    const onSelectPane = vi.fn();
    renderWithStore(<AskSessionGroup {...defaultProps()} onSelectPane={onSelectPane} />);
    expect(screen.getByText("ask:abc12345")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ask-session-row-w-ask"));
    expect(onSelectPane).toHaveBeenCalledWith("p1");
  });

  test("collapsing hides the workspace rows", () => {
    renderWithStore(<AskSessionGroup {...defaultProps()} collapsed={true} />);
    expect(screen.queryByTestId("ask-session-row-w-ask")).not.toBeInTheDocument();
  });

  test("right-click opens a menu with 対象ファイルを開く and 解決", async () => {
    renderWithStore(<AskSessionGroup {...defaultProps()} />);
    await vi.waitFor(() => expect(list).toHaveBeenCalled());
    openMenu();
    expect(screen.getByText("対象ファイルを開く")).toBeInTheDocument();
    expect(screen.getByText("解決")).toBeInTheDocument();
  });

  test("対象ファイルを開く calls onOpenAskFile with the matched ask's worktree/path/line", async () => {
    const onOpenAskFile = vi.fn();
    renderWithStore(<AskSessionGroup {...defaultProps()} onOpenAskFile={onOpenAskFile} />);
    await vi.waitFor(() => expect(list).toHaveBeenCalled());
    openMenu();
    await waitForMatchedItem("対象ファイルを開く");
    fireEvent.click(screen.getByText("対象ファイルを開く"));
    expect(onOpenAskFile).toHaveBeenCalledWith({
      worktreeRoot: "/repo",
      path: "src/a.ts",
      line: 42,
    });
  }, 45_000);

  test("解決 opens a confirm dialog naming the path; confirming calls askApi.resolve", async () => {
    renderWithStore(<AskSessionGroup {...defaultProps()} />);
    await vi.waitFor(() => expect(list).toHaveBeenCalled());
    openMenu();
    await waitForMatchedItem("解決");
    fireEvent.click(screen.getByText("解決"));

    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "解決" }));

    await vi.waitFor(() => {
      expect(resolve).toHaveBeenCalledWith("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    });
  }, 25_000);

  test("an unmatched workspace label (no ask found) disables both menu items with a hint", async () => {
    list.mockResolvedValue([]);
    renderWithStore(<AskSessionGroup {...defaultProps()} />);
    await vi.waitFor(() => expect(list).toHaveBeenCalled());
    openMenu();

    const openItem = screen.getByText("対象ファイルを開く");
    const resolveItem = screen.getByText("解決");
    expect(openItem.closest('[role="menuitem"]')).toHaveAttribute("data-disabled");
    expect(resolveItem.closest('[role="menuitem"]')).toHaveAttribute("data-disabled");
    expect(screen.getByText("対応する質問が見つかりません")).toBeInTheDocument();
  });
});
