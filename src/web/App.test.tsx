import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory } from "@tanstack/react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ServerEventMessage } from "@contract/events";
import type { InboxResponse } from "@contract/inbox";
import { decisionApi } from "@/lib/api";
import { App } from "./App";
import { createAppRouter } from "./router";

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
  DiffPanel: ({ repo, from, to }: { repo: string; from?: string; to?: string }) => (
    <div data-testid="diff-panel-stub">
      {repo}:{from ?? "HEAD"}:{to ?? "WORKTREE"}
    </div>
  ),
}));
vi.mock("@/components/graph/GraphPanel", () => ({
  GraphPanel: () => <div data-testid="graph-panel-stub" />,
}));
vi.mock("@/components/files/FilesPanel", () => ({
  FilesPanel: ({ repo, selectedPath }: { repo: string; selectedPath?: string | null }) => (
    <div data-testid="files-panel-stub">
      {repo}:{selectedPath ?? ""}
    </div>
  ),
}));

vi.mock("@/lib/api", () => ({
  configApi: {
    get: vi.fn(async () => ({
      terminal: { fontFamily: "monospace", fontSize: 13, lineHeight: 1 },
      graphInitialCommits: 200,
      ask: { agents: ["claude", "codex", "gemini"], defaultAgent: "claude", maxSessions: 5 },
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
    subrepos: vi.fn(async (repo: string) => ({
      repos: [
        {
          id: "",
          name: repo.split("/").pop() ?? repo,
          root: repo,
          kind: "root" as const,
          worktrees: [{ root: repo, branch: "main", head: "abc123", isMain: true }],
        },
      ],
    })),
  },
  reviewApi: {
    list: vi.fn(async () => []),
    counts: vi.fn(async () => ({
      byCommit: {},
      worktree: { unresolved: 0, replied: 0, drafts: 0 },
      pendingDrafts: 0,
      replied: { worktree: 0, commit: 0 },
    })),
  },
  askApi: {
    counts: vi.fn(async () => ({ unresolved: 0, byPath: {}, replied: 0 })),
  },
  herdrApi: {
    setToolTab: vi.fn(async (workspaceId: string, body: { tab: string }) => ({
      toolTab: { workspaceId, tab: body.tab, updatedAt: new Date().toISOString() },
    })),
  },
  inboxApi: {
    get: (params: { worktree?: string }) => inboxGetMock(params),
  },
  decisionApi: {
    counts: vi.fn(async () => ({ total: 2 })),
    list: vi.fn(async () => [
      decisionFixture("d1", "/Users/dev/project", "依頼A"),
      decisionFixture("d2", "/Users/dev/other", "依頼B"),
    ]),
    get: vi.fn(async (id: string) =>
      decisionFixture(id, "/Users/dev/other", "依頼A", [
        { kind: "location", path: "src/other.ts", lines: null },
      ]),
    ),
  },
}));

function decisionFixture(id: string, worktreeRoot: string, title: string, context: unknown[] = []) {
  return {
    id,
    status: "open",
    spec: {
      title,
      context,
      items: [
        {
          id: "q1",
          header: "h",
          question: "q?",
          kind: "text",
          options: [],
          allowOther: true,
          required: true,
        },
      ],
      layout: null,
    },
    answer: null,
    paneId: null,
    claudeSessionId: null,
    worktreeRoot,
    repoKey: null,
    agent: "claude",
    createdAt: "2026-01-01T00:00:00.000Z",
    answeredAt: null,
    delivery: null,
  };
}

type EventsHandlers = {
  onMessage: (message: ServerEventMessage) => void;
  onStatus?: (status: string) => void;
};

const sendMock = vi.fn();
const closeMock = vi.fn();
const handlersLog: EventsHandlers[] = [];
const inboxGetMock = vi.fn<(params: { worktree?: string }) => Promise<InboxResponse>>(async () => ({
  items: [],
  counts: { total: 0, bySection: {} } as never,
}));

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
    subRepo: null,
    selectionIsDefault: true,
    toolTab: null,
    ...overrides,
  } as ServerEventMessage;
}

/** 実アプリと同じルート構成（router.tsx）をメモリ履歴で描画する。`path` は
 * ブラウザで直接そのURLを開いた（＝リロードした）ときの初期表示に相当する。
 * WS 接続は既定で open まで進める — 未接続時の振る舞いを検証するテストは
 * `latestHandlers().onStatus?.(...)` で個別に上書きする。 */
async function renderApp(path = "/") {
  const queryClient = new QueryClient();
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  await router.load();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <App router={router} />
    </QueryClientProvider>,
  );
  act(() => {
    latestHandlers().onStatus?.("open");
  });
  return { ...utils, router };
}

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    sendMock.mockClear();
    closeMock.mockClear();
    handlersLog.length = 0;
    inboxGetMock.mockClear();
    inboxGetMock.mockResolvedValue({ items: [], counts: { total: 0, bySection: {} } as never });
  });

  test("renders the three-column layout skeleton", async () => {
    await renderApp();
    expect(screen.getByLabelText("サイドバー")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-stub")).toBeInTheDocument();
    expect(screen.getByText("herdr 未接続 / worktree 未選択")).toBeInTheDocument();
    expect(screen.getAllByRole("separator").length).toBeGreaterThan(0);
  });

  // 実走で見つかった不具合: TanStack Router の search は JSON で直列化される
  // ため、`?inbox=1` を直接開く（＝リロード）と生の文字列 "1" ではなく数値 1
  // が渡る。`v.literal("1")` だと検証落ちして Inbox が開かなかった。
  test("opening a URL with ?inbox=1 directly (a reload) shows the Inbox dialog open", async () => {
    await renderApp("/focus/diff?inbox=1");
    expect(screen.getByTestId("inbox-dialog")).toBeInTheDocument();
  });

  test("collapsing the tool area hides its content and its divider", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "ツール領域を折りたたむ" }));
    // ツールルートは `hidden` で隠すだけでアンマウントしない。
    expect(screen.getByText("herdr 未接続 / worktree 未選択")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "ツール領域を開く" })).toBeInTheDocument();
  });

  test("persists the collapsed state to localStorage", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "ツール領域を折りたたむ" }));
    const stored = JSON.parse(localStorage.getItem("herdr-web:layout") ?? "{}");
    expect(stored.toolCollapsed).toBe(true);
  });

  // レビュー指摘（High 2）: ⌘⇧M でツールを最大化しても Terminal は PTY 接続を
  // 保つため常にマウントされたままのはず。無いと壊れる: レールを JSX 分岐で
  // 描くと `<Terminal>` 自体が消え、最大化のたびに PTY 接続がやり直しになる。
  test("maximizing the tool area with ⌘⇧M does not unmount the terminal", async () => {
    await renderApp();
    expect(screen.getByTestId("terminal-stub")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "m", metaKey: true, shiftKey: true });
    expect(screen.getByTestId("terminal-stub")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ターミナルに戻す" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "m", metaKey: true, shiftKey: true });
    expect(screen.getByTestId("terminal-stub")).toBeInTheDocument();
  });

  test("a focus message switches the displayed worktree in the tool pane", async () => {
    await renderApp();
    emit(focusMessage());
    expect(screen.getByText("project")).toBeInTheDocument();
    expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent("/Users/dev/project");
    expect(screen.getByText("claude · working")).toBeInTheDocument();
  });

  test("a later focus message follows to the new worktree", async () => {
    await renderApp();
    emit(focusMessage());
    emit(focusMessage({ worktreeRoot: "/Users/dev/other", repoKey: "/Users/dev/other/.git" }));
    expect(screen.getByText("other")).toBeInTheDocument();
  });

  test("clicking a sidebar workspace row sends focus-pane", async () => {
    await renderApp();
    // Navigator は herdr 未接続時ツリーの代わりに空状態を出す (ui-redesign.md
    // §5.2) — このテストが見るのはツリーの中身なので、接続済みにしておく。
    emit({ type: "herdr", connected: true, protocol: 20 });
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

  // 無いと壊れる: Decisions タブを押しても、フォーカス中の worktree に
  // 依頼を絞り込んで API を呼ばず、無関係な worktree の依頼まで混ざって
  // 出てしまう (ui-redesign.md §5.4)。
  test("clicking the Decisions tab lists decisions scoped to the focused worktree", async () => {
    await renderApp();
    emit(focusMessage());
    fireEvent.mouseDown(screen.getByRole("tab", { name: /^Decisions/ }));
    expect(await screen.findByText("依頼A")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Decisions/ })).toHaveAttribute("data-state", "active");
    expect(decisionApi.list).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeRoot: "/Users/dev/project" }),
    );
  });

  // 無いと壊れる: herdr の focus が無い（起動直後・全 pane クローズ後）状態で
  // Decisions タブを押しても、タブ自体は出るが中身が空状態のまま止まらない
  // ことを確認する — worktree が解決するまでは他タブと同じ空状態を出す。
  test("the Decisions tab shows the empty-worktree notice with no herdr focus at all", async () => {
    await renderApp();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /^Decisions/ }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /^Decisions/ })).toHaveAttribute(
        "data-state",
        "active",
      ),
    );
    expect(screen.getByText("worktree を解決できません")).toBeInTheDocument();
  });

  // F14-7 の振る舞いテスト（URL が画面状態の正であることの確認）。
  describe("routing (plan.md F14-7)", () => {
    // 無いと壊れる: URL が画面状態を持たないと、ブラウザの戻る/進むが完全な
    // no-op になり、判断依頼を開いて戻るとツール領域ごと消えるなどの事故が起きる。
    test("browser back/forward switches the active tab, including the Decisions tab", async () => {
      const { router } = await renderApp();
      emit(focusMessage());
      expect(screen.getByRole("tab", { name: "Diff" })).toHaveAttribute("data-state", "active");

      fireEvent.mouseDown(screen.getByRole("tab", { name: "Files" }));
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("data-state", "active"),
      );

      fireEvent.mouseDown(screen.getByRole("tab", { name: /^Decisions/ }));
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: /^Decisions/ })).toHaveAttribute(
          "data-state",
          "active",
        ),
      );

      router.history.back();
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("data-state", "active"),
      );

      router.history.back();
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "Diff" })).toHaveAttribute("data-state", "active"),
      );

      router.history.forward();
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("data-state", "active"),
      );
    });

    // 無いと壊れる: 画面状態が React state にしかなければ、タブを開き直した
    // （＝リロードした）瞬間に選択タブや比較範囲が全部既定値に戻ってしまう。
    test("reloading (a fresh mount at the same URL) restores the same screen", async () => {
      const { router, unmount } = await renderApp();
      emit(focusMessage());
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Files" }));
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("data-state", "active"),
      );
      const href = router.history.location.href;
      unmount();

      // A reload discards all in-memory state and remounts against the same
      // URL — simulate that with a brand-new App/router pair at that href.
      const { router: reloaded } = await renderApp(href);
      expect(reloaded.state.location.pathname).toBe(router.state.location.pathname);
      emit(focusMessage());
      expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("data-state", "active");
    });

    // 無いと壊れる: 判断依頼ビューを開いて戻ると、それまで選んでいた commit
    // 比較（from/to）が消え、作業ツリー比較に巻き戻ってしまう。
    test("the diff comparison survives opening the decision view and going back", async () => {
      const { router } = await renderApp();
      emit(focusMessage());

      // A commit comparison picked in the Graph tab (see ToolPane's
      // openDiffFor) ends up as `from`/`to` search params on the diff route —
      // set it directly rather than depending on the GraphPanel stub.
      await router.navigate({
        to: "/focus/$tab",
        params: { tab: "diff" },
        search: { from: "aaa111", to: "bbb222" },
      });
      await waitFor(() =>
        expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
          "/Users/dev/project:aaa111:bbb222",
        ),
      );

      fireEvent.mouseDown(screen.getByRole("tab", { name: /^Decisions/ }));
      fireEvent.click(await screen.findByText("依頼A"));
      await screen.findByText("h"); // decision item header from the fixture

      // Two pushes got us here (tab click -> Decisions tab, row -> detail); back through both.
      router.history.back();
      router.history.back();
      await waitFor(() =>
        expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
          "/Users/dev/project:aaa111:bbb222",
        ),
      );
    });

    // 無いと壊れる: decisions タブから別タブへ切り替えると比較範囲や選択タブが
    // 失われ、レビュー中の commit 比較が作業ツリー比較に巻き戻ってしまう
    // （ui-redesign.md §5.4: decisions は ToolPane の通常タブなので、離れる操作は
    // 「閉じる」ボタンではなく他のタブへのクリックになる）。
    test("switching from the Decisions tab back to Diff (a plain tab click, not history.back) keeps the comparison", async () => {
      const root = "/Users/dev/project";
      const { router } = await renderApp();
      emit(focusMessage({ worktreeRoot: root, repoKey: `${root}/.git` }));
      await router.navigate({
        to: "/focus/$tab",
        params: { tab: "diff" },
        search: { from: "a", to: "b" },
      });
      await waitFor(() =>
        expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(`${root}:a:b`),
      );

      fireEvent.mouseDown(screen.getByRole("tab", { name: /^Decisions/ }));
      expect(await screen.findByText("依頼A")).toBeInTheDocument();

      fireEvent.mouseDown(screen.getByRole("tab", { name: "Diff" }));
      await waitFor(() =>
        expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(`${root}:a:b`),
      );
    });
  });

  // F14-4: ask/decision の「対象ファイルを開く」導線（ここでは判断依頼の
  // `location` context Block）— 対象 worktree が現在の focus と違えば、その
  // worktree の pane へ focus-pane を送ってから /focus/files へ navigate し、
  // focus が実際にその worktree へ切り替わってから search の `path` が有効になる
  // （`root` ゲートが落ちる）。無いと壊れる: この経路が無いと、別 worktree の
  // ファイルを開いても herdr のフォーカスが動かないか、まだ表示中の無関係な
  // worktree に対して存在しない path を即座に適用してしまう。
  test("opening a decision's location Block in a different worktree sends focus-pane, then applies the path once focus catches up", async () => {
    const { router } = await renderApp();
    // Currently focused on /Users/dev/project (so ToolPane shows tabs at
    // all) — the location Block below targets the *other* worktree.
    emit(focusMessage());
    emit({
      type: "tree",
      repos: [
        {
          key: "/Users/dev/other/.git",
          name: "other",
          counts: { blocked: 0, done: 0 },
          worktrees: [
            {
              root: "/Users/dev/other",
              branch: "main",
              isMain: true,
              panes: [
                {
                  paneId: "p-other",
                  workspaceId: "w-other",
                  workspaceLabel: "w-other",
                  tabId: "t-other",
                  tabLabel: null,
                  label: "session",
                  agent: "claude",
                  agentStatus: "working",
                  terminalTitleStripped: null,
                  focused: true,
                  cwd: "/Users/dev/other",
                  foregroundCwd: "/Users/dev/other",
                },
              ],
            },
          ],
        },
      ],
    });

    fireEvent.mouseDown(screen.getByRole("tab", { name: /^Decisions/ }));
    fireEvent.click(await screen.findByText("依頼A"));
    fireEvent.click(await screen.findByText("src/other.ts"));

    await waitFor(() =>
      expect(sendMock).toHaveBeenCalledWith({ type: "focus-pane", pane: "p-other" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("data-state", "active"),
    );
    // Navigated immediately, but gated: still showing /Users/dev/project's
    // tree (unaffected), and `root` is set because focus hasn't caught up yet.
    expect(screen.getByTestId("files-panel-stub")).toHaveTextContent("/Users/dev/project:");
    expect(router.state.location.search).toMatchObject({
      path: "src/other.ts",
      root: "/Users/dev/other",
    });

    emit(focusMessage({ worktreeRoot: "/Users/dev/other", repoKey: "/Users/dev/other/.git" }));
    await waitFor(() =>
      expect(screen.getByTestId("files-panel-stub")).toHaveTextContent(
        "/Users/dev/other:src/other.ts",
      ),
    );
    expect(router.state.location.search).not.toHaveProperty("root");
  });

  // 実走で見つかった不具合: InboxDialog の行クリックが navigate した直後に
  // onOpenChange(false) も呼ぶと、router.tsx の setInboxOpen がその場でまた
  // navigate してしまい、search はそのまま tab だけ元に戻る。
  describe("Inbox row clicks", () => {
    function emitOtherWorktreeTree() {
      emit({
        type: "tree",
        repos: [
          {
            key: "/Users/dev/other/.git",
            name: "other",
            counts: { blocked: 0, done: 0 },
            worktrees: [
              {
                root: "/Users/dev/other",
                branch: "main",
                isMain: true,
                panes: [
                  {
                    paneId: "p-other",
                    workspaceId: "w-other",
                    workspaceLabel: "w-other",
                    tabId: "t-other",
                    tabLabel: null,
                    label: "session",
                    agent: "claude",
                    agentStatus: "working",
                    terminalTitleStripped: null,
                    focused: true,
                    cwd: "/Users/dev/other",
                    foregroundCwd: "/Users/dev/other",
                  },
                ],
              },
            ],
          },
        ],
      });
    }

    // 無いと壊れる: この検証がないと、送信待ちの行を押しても Graph タブに
    // 留まったまま `root` だけ付き、レビュー下書きを送るための Diff に着地しない。
    test("clicking an unsent drafts row switches the tab to Diff and clears inbox from the URL", async () => {
      inboxGetMock.mockResolvedValue({
        items: [
          {
            section: "unsent",
            kind: "review",
            worktreeRoot: "/Users/dev/other",
            repoKey: "/Users/dev/other/.git",
            count: 2,
            at: "2026-01-01T00:00:00.000Z",
          },
        ],
        counts: { total: 1, bySection: { unsent: 1 } } as never,
      });
      const { router } = await renderApp("/focus/graph?inbox=1");
      emit(focusMessage());
      emitOtherWorktreeTree();

      fireEvent.click(await screen.findByText("送信待ち (2)"));

      await waitFor(() => expect(router.state.location.pathname).toBe("/focus/diff"));
      expect(router.state.location.search).toMatchObject({ root: "/Users/dev/other" });
      expect(router.state.location.search).not.toHaveProperty("inbox");
    });

    // 無いと壊れる: 返信が届いたレビュー行を押しても Graph タブのまま
    // `root` だけ付き、返信を読むための Diff の該当行に着地しない。
    test("clicking a replied review row switches the tab to Diff with the location and clears inbox", async () => {
      inboxGetMock.mockResolvedValue({
        items: [
          {
            section: "replied",
            kind: "review",
            id: "r1",
            title: "a.ts:L10",
            excerpt: "because x",
            worktreeRoot: "/Users/dev/other",
            repoKey: "/Users/dev/other/.git",
            agent: "claude",
            at: "2026-01-01T00:00:00.000Z",
            location: { path: "a.ts", line: 10 },
          },
        ],
        counts: { total: 1, bySection: { replied: 1 } } as never,
      });
      const { router } = await renderApp("/focus/graph?inbox=1");
      emit(focusMessage());
      emitOtherWorktreeTree();

      fireEvent.click(await screen.findByText("a.ts:L10"));

      await waitFor(() => expect(router.state.location.pathname).toBe("/focus/diff"));
      expect(router.state.location.search).toMatchObject({
        path: "a.ts",
        line: 10,
        root: "/Users/dev/other",
      });
      expect(router.state.location.search).not.toHaveProperty("inbox");
    });

    // 無いと壊れる: 判断依頼の未配達行を押しても Graph タブのまま `id` だけ付き、
    // 判断依頼ビューが Decisions タブとして開かない。
    test("clicking an undelivered decision row switches the tab to Decisions with its id and clears inbox", async () => {
      inboxGetMock.mockResolvedValue({
        items: [
          {
            section: "undelivered",
            kind: "decision",
            id: "d9",
            title: "どちらにする?",
            detail: "A or B?",
            worktreeRoot: "/Users/dev/project",
            repoKey: "/Users/dev/project/.git",
            agent: "claude",
            at: "2026-01-01T00:00:00.000Z",
            delivery: { state: "agent_blocked", canResend: true },
          },
        ],
        counts: { total: 1, bySection: { undelivered: 1 } } as never,
      });
      const { router } = await renderApp("/focus/graph?inbox=1");
      emit(focusMessage());

      fireEvent.click(await screen.findByText("どちらにする?"));

      await waitFor(() => expect(router.state.location.pathname).toBe("/focus/decisions"));
      expect(router.state.location.search).toMatchObject({ id: "d9" });
      expect(router.state.location.search).not.toHaveProperty("inbox");
    });

    // 無いと壊れる: blocked 行はフォーカス移動だけなので、ここまで直しても
    // 巻き込みで tab が変わってしまうと Graph を見ていた最中に画面ごと切り替わる。
    test("clicking a blocked agent row sends focus-pane and closes the dialog without changing the tab", async () => {
      inboxGetMock.mockResolvedValue({
        items: [
          {
            section: "blocked",
            kind: "agent",
            paneId: "p-other",
            agent: "claude",
            label: null,
            workspaceLabel: "other",
            tabLabel: "tab",
            worktreeRoot: "/Users/dev/other",
            at: null,
          },
        ],
        counts: { total: 1, bySection: { blocked: 1 } } as never,
      });
      const { router } = await renderApp("/focus/graph?inbox=1");
      emit(focusMessage());
      emitOtherWorktreeTree();

      fireEvent.click(await screen.findByText("claude"));

      expect(sendMock).toHaveBeenCalledWith({ type: "focus-pane", pane: "p-other" });
      await waitFor(() => expect(router.state.location.search).not.toHaveProperty("inbox"));
      expect(router.state.location.pathname).toBe("/focus/graph");
    });
  });
});
