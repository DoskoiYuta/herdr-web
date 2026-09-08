import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { PaneRow, Repo } from "@contract/events";
import type { InboxResponse } from "@contract/inbox";
import { makeFakeStore, renderWithRouter, type FakeHerdrStore } from "@/testing/renderWithRouter";
import { InboxDialog } from "./InboxDialog";

// Radix Select needs pointer-capture/scrollIntoView jsdom doesn't implement —
// stub as a native <select>, same pattern as AskComposer.test.tsx.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) => (
    <select
      data-testid="worktree-select"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

const inboxGetMock = vi.fn<(params: { worktree?: string }) => Promise<InboxResponse>>();
const reviewNotifyMock = vi.fn((_id: string) => Promise.resolve({ ok: true as const }));
const askResendMock = vi.fn((_id: string) => Promise.resolve({}) as Promise<never>);
const decisionResendMock = vi.fn((_id: string) => Promise.resolve({}) as Promise<never>);

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    inboxApi: { get: (params: { worktree?: string }) => inboxGetMock(params) },
    reviewApi: { notify: (id: string) => reviewNotifyMock(id) },
    askApi: { resend: (id: string) => askResendMock(id) },
    decisionApi: { resend: (id: string) => decisionResendMock(id) },
  };
});

function emptyInbox(): InboxResponse {
  return { items: [], counts: { total: 0, bySection: {} } as never };
}

function pane(overrides: Partial<PaneRow> = {}): PaneRow {
  return {
    paneId: "p1",
    workspaceId: "w1",
    workspaceLabel: null,
    tabId: "t1",
    tabLabel: null,
    label: null,
    agent: "claude",
    agentStatus: "working",
    terminalTitleStripped: null,
    focused: true,
    cwd: "/repo-a",
    foregroundCwd: "/repo-a",
    ...overrides,
  };
}

function repo(overrides: Partial<Repo> = {}): Repo {
  return {
    key: "/repo-a/.git",
    name: "repo-a",
    worktrees: [{ root: "/repo-a", branch: "main", isMain: true, panes: [pane()] }],
    counts: { blocked: 0, done: 0 },
    ...overrides,
  };
}

function storeWithFocus(worktreeRoot: string | null): FakeHerdrStore {
  return makeFakeStore({
    repos: [repo()],
    focus: worktreeRoot
      ? {
          type: "focus",
          pane: "p1",
          workspace: "w1",
          cwd: worktreeRoot,
          foregroundCwd: worktreeRoot,
          worktreeRoot,
          repoKey: "/repo-a/.git",
          agent: "claude",
          agentStatus: "working",
          agentSession: null,
        }
      : null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  inboxGetMock.mockResolvedValue(emptyInbox());
});

async function renderDialog(
  opts: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    store?: FakeHerdrStore;
  } = {},
) {
  const onOpenChange = opts.onOpenChange ?? vi.fn();
  const utils = await renderWithRouter(
    () => <InboxDialog open={opts.open ?? true} onOpenChange={onOpenChange} />,
    { store: opts.store ?? storeWithFocus("/repo-a") },
  );
  return { ...utils, onOpenChange };
}

describe("open state", () => {
  test("renders no dialog content when open=false", async () => {
    await renderDialog({ open: false });
    expect(screen.queryByTestId("inbox-dialog")).not.toBeInTheDocument();
  });

  test("renders the dialog when open=true", async () => {
    await renderDialog({ open: true });
    await waitFor(() => expect(screen.getByTestId("inbox-dialog")).toBeInTheDocument());
  });
});

describe("sections", () => {
  test("shows the empty state when there are no items", async () => {
    await renderDialog();
    await waitFor(() =>
      expect(screen.getByText("いま対応が必要なものはありません")).toBeInTheDocument(),
    );
  });

  // 無いと壊れる: セクション順を間違えると、より緊急な項目より下に表示され、
  // ダイアログを開いた人がまず見るべきものを見逃す。
  test("renders only non-empty sections, in undelivered/replied/unsent/blocked order", async () => {
    inboxGetMock.mockResolvedValue({
      items: [
        {
          section: "replied",
          kind: "review",
          id: "r1",
          title: "a.ts:L10",
          excerpt: "because x",
          worktreeRoot: "/repo-a",
          repoKey: "/repo-a/.git",
          agent: "claude",
          at: "2026-01-01T00:00:00.000Z",
          location: { path: "a.ts", line: 10 },
        },
        {
          section: "blocked",
          kind: "agent",
          paneId: "p1",
          agent: "claude",
          label: null,
          workspaceLabel: "main",
          tabLabel: "tab",
          worktreeRoot: "/repo-a",
          at: null,
        },
      ],
      counts: { total: 2, bySection: { replied: 1, blocked: 1 } } as never,
    });
    await renderDialog();
    await waitFor(() => expect(screen.getByTestId("inbox-section-replied")).toBeInTheDocument());
    expect(screen.getByTestId("inbox-section-blocked")).toBeInTheDocument();
    expect(screen.queryByTestId("inbox-section-undelivered")).not.toBeInTheDocument();
    expect(screen.queryByTestId("inbox-section-unsent")).not.toBeInTheDocument();

    const sectionEls = screen.getAllByTestId(/inbox-section-/);
    expect(sectionEls.map((el) => el.dataset.testid)).toEqual([
      "inbox-section-replied",
      "inbox-section-blocked",
    ]);
  });
});

describe("row clicks", () => {
  // 無いと壊れる: replied/unsent/undelivered-decision の行がここで
  // onOpenChange(false) も呼んでしまうと、router.tsx の setInboxOpen が
  // navigate の直後にもう一度 navigate し、行クリックの navigate が付けた
  // タブ・search を後勝ちで打ち消す（App.test.tsx の Inbox row clicks 参照）。
  // Inbox はこの navigate 自体が search から `inbox` を落とすことで閉じる。
  test("clicking a replied review row focuses the pane without calling onOpenChange", async () => {
    inboxGetMock.mockResolvedValue({
      items: [
        {
          section: "replied",
          kind: "review",
          id: "r1",
          title: "a.ts:L10",
          excerpt: "because x",
          worktreeRoot: "/repo-a",
          repoKey: "/repo-a/.git",
          agent: "claude",
          at: "2026-01-01T00:00:00.000Z",
          location: { path: "a.ts", line: 10 },
        },
      ],
      counts: { total: 1, bySection: { replied: 1 } } as never,
    });
    const store = storeWithFocus(null); // not currently focused on /repo-a -> must focus-pane first
    const { onOpenChange } = await renderDialog({ store });
    await waitFor(() => expect(screen.getByTestId("inbox-row")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("inbox-row"));

    expect(store.send).toHaveBeenCalledWith({ type: "focus-pane", pane: "p1" });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  // 無いと壊れる: old 側にアンカーされた review の location が side を運ばないと、
  // ToolPane の既定 "new" にフォールバックし、無関係な行を開く。
  test("clicking a replied review row anchored to the old side puts side=old in the diff search", async () => {
    inboxGetMock.mockResolvedValue({
      items: [
        {
          section: "replied",
          kind: "review",
          id: "r1",
          title: "a.ts:L10",
          excerpt: "because x",
          worktreeRoot: "/repo-a",
          repoKey: "/repo-a/.git",
          agent: "claude",
          at: "2026-01-01T00:00:00.000Z",
          location: { path: "a.ts", line: 10, side: "old" },
        },
      ],
      counts: { total: 1, bySection: { replied: 1 } } as never,
    });
    const { router } = await renderDialog({ store: storeWithFocus("/repo-a") });
    await waitFor(() => expect(screen.getByTestId("inbox-row")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("inbox-row"));

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ path: "a.ts", line: 10, side: "old" }),
    );
  });

  // 無いと壊れる: commit ターゲットの review の from/to が渡らないと、Diff は
  // WORKTREE/INDEX の比較のまま開き、コメントが付いたコミット間 diff を表示できない。
  test("clicking a replied review row targeting a commit puts from/to in the diff search", async () => {
    inboxGetMock.mockResolvedValue({
      items: [
        {
          section: "replied",
          kind: "review",
          id: "r1",
          title: "a.ts:L10",
          excerpt: "because x",
          worktreeRoot: "/repo-a",
          repoKey: "/repo-a/.git",
          agent: "claude",
          at: "2026-01-01T00:00:00.000Z",
          location: { path: "a.ts", line: 10, side: "new", from: "abc123~1", to: "abc123" },
        },
      ],
      counts: { total: 1, bySection: { replied: 1 } } as never,
    });
    const { router } = await renderDialog({ store: storeWithFocus("/repo-a") });
    await waitFor(() => expect(screen.getByTestId("inbox-row")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("inbox-row"));

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ from: "abc123~1", to: "abc123" }),
    );
  });

  test("clicking an unsent row focuses the pane without calling onOpenChange", async () => {
    inboxGetMock.mockResolvedValue({
      items: [
        {
          section: "unsent",
          kind: "review",
          worktreeRoot: "/repo-a",
          repoKey: "/repo-a/.git",
          count: 2,
          at: "2026-01-01T00:00:00.000Z",
        },
      ],
      counts: { total: 1, bySection: { unsent: 1 } } as never,
    });
    const store = storeWithFocus(null);
    const { onOpenChange } = await renderDialog({ store });
    await waitFor(() => expect(screen.getByTestId("inbox-row")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("inbox-row"));

    expect(store.send).toHaveBeenCalledWith({ type: "focus-pane", pane: "p1" });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  test("clicking a blocked row focuses the pane and closes the dialog", async () => {
    inboxGetMock.mockResolvedValue({
      items: [
        {
          section: "blocked",
          kind: "agent",
          paneId: "p1",
          agent: "claude",
          label: null,
          workspaceLabel: "main",
          tabLabel: "tab",
          worktreeRoot: "/repo-a",
          at: null,
        },
      ],
      counts: { total: 1, bySection: { blocked: 1 } } as never,
    });
    const store = storeWithFocus("/repo-a");
    const { onOpenChange } = await renderDialog({ store });
    await waitFor(() => expect(screen.getByTestId("inbox-row")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("inbox-row"));

    expect(store.send).toHaveBeenCalledWith({ type: "focus-pane", pane: "p1" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("clicking an undelivered decision row navigates to the decisions tab without calling onOpenChange", async () => {
    inboxGetMock.mockResolvedValue({
      items: [
        {
          section: "undelivered",
          kind: "decision",
          id: "d1",
          title: "どちらにする?",
          detail: "A or B?",
          worktreeRoot: "/repo-a",
          repoKey: "/repo-a/.git",
          agent: "claude",
          at: "2026-01-01T00:00:00.000Z",
          delivery: { state: "agent_blocked", canResend: true },
        },
      ],
      counts: { total: 1, bySection: { undelivered: 1 } } as never,
    });
    const { onOpenChange, router } = await renderDialog();
    await waitFor(() => expect(screen.getByTestId("inbox-row")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("inbox-row"));

    await waitFor(() => expect(router.state.location.pathname).toBe("/focus/decisions"));
    expect(router.state.location.search).toMatchObject({ id: "d1" });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  // 無いと壊れる: review/ask の undelivered 行がクリックで何かに遷移してしまうと、
  // 「再送」以外の意図しない操作（フォーカス移動やタブ遷移）が誤操作で起きる。
  test("an undelivered review row is not clickable (no button role)", async () => {
    inboxGetMock.mockResolvedValue({
      items: [
        {
          section: "undelivered",
          kind: "review",
          id: "r1",
          title: "a.ts:L10",
          detail: "why?",
          worktreeRoot: "/repo-a",
          repoKey: "/repo-a/.git",
          agent: "claude",
          at: "2026-01-01T00:00:00.000Z",
          delivery: { state: "agent_blocked", canResend: true },
          location: { path: "a.ts", line: 10 },
        },
      ],
      counts: { total: 1, bySection: { undelivered: 1 } } as never,
    });
    await renderDialog();
    const row = await screen.findByTestId("inbox-row");
    expect(row).not.toHaveAttribute("role", "button");
  });
});

describe("resend", () => {
  test.each([
    ["review", reviewNotifyMock] as const,
    ["ask", askResendMock] as const,
    ["decision", decisionResendMock] as const,
  ])(
    "resend button for kind=%s calls the matching resend API and disables while busy",
    async (kind, mock) => {
      let resolvePromise: () => void = () => {};
      mock.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePromise = () => resolve(undefined as never);
          }) as never,
      );
      inboxGetMock.mockResolvedValue({
        items: [
          {
            section: "undelivered",
            kind,
            id: "x1",
            title: "t",
            detail: "d",
            worktreeRoot: "/repo-a",
            repoKey: "/repo-a/.git",
            agent: "claude",
            at: "2026-01-01T00:00:00.000Z",
            delivery: { state: "agent_blocked", canResend: true },
          },
        ],
        counts: { total: 1, bySection: { undelivered: 1 } } as never,
      });
      await renderDialog();
      const resendButton = await screen.findByRole("button", { name: "再送" });

      fireEvent.click(resendButton);
      expect(mock).toHaveBeenCalledWith("x1");
      await waitFor(() => expect(resendButton).toBeDisabled());

      resolvePromise();
      await waitFor(() => expect(resendButton).not.toBeDisabled());
    },
  );

  // 無いと壊れる: 再送が失敗しても何も表示されないと、ユーザーは再送できたと
  // 誤解して待ち続ける。busy も解除されないままだと再試行すらできなくなる。
  test("shows an error toast and clears busy when the resend API call rejects", async () => {
    reviewNotifyMock.mockRejectedValueOnce(new Error("network error"));
    inboxGetMock.mockResolvedValue({
      items: [
        {
          section: "undelivered",
          kind: "review",
          id: "x1",
          title: "t",
          detail: "d",
          worktreeRoot: "/repo-a",
          repoKey: "/repo-a/.git",
          agent: "claude",
          at: "2026-01-01T00:00:00.000Z",
          delivery: { state: "agent_blocked", canResend: true },
        },
      ],
      counts: { total: 1, bySection: { undelivered: 1 } } as never,
    });
    await renderDialog();
    const resendButton = await screen.findByRole("button", { name: "再送" });

    fireEvent.click(resendButton);

    await screen.findByText("再送に失敗しました");
    await waitFor(() => expect(resendButton).not.toBeDisabled());
  });
});

describe("worktree filter", () => {
  test("changing the worktree select refetches with that worktree", async () => {
    await renderDialog();
    await waitFor(() => expect(inboxGetMock).toHaveBeenCalledWith({ worktree: undefined }));

    fireEvent.change(screen.getByTestId("worktree-select"), { target: { value: "/repo-a" } });

    await waitFor(() => expect(inboxGetMock).toHaveBeenCalledWith({ worktree: "/repo-a" }));
  });

  // 無いと壊れる: basename が衝突する 2 リポジトリの main worktree が両方
  // "main" だけになり、Select でどちらを選んでいるか分からなくなる。
  test("select options disambiguate repos whose main worktree basename collides", async () => {
    const store = makeFakeStore({
      repos: [
        {
          key: "/work/foo/.git",
          name: "foo",
          worktrees: [{ root: "/work/foo", branch: "main", isMain: true, panes: [] }],
          counts: { blocked: 0, done: 0 },
        },
        {
          key: "/side/foo/.git",
          name: "foo",
          worktrees: [{ root: "/side/foo", branch: "main", isMain: true, panes: [] }],
          counts: { blocked: 0, done: 0 },
        },
      ],
    });
    await renderDialog({ store });

    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(["side/foo › main", "work/foo › main"]));
  });
});

describe("row location", () => {
  // 無いと壊れる: basename が衝突する main worktree を持つ 2 リポジトリの行が
  // メタ行では区別できず、どちらのリポジトリの通知か分からない。
  test("rows for repos whose main worktree basename collides show distinct repo names", async () => {
    const store = makeFakeStore({
      repos: [
        {
          key: "/work/foo/.git",
          name: "foo",
          worktrees: [{ root: "/work/foo", branch: "main", isMain: true, panes: [pane()] }],
          counts: { blocked: 0, done: 0 },
        },
        {
          key: "/side/foo/.git",
          name: "foo",
          worktrees: [{ root: "/side/foo", branch: "main", isMain: true, panes: [] }],
          counts: { blocked: 0, done: 0 },
        },
      ],
    });
    inboxGetMock.mockResolvedValue({
      items: [
        {
          section: "replied",
          kind: "review",
          id: "r1",
          title: "a.ts:L10",
          excerpt: "because x",
          worktreeRoot: "/work/foo",
          repoKey: "/work/foo/.git",
          agent: "claude",
          at: "2026-01-01T00:00:00.000Z",
          location: { path: "a.ts", line: 10 },
        },
        {
          section: "replied",
          kind: "review",
          id: "r2",
          title: "b.ts:L1",
          excerpt: "because y",
          worktreeRoot: "/side/foo",
          repoKey: "/side/foo/.git",
          agent: "claude",
          at: "2026-01-01T00:00:00.000Z",
          location: { path: "b.ts", line: 1 },
        },
      ],
      counts: { total: 2, bySection: { replied: 2 } } as never,
    });
    await renderDialog({ store });

    const rows = await screen.findAllByTestId("inbox-row");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("work/foo"),
      expect.stringContaining("side/foo"),
    ]);
  });
});
