import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory } from "@tanstack/react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ServerEventMessage } from "@contract/events";
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
      repos: [{ id: "", name: repo.split("/").pop() ?? repo, root: repo, kind: "root" as const }],
    })),
  },
  reviewApi: {
    list: vi.fn(async () => []),
    counts: vi.fn(async () => ({
      byCommit: {},
      worktree: { unresolved: 0, drafts: 0 },
      pendingDrafts: 0,
    })),
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
  });

  test("renders the three-column layout skeleton", async () => {
    await renderApp();
    expect(screen.getByLabelText("サイドバー")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-stub")).toBeInTheDocument();
    expect(screen.getByText("herdr 未接続 / worktree 未選択")).toBeInTheDocument();
    expect(screen.getAllByRole("separator").length).toBeGreaterThan(0);
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

  // 無いと壊れる: 判断依頼は worktree ごとの行でしか見られず、他の worktree の
  // 依頼を見るには focus を移すしかなくなる (plan F13-8)。
  test("clicking the decision badge opens a list of open decisions across worktrees", async () => {
    await renderApp();
    fireEvent.click(await screen.findByTestId("decision-count-badge"));
    expect(await screen.findByText("依頼A")).toBeInTheDocument();
    expect(await screen.findByText("依頼B")).toBeInTheDocument();
  });

  // F14-7 の振る舞いテスト（URL が画面状態の正であることの確認）。
  describe("routing (plan.md F14-7)", () => {
    // 無いと壊れる: URL が画面状態を持たないと、ブラウザの戻る/進むが完全な
    // no-op になり、判断依頼を開いて戻るとツール領域ごと消えるなどの事故が起きる。
    test("browser back/forward switches both the active tab and the decision view", async () => {
      const { router } = await renderApp();
      emit(focusMessage());
      expect(screen.getByRole("tab", { name: "Diff" })).toHaveAttribute("data-state", "active");

      fireEvent.mouseDown(screen.getByRole("tab", { name: "Files" }));
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("data-state", "active"),
      );

      fireEvent.click(await screen.findByTestId("decision-count-badge"));
      expect(await screen.findByText("判断依頼")).toBeInTheDocument();

      router.history.back();
      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("data-state", "active"),
      );
      expect(screen.queryByText("判断依頼")).not.toBeInTheDocument();

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

      fireEvent.click(await screen.findByTestId("decision-count-badge"));
      fireEvent.click(await screen.findByText("依頼A"));
      await screen.findByText("h"); // decision item header from the fixture

      // Two pushes got us here (badge -> list, row -> detail); back through both.
      router.history.back();
      router.history.back();
      await waitFor(() =>
        expect(screen.getByTestId("diff-panel-stub")).toHaveTextContent(
          "/Users/dev/project:aaa111:bbb222",
        ),
      );
    });

    // 無いと壊れる: 判断依頼を閉じると常に /focus/diff へ飛び、タブ・比較範囲が
    // 失われる。
    test("closing the decision list returns to the previous URL (tab and comparison intact)", async () => {
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

      fireEvent.click(await screen.findByTestId("decision-count-badge"));
      expect(await screen.findByText("判断依頼")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "閉じる" }));

      await waitFor(() => expect(router.state.location.pathname).toBe("/focus/diff"));
      expect(router.state.location.search).toMatchObject({ from: "a", to: "b" });
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

    fireEvent.click(await screen.findByTestId("decision-count-badge"));
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
});
