import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { FocusMessage } from "@contract/events";
import type { SubReposResponse } from "@contract/git";
import type { PaneRow, Repo } from "@contract/events";
import type { AskCountsResponse } from "@contract/ask";
import type { ReviewCountsResponse } from "@contract/review";
import type { DecisionCounts } from "@contract/decision";
import { makeFakeStore, renderWithRouter } from "@/testing/renderWithRouter";
import { ToolPane } from "./ToolPane";

function counts(overrides: Partial<ReviewCountsResponse> = {}): ReviewCountsResponse {
  return {
    byCommit: {},
    worktree: { unresolved: 0, drafts: 0 },
    pendingDrafts: 0,
    replied: 0,
    ...overrides,
  };
}

function askCounts(overrides: Partial<AskCountsResponse> = {}): AskCountsResponse {
  return { unresolved: 0, byPath: {}, replied: 0, ...overrides };
}

function decisionCounts(overrides: Partial<DecisionCounts> = {}): DecisionCounts {
  return { total: 0, ...overrides };
}

function pane(overrides: Partial<PaneRow> = {}): PaneRow {
  return {
    paneId: "p1",
    workspaceId: "w1",
    workspaceLabel: "workspace 1",
    tabId: "t1",
    tabLabel: "tab 1",
    label: null,
    agent: "claude",
    agentStatus: "idle",
    terminalTitleStripped: null,
    focused: false,
    cwd: null,
    foregroundCwd: null,
    ...overrides,
  };
}

/** `repos` fixture: a single repo with one worktree at `root` holding `panes`. */
function reposWithPanes(root: string, panes: PaneRow[]): Repo[] {
  return [
    {
      key: `${root}/.git`,
      name: "project",
      worktrees: [{ root, branch: "main", isMain: true, panes }],
      counts: { blocked: 0, done: 0 },
    },
  ];
}

function focusMessage(overrides: Partial<FocusMessage> = {}): FocusMessage {
  return {
    type: "focus",
    pane: "p1",
    workspace: "w1",
    cwd: "/repo",
    foregroundCwd: "/repo",
    worktreeRoot: "/Users/dev/project",
    repoKey: null,
    agent: null,
    agentStatus: null,
    agentSession: null,
    ...overrides,
  };
}

/** worktreeRoot に追従する `/focus/diff` を、その worktree/repoKey/repos で
 * フォーカス中として描画する（旧テストの `worktreeRoot`/`repoKey`/`repos` prop
 * に相当）。 */
async function renderFocused(
  opts: {
    worktreeRoot?: string | null;
    repoKey?: string | null;
    repos?: Repo[];
    focusOverrides?: Partial<FocusMessage>;
    path?: string;
  } = {},
) {
  const {
    worktreeRoot = "/Users/dev/project",
    repoKey = null,
    repos = [],
    focusOverrides,
    path = "/focus/diff",
  } = opts;
  const store = makeFakeStore({
    repos,
    focus:
      worktreeRoot === null ? null : focusMessage({ worktreeRoot, repoKey, ...focusOverrides }),
  });
  return { ...(await renderWithRouter(() => <ToolPane />, { path, store })), store };
}

// Radix `Tabs.Trigger` activates on `mousedown`, not `click` (see
// @radix-ui/react-tabs) — `fireEvent.click` alone never dispatches a
// `mousedown`, so switching tabs in jsdom needs this helper. Tab switches
// navigate the router (async), so wait for the trigger to actually become
// the active tab before returning.
async function selectTab(name: string) {
  const trigger = screen.getByRole("tab", { name: new RegExp(`^${name}`) });
  fireEvent.mouseDown(trigger);
  await waitFor(() => expect(trigger).toHaveAttribute("data-state", "active"));
}

let diffPanelMountCount = 0;
vi.mock("@/components/diff/DiffPanel", () => ({
  DiffPanel: ({
    repo,
    from,
    to,
    sendButton,
    initialLocation,
  }: {
    repo: string;
    from?: string;
    to?: string;
    sendButton?: React.ReactNode;
    initialLocation?: { path: string; line: number; side: string } | null;
  }) => {
    useEffect(() => {
      diffPanelMountCount += 1;
    }, []);
    return (
      <div data-testid="diff-panel-stub">
        {repo}:{from ?? "WORKTREE"}:{to ?? "HEAD"}
        {sendButton}
        {initialLocation && (
          <span data-testid="diff-panel-initial-location">
            {initialLocation.path}:{initialLocation.line}:{initialLocation.side}
          </span>
        )}
      </div>
    );
  },
}));

vi.mock("@/components/files/FilesPanel", () => ({
  FilesPanel: ({
    repo,
    initialLocation,
    onInitialLocationConsumed,
  }: {
    repo: string;
    initialLocation?: { path: string; line: number } | null;
    onInitialLocationConsumed?: () => void;
  }) => (
    <div data-testid="files-panel-stub">
      {repo}
      {initialLocation && (
        <>
          <span data-testid="files-panel-initial-location">
            {initialLocation.path}:{initialLocation.line}
          </span>
          <button type="button" onClick={onInitialLocationConsumed}>
            consume
          </button>
        </>
      )}
    </div>
  ),
}));

vi.mock("@/components/graph/GraphPanel", () => ({
  GraphPanel: ({
    repo,
    onSelectCommit,
    onOpenFile,
    reviewCounts,
  }: {
    repo: string;
    onSelectCommit: (range: { from: string; to: string } | null) => void;
    onOpenFile?: (range: { from?: string; to: string }, path: string) => void;
    reviewCounts?: ReviewCountsResponse | null;
  }) => (
    <>
      <button
        type="button"
        data-testid="graph-panel-stub"
        onClick={() => onSelectCommit({ from: "aaa111", to: "bbb222" })}
      >
        graph:{repo}:{reviewCounts ? reviewCounts.pendingDrafts : "null"}
      </button>
      <button
        type="button"
        data-testid="graph-panel-open-file-root"
        onClick={() => onOpenFile?.({ to: "ccc333" }, "src/root.ts")}
      >
        open file (root commit)
      </button>
      <button
        type="button"
        data-testid="graph-panel-open-file"
        onClick={() => onOpenFile?.({ from: "aaa111", to: "bbb222" }, "src/a.ts")}
      >
        open file
      </button>
    </>
  ),
}));

vi.mock("@/components/decision/DecisionListView", () => ({
  DecisionListView: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" data-testid="decision-list-stub" onClick={() => onSelect("d1")}>
      decisions list
    </button>
  ),
}));

vi.mock("@/components/decision/DecisionView", () => ({
  DecisionView: ({ id, onClose }: { id: string; onClose?: () => void }) => (
    <div data-testid="decision-view-stub">
      decision:{id}
      <button type="button" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

const countsMock = vi.fn(async (..._args: unknown[]) => counts());
const askCountsMock = vi.fn(async (..._args: unknown[]) => askCounts());
const decisionCountsMock = vi.fn(async (..._args: unknown[]) => decisionCounts());
const sendMock = vi.fn(async (..._args: unknown[]) => ({ reviews: [] }));
const subreposMock = vi.fn(async (repo: string): Promise<SubReposResponse> => ({
  repos: [{ id: "", name: repo.split("/").pop() ?? repo, root: repo, kind: "root" }],
}));
const panePreviewMock = vi.fn(async (..._args: [string]) => new Promise(() => {}));

const { SendTargetError } = vi.hoisted(() => {
  class SendTargetErrorImpl extends Error {
    type: "no_agent" | "ambiguous_target" | "invalid_target";
    targets?: string[];
    constructor(type: "no_agent" | "ambiguous_target" | "invalid_target", targets?: string[]) {
      super(type);
      this.type = type;
      this.targets = targets;
    }
  }
  return { SendTargetError: SendTargetErrorImpl };
});

vi.mock("@/lib/api", () => ({
  gitApi: {
    root: vi.fn(async (path: string) => ({
      root: path,
      commonDir: `${path}/.git`,
      branch: "main",
      isMain: true,
      head: "abc123",
      rootCommit: "abc123",
    })),
    subrepos: (...args: [string]) => subreposMock(...args),
  },
  reviewApi: {
    counts: (...args: unknown[]) => countsMock(...args),
    send: (...args: unknown[]) => sendMock(...args),
  },
  askApi: {
    counts: (...args: unknown[]) => askCountsMock(...args),
  },
  decisionApi: {
    counts: (...args: unknown[]) => decisionCountsMock(...args),
  },
  herdrApi: {
    panePreview: (...args: [string]) => panePreviewMock(...args),
  },
  SendTargetError,
}));

describe("ToolPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    diffPanelMountCount = 0;
  });

  // 無いと壊れる: focus 追従中に worktree が切り替わっても DiffPanel が使い回され、
  // 前の worktree の annotation/選択が残る。
  test("remounts DiffPanel (fresh instance) when worktreeRoot changes, but not for a repoChangedTick bump alone", async () => {
    const repoKey = "/Users/dev/project-a/.git";
    const { store } = await renderFocused({ worktreeRoot: "/Users/dev/project-a", repoKey });
    expect(diffPanelMountCount).toBe(1);

    store.setState({ focus: focusMessage({ worktreeRoot: "/Users/dev/project-b", repoKey }) });
    await waitFor(() =>
      expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
        "/Users/dev/project-b:WORKTREE:HEAD",
      ),
    );
    expect(diffPanelMountCount).toBe(2);

    countsMock.mockClear();
    store.setState({ repoChanged: { "/Users/dev/project-b": { head: "h", tick: 1 } } });
    await waitFor(() => expect(countsMock).toHaveBeenCalled());
    expect(diffPanelMountCount).toBe(2);
  });

  // レビュー指摘（High 1）: worktree 未選択でも Decisions は worktree 横断で
  // 動くはずなので、タブ列自体は常に描画し、観察タブの中身だけ空状態にする。
  // 無いと壊れる: 起動直後や全 pane クローズ後、Decisions タブへ到達できない。
  test("shows the tab list and an empty-worktree notice in observation tabs when no worktree is selected (F2-3)", async () => {
    await renderFocused({ worktreeRoot: null });
    expect(screen.getAllByText("herdr 未接続 / worktree 未選択").length).toBeGreaterThan(0);
    const tabs = screen.getAllByRole("tab").map((el) => el.textContent);
    expect(tabs).toEqual(["Files", "Graph", "Diff", "Decisions", "Process", "Compose"]);
    expect(screen.queryByTestId("diff-panel-stub")).not.toBeInTheDocument();
  });

  // ui-redesign.md D5: Navigator のフォーカス行と Tool header を同じ色で結ぶ。
  // 無いと壊れる: worktree 未選択でもアクセントが出続け、フォーカス移動の視覚的
  // 手がかりが常時表示されて意味を失う。
  test.each([
    ["a worktree is focused", "/Users/dev/project", "var(--focus)"],
    ["no worktree is focused", null, "transparent"],
  ])("tool header accent bar reflects focus (%s)", async (_label, worktreeRoot, expected) => {
    await renderFocused({ worktreeRoot });
    expect(screen.getByTestId("tool-header").getAttribute("style")).toContain(
      `border-left: 3px solid ${expected}`,
    );
  });

  test("Decisions tab works with no worktree selected", async () => {
    await renderFocused({ worktreeRoot: null });
    await selectTab("Decisions");
    expect(screen.getByTestId("decision-list-stub")).toBeInTheDocument();
  });

  // ui-redesign.md §5.4: タブは Files/Graph/Diff/Decisions/Process/Compose の
  // 順。無いと壊れる: 並びがずれる、あるいは旧 Docker タブが残る/消える。
  test("shows the worktree header and tabs in the Files/Graph/Diff/Decisions/Process/Compose order", async () => {
    await renderFocused();
    expect(screen.getByText("project")).toBeInTheDocument();
    expect(screen.getByText("/Users/dev/project")).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab").map((el) => el.textContent);
    expect(tabs).toEqual(["Files", "Graph", "Diff", "Decisions", "Process", "Compose"]);
    expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
      "/Users/dev/project:WORKTREE:HEAD",
    );
  });

  test("switching to the Files tab renders FilesPanel with the current repo", async () => {
    await renderFocused();
    await selectTab("Files");
    expect(screen.getByTestId("files-panel-stub")).toHaveTextContent("/Users/dev/project");
  });

  test("navigating straight to the files tab with path/line passes the location down to FilesPanel, and consuming it drops line only", async () => {
    const store = makeFakeStore({ focus: focusMessage() });
    const { router } = await renderWithRouter(() => <ToolPane />, {
      path: "/focus/files?path=src%2Fa.ts&line=42",
      store,
    });
    expect(screen.getByRole("tab", { name: /^Files/ })).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("files-panel-initial-location")).toHaveTextContent("src/a.ts:42");

    fireEvent.click(screen.getByRole("button", { name: "consume" }));
    await waitFor(() =>
      expect(screen.queryByTestId("files-panel-initial-location")).not.toBeInTheDocument(),
    );
    expect(router.state.location.search).not.toHaveProperty("line");
    expect(router.state.location.search).toMatchObject({ path: "src/a.ts" });
  });

  // 実走で見つかった不具合: `/focus/files?path=...&line=...` を直接開く
  // （リロード）と、herdr の focus はまだ null（未解決）で、そこから実値に
  // 変わる遷移が「worktree の切り替え」と誤認されて path/line が落ちていた。
  // 無いと壊れる: 直接開き・リロードのたびにファイル選択が失われる。
  test("opening the files tab directly with path/line, before focus resolves, keeps them once focus catches up", async () => {
    const store = makeFakeStore({ focus: null });
    await renderWithRouter(() => <ToolPane />, {
      path: "/focus/files?path=README.md&line=3",
      store,
    });
    expect(screen.queryByTestId("files-panel-initial-location")).not.toBeInTheDocument();

    store.setState({ focus: focusMessage() });
    await waitFor(() =>
      expect(screen.getByTestId("files-panel-initial-location")).toHaveTextContent("README.md:3"),
    );
  });

  // 上のケースと対比: 実値 A → 実値 B の切り替えは従来どおり search を落とす
  // （前の worktree のジャンプ先を新しい worktree に持ち越さない）。
  test("switching from one resolved worktree to another still drops path/line", async () => {
    const store = makeFakeStore({ focus: focusMessage({ worktreeRoot: "/Users/dev/project" }) });
    await renderWithRouter(() => <ToolPane />, {
      path: "/focus/files?path=README.md&line=3",
      store,
    });
    expect(screen.getByTestId("files-panel-initial-location")).toHaveTextContent("README.md:3");

    store.setState({ focus: focusMessage({ worktreeRoot: "/Users/dev/other" }) });
    await waitFor(() =>
      expect(screen.queryByTestId("files-panel-initial-location")).not.toBeInTheDocument(),
    );
  });

  // 無いと壊れる: old 側にアンカーされた review へジャンプしても search の side が
  // 通らないと ToolPane が既定の "new" にフォールバックし、無関係な行を開く
  // （Inbox の replied レビュー行導線、docs/ui-redesign.md §5.4）。
  test.each([
    ["old", "old"],
    ["new", "new"],
    [undefined, "new"],
  ] as const)(
    "navigating to the diff tab with path/line/side=%s passes side=%s down to DiffPanel",
    async (side, expectedSide) => {
      const store = makeFakeStore({ focus: focusMessage() });
      const query = side ? `path=a.ts&line=10&side=${side}` : "path=a.ts&line=10";
      await renderWithRouter(() => <ToolPane />, { path: `/focus/diff?${query}`, store });
      expect(screen.getByTestId("diff-panel-initial-location")).toHaveTextContent(
        `a.ts:10:${expectedSide}`,
      );
    },
  );

  test("selecting a commit in the graph tab sets the diff comparison and shows a reset button", async () => {
    await renderFocused();
    await selectTab("Graph");
    fireEvent.click(screen.getByTestId("graph-panel-stub"));
    await selectTab("Diff");

    expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
      "/Users/dev/project:aaa111:bbb222",
    );
    const resetButton = screen.getByRole("button", { name: "作業ツリーに戻る" });
    fireEvent.click(resetButton);
    await waitFor(() =>
      expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
        "/Users/dev/project:WORKTREE:HEAD",
      ),
    );
  });

  // ui-redesign.md §5.4: Graph のファイル行クリックは Diff タブへ遷移し、
  // そのファイルまでスクロールする（initialLocation は path だけ、line 無し）。
  test("clicking a file row under a commit jumps to the diff tab at that file", async () => {
    await renderFocused();
    await selectTab("Graph");
    fireEvent.click(screen.getByTestId("graph-panel-open-file"));

    expect(await screen.findByTestId("diff-panel-stub")).toHaveTextContent(
      "/Users/dev/project:aaa111:bbb222",
    );
    expect(screen.getByTestId("diff-panel-initial-location")).toHaveTextContent("src/a.ts::");
  });

  // 無いと壊れる: ルートコミット（parent 無し）のファイル行クリックが
  // "from" を要求すると、範囲が組めず遷移そのものが失われる。
  test("clicking a file row under a root commit (no parent) still jumps, with no comparison base", async () => {
    await renderFocused();
    await selectTab("Graph");
    fireEvent.click(screen.getByTestId("graph-panel-open-file-root"));

    await screen.findByTestId("diff-panel-stub");
    expect(screen.getByTestId("diff-panel-initial-location")).toHaveTextContent("src/root.ts::");
  });

  // D9: エージェント非依存。無いと壊れる: session 表示が claude 固有の
  // コマンド文言に戻ると、他エージェントで意味のないボタンが出る。
  test("shows a generic session copy button (not a Claude-specific command) for any agent with an id-kind session", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    await renderFocused({
      focusOverrides: {
        agent: "codex",
        agentStatus: "working",
        agentSession: { source: "herdr:codex", agent: "codex", kind: "id", value: "abcdefgh1234" },
      },
    });
    expect(screen.getByText("codex · working")).toBeInTheDocument();
    const copyButton = screen.getByRole("button", { name: "session abcd…1234" });
    fireEvent.click(copyButton);
    expect(writeText).toHaveBeenCalledWith("abcdefgh1234");
  });

  test("does not show a session copy button for a non-id-kind session", async () => {
    await renderFocused({
      focusOverrides: {
        agent: "codex",
        agentStatus: "idle",
        agentSession: { source: "herdr:codex", agent: "codex", kind: "path", value: "/tmp/x" },
      },
    });
    expect(screen.getByText("codex · idle")).toBeInTheDocument();
    expect(screen.queryByText(/^session /)).not.toBeInTheDocument();
  });

  // ui-redesign.md §5.3: worktree 見出し行にブランチを出す。
  test("shows the worktree's branch next to its basename", async () => {
    await renderFocused();
    expect(await screen.findByText("main")).toBeInTheDocument();
  });

  // 無いと壊れる: focus 追従中に worktree が切り替わったのに前の比較範囲が
  // 残ると、新しい worktree に存在しないハッシュで diff を取りに行ってしまう。
  test("switching worktreeRoot resets a picked commit comparison back to the working tree", async () => {
    const { store } = await renderFocused({ worktreeRoot: "/Users/dev/project-a" });
    await selectTab("Graph");
    fireEvent.click(screen.getByTestId("graph-panel-stub"));
    await selectTab("Diff");
    expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
      "/Users/dev/project-a:aaa111:bbb222",
    );

    store.setState({ focus: focusMessage({ worktreeRoot: "/Users/dev/project-b" }) });
    await waitFor(() =>
      expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
        "/Users/dev/project-b:WORKTREE:HEAD",
      ),
    );
  });

  describe("tab badges", () => {
    // ui-redesign.md §5.4: Diff=replied レビュー数、Files=replied 質問数、
    // Decisions=未回答件数。無いと壊れる: 返信/依頼が来ても気づく場所が無くなる。
    test("shows the replied review count on Diff and the replied ask count on Files", async () => {
      countsMock.mockResolvedValueOnce(counts({ replied: 3 }));
      askCountsMock.mockResolvedValueOnce(askCounts({ replied: 2 }));
      await renderFocused({ repoKey: "/Users/dev/project/.git" });
      const diffTab = await screen.findByRole("tab", { name: /^Diff/ });
      await waitFor(() => expect(diffTab).toHaveTextContent("3"));
      const filesTab = screen.getByRole("tab", { name: /^Files/ });
      await waitFor(() => expect(filesTab).toHaveTextContent("2"));
    });

    test("shows the decision total count on Decisions, worktree-crossing", async () => {
      decisionCountsMock.mockResolvedValueOnce(decisionCounts({ total: 5 }));
      await renderFocused();
      const decisionsTab = await screen.findByRole("tab", { name: /^Decisions/ });
      await waitFor(() => expect(decisionsTab).toHaveTextContent("5"));
    });

    test("shows no badge digits when counts are 0", async () => {
      await renderFocused();
      const diffTab = await screen.findByRole("tab", { name: /^Diff/ });
      expect(diffTab).toHaveTextContent("Diff");
      expect(diffTab.textContent).toBe("Diff");
    });
  });

  describe("decisions tab", () => {
    // ui-redesign.md §5.4: decisions タブは ToolPane の TabsContent 内に描く
    // （別ルートのプッシュではない）。無いと壊れる: 判断依頼を開いても
    // タブ・比較範囲を保った ToolPane がアンマウントされてしまう。
    test("shows the list without an id search param, and the detail view once one is selected", async () => {
      const { router } = await renderFocused();
      await selectTab("Decisions");
      expect(screen.getByTestId("decision-list-stub")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("decision-list-stub"));
      await waitFor(() => expect(screen.getByTestId("decision-view-stub")).toHaveTextContent("d1"));
      expect(router.state.location.search).toMatchObject({ id: "d1" });

      fireEvent.click(screen.getByRole("button", { name: "close" }));
      await waitFor(() => expect(screen.getByTestId("decision-list-stub")).toBeInTheDocument());
      expect(router.state.location.search).not.toHaveProperty("id");
    });

    // 無いと壊れる: id が decisions 専用のはずが他タブへ引き継がれ、無関係な
    // タブが判断依頼の id を URL に残し続けてしまう。
    test("switching away from the decisions tab drops the id search param", async () => {
      const { router } = await renderFocused({ path: "/focus/decisions?id=d1" });
      expect(screen.getByTestId("decision-view-stub")).toBeInTheDocument();
      await selectTab("Diff");
      expect(router.state.location.search).not.toHaveProperty("id");
    });
  });

  describe("send drafts button (in the Diff tab)", () => {
    // 無いと壊れる: Diff タブに送信ボタンの置き場所が無くなる（ui-redesign.md
    // §5.4: DiffPanel の Toolbar 右端）。個々のボタンの挙動は
    // SendDraftsButton.test.tsx が持つので、ここでは配線だけ確認する。
    test("renders nothing when there are no pending drafts", async () => {
      countsMock.mockResolvedValueOnce(counts({ pendingDrafts: 0 }));
      await renderFocused({ repoKey: "/Users/dev/project/.git" });
      await waitFor(() => expect(countsMock).toHaveBeenCalled());
      expect(screen.queryByRole("button", { name: /^送信/ })).not.toBeInTheDocument();
    });

    test("sends via reviewApi with the resolved repo/worktree and a single agent pane", async () => {
      countsMock.mockResolvedValueOnce(counts({ pendingDrafts: 2 }));
      await renderFocused({
        repoKey: "/Users/dev/project/.git",
        repos: reposWithPanes("/Users/dev/project", [pane({ paneId: "claude-1" })]),
      });
      const button = await screen.findByRole("button", { name: "送信 (2)" });
      fireEvent.click(button);
      await waitFor(() =>
        expect(sendMock).toHaveBeenCalledWith({
          repo: "/Users/dev/project/.git",
          worktreeRoot: "/Users/dev/project",
          pane: "claude-1",
        }),
      );
    });
  });

  describe("sub-repo switcher", () => {
    test("does not show the select when there's only one entry (the root)", async () => {
      await renderFocused();
      await waitFor(() => expect(subreposMock).toHaveBeenCalledWith("/Users/dev/project"));
      expect(
        screen.queryByRole("combobox", { name: "サブリポジトリを選択" }),
      ).not.toBeInTheDocument();
    });

    test("shows the select with >1 entries; switching updates the repo/repoKey passed to Diff/Graph panels, and the header path", async () => {
      subreposMock.mockResolvedValueOnce({
        repos: [
          { id: "", name: "project", root: "/Users/dev/project", kind: "root" as const },
          {
            id: "vendor/lib",
            name: "lib",
            root: "/Users/dev/project/vendor/lib",
            kind: "submodule" as const,
          },
        ],
      });
      await renderFocused({ repoKey: "/Users/dev/project/.git" });

      const trigger = await screen.findByRole("combobox", { name: "サブリポジトリを選択" });
      expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
        "/Users/dev/project:WORKTREE:HEAD",
      );

      fireEvent.click(trigger);
      const option = await screen.findByRole("option", { name: /lib/ });
      fireEvent.click(option);

      // repo passed to DiffPanel follows the selected sub-repo's root.
      await waitFor(() =>
        expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
          "/Users/dev/project/vendor/lib:WORKTREE:HEAD",
        ),
      );
      // header path shows <worktree>/<subrepo>
      expect(screen.getByText("/Users/dev/project/vendor/lib")).toBeInTheDocument();

      await selectTab("Graph");
      expect(screen.getByTestId("graph-panel-stub")).toHaveTextContent(
        "graph:/Users/dev/project/vendor/lib",
      );
    });

    // レビュー指摘（Medium 3）: FilesPanel は ask の作成/for-file に
    // `{ repo: repoKey, worktreeRoot: repo(=subRepoRoot) }` を使う。useAskCounts
    // にも同じ組を渡さないと、サブリポジトリ選択中は常に 0 になる。
    test("Files badge follows the selected sub-repo's root, not the worktree root", async () => {
      subreposMock.mockResolvedValueOnce({
        repos: [
          { id: "", name: "project", root: "/Users/dev/project", kind: "root" as const },
          {
            id: "vendor/lib",
            name: "lib",
            root: "/Users/dev/project/vendor/lib",
            kind: "submodule" as const,
          },
        ],
      });
      askCountsMock.mockImplementation(async (...args: unknown[]) => {
        const params = args[0] as { repo: string; worktree: string };
        return params.worktree === "/Users/dev/project/vendor/lib"
          ? askCounts({ replied: 4 })
          : askCounts();
      });
      await renderFocused({ repoKey: "/Users/dev/project/.git" });

      const trigger = await screen.findByRole("combobox", { name: "サブリポジトリを選択" });
      fireEvent.click(trigger);
      const option = await screen.findByRole("option", { name: /lib/ });
      fireEvent.click(option);

      const filesTab = await screen.findByRole("tab", { name: /^Files/ });
      await waitFor(() => expect(filesTab).toHaveTextContent("4"));
    });

    test("resets the sub-repo selection back to the worktree root when worktreeRoot changes", async () => {
      subreposMock.mockResolvedValueOnce({
        repos: [
          { id: "", name: "project-a", root: "/Users/dev/project-a", kind: "root" as const },
          {
            id: "vendor/lib",
            name: "lib",
            root: "/Users/dev/project-a/vendor/lib",
            kind: "submodule" as const,
          },
        ],
      });
      const { store } = await renderFocused({ worktreeRoot: "/Users/dev/project-a" });
      const trigger = await screen.findByRole("combobox", { name: "サブリポジトリを選択" });
      fireEvent.click(trigger);
      const option = await screen.findByRole("option", { name: /lib/ });
      fireEvent.click(option);
      await waitFor(() =>
        expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
          "/Users/dev/project-a/vendor/lib:WORKTREE:HEAD",
        ),
      );

      // subreposMock's default implementation (single root entry) applies
      // to project-b, since the queued mockResolvedValueOnce above was
      // already consumed by the mount above.
      store.setState({ focus: focusMessage({ worktreeRoot: "/Users/dev/project-b" }) });
      await waitFor(() =>
        expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
          "/Users/dev/project-b:WORKTREE:HEAD",
        ),
      );
      expect(
        screen.queryByRole("combobox", { name: "サブリポジトリを選択" }),
      ).not.toBeInTheDocument();
    });
  });
});
