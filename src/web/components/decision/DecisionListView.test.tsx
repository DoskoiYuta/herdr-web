import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Decision, DecisionEvent } from "@contract/decision";
import { makeFakeStore, renderWithStore } from "@/testing/renderWithRouter";
import { DecisionListView } from "./DecisionListView";

const list = vi.fn();
const counts = vi.fn();
const resend = vi.fn();

vi.mock("@/lib/api", () => ({
  decisionApi: {
    list: (...args: unknown[]) => list(...args),
    counts: (...args: unknown[]) => counts(...args),
    resend: (...args: unknown[]) => resend(...args),
  },
}));

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "d1",
    status: "open",
    spec: {
      title: "方針を決めてください",
      context: [],
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
    worktreeRoot: "/repo/a",
    repoKey: null,
    agent: "claude",
    createdAt: new Date().toISOString(),
    answeredAt: null,
    delivery: null,
    ...overrides,
  };
}

beforeEach(() => {
  list.mockReset();
  counts.mockReset();
  resend.mockReset();
  list.mockResolvedValue([]);
  counts.mockResolvedValue({ total: 0 });
});

describe("DecisionListView", () => {
  // 無いと壊れる: 「回答済み」「すべて」タブに切り替えても常に open だけ
  // （または常に全件）しか見られず、履歴を個別に引けない (plan F13-8)。
  test.each([
    ["decision-status-tab-answered", { status: "answered" }],
    ["decision-status-tab-all", {}],
  ])(
    "selecting the %s tab passes the matching status to the list API",
    async (testId, expected) => {
      renderWithStore(<DecisionListView onSelect={vi.fn()} />);
      await waitFor(() => expect(list).toHaveBeenCalledWith({ status: "open" }));

      fireEvent.mouseDown(screen.getByTestId(testId));

      await waitFor(() => expect(list).toHaveBeenCalledWith(expect.objectContaining(expected)));
    },
  );

  // 無いと壊れる: worktree の絞り込みを選んでもサーバーに伝わらず、無関係な
  // worktree の依頼まで混ざって出てしまう (docs/ui-redesign.md §5.4)。
  test("choosing a worktree in the filter passes worktreeRoot to the list API", async () => {
    const store = makeFakeStore({
      repos: [
        {
          key: "/repo/.git",
          name: "repo",
          counts: { blocked: 0, done: 0 },
          worktrees: [
            { root: "/repo/a", branch: "main", isMain: true, panes: [] },
            { root: "/repo/b", branch: "feature", isMain: false, panes: [] },
          ],
        },
      ],
    });
    renderWithStore(<DecisionListView onSelect={vi.fn()} />, { store });
    await waitFor(() => expect(list).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("combobox", { name: "worktree で絞り込み" }));
    fireEvent.click(await screen.findByRole("option", { name: /\/repo\/b|b/ }));

    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ worktreeRoot: "/repo/b" })),
    );
  });

  // 無いと壊れる: 数字キーが一覧の未回答行に効かず、キーボードで開けない
  // (docs/ui-redesign.md §5.4)。
  test("pressing a digit key opens the matching unanswered decision", async () => {
    list.mockResolvedValue([
      decision({ id: "d1", spec: { ...decision().spec, title: "一番目" } }),
      decision({ id: "d2", spec: { ...decision().spec, title: "二番目" } }),
    ]);
    const onSelect = vi.fn();
    renderWithStore(<DecisionListView onSelect={onSelect} />);
    await screen.findByText("二番目");

    fireEvent.keyDown(window, { key: "2" });

    expect(onSelect).toHaveBeenCalledWith("d2");
  });

  // 無いと壊れる: 状態ごとに同じ chip ラベルしか出ないと、一覧で
  // answered/dismissed/cancelled が見分けられない。
  test("distinct decision statuses render distinct status-chip labels", async () => {
    list.mockResolvedValue([
      decision({ id: "d1", status: "answered", answer: { answers: {} } }),
      decision({ id: "d2", status: "dismissed" }),
      decision({ id: "d3", status: "cancelled" }),
    ]);
    renderWithStore(<DecisionListView onSelect={vi.fn()} />);
    fireEvent.mouseDown(screen.getByTestId("decision-status-tab-all"));

    await screen.findByTestId("decision-row-d1");
    const chips = screen.getAllByTestId("status-chip");
    const labels = new Set(chips.map((c) => c.textContent));
    expect(labels.size).toBe(3);
  });

  // 無いと壊れる: 配達が滞っている行に再送手段が無いと、確定した回答が
  // 相手に届いていないことに一覧から気づけない。
  test.each([
    [null, false],
    [{ state: "sent", attempts: 1, pane: null, at: "t" }, false],
    [{ state: "agent_blocked", attempts: 1, pane: null, at: "t" }, true],
  ] as const)(
    "delivery chip appears on a row only when delivery has a problem",
    async (delivery, expectChip) => {
      list.mockResolvedValue([decision({ id: "d1", status: "answered", delivery })]);
      renderWithStore(<DecisionListView onSelect={vi.fn()} />);
      fireEvent.mouseDown(screen.getByTestId("decision-status-tab-answered"));

      const row = await screen.findByTestId("decision-row-d1");
      if (expectChip) {
        expect(within(row).getByTestId("delivery-chip")).toBeInTheDocument();
      } else {
        expect(within(row).queryByTestId("delivery-chip")).not.toBeInTheDocument();
      }
    },
  );

  // 無いと壊れる: 一覧から再送を押しても API が呼ばれず、Decisions ビューを
  // 開き直さないと未達の依頼を再送できない。
  test("clicking resend on a row calls the resend API", async () => {
    list.mockResolvedValue([
      decision({
        id: "d1",
        status: "answered",
        delivery: { state: "agent_blocked", attempts: 1, pane: null, at: "t" },
      }),
    ]);
    resend.mockResolvedValue({});
    renderWithStore(<DecisionListView onSelect={vi.fn()} />);
    fireEvent.mouseDown(screen.getByTestId("decision-status-tab-answered"));

    const row = await screen.findByTestId("decision-row-d1");
    fireEvent.click(within(row).getByRole("button", { name: "再送" }));

    await waitFor(() => expect(resend).toHaveBeenCalledWith("d1"));
  });

  // 無いと壊れる: 行クリックが選択を通知しないと、一覧から詳細を開けない。
  test("clicking a row calls onSelect with its id", async () => {
    list.mockResolvedValue([decision({ id: "d1" })]);
    const onSelect = vi.fn();
    renderWithStore(<DecisionListView onSelect={onSelect} />);

    fireEvent.click(await screen.findByTestId("decision-row-d1"));

    expect(onSelect).toHaveBeenCalledWith("d1");
  });

  // 無いと壊れる: 一覧の「未回答 N」とタブ側の通知バッジが別々のカウントを
  // 持つと、WS イベント後にどちらかだけ古い数のまま取り残される
  // (docs/ui-redesign.md §5.4)。両方 useDecisionCounts 経由の同じ
  // GET /api/decision/counts を使い、decision イベントで揃って更新される。
  test("the 未回答 tab count refetches decision/counts on a decision WS event", async () => {
    counts.mockResolvedValue({ total: 1 });
    const { store } = renderWithStore(<DecisionListView onSelect={vi.fn()} />);
    await waitFor(() => expect(counts).toHaveBeenCalledTimes(1));

    const event: DecisionEvent = {
      type: "decision",
      action: "created",
      id: "d2",
      worktreeRoot: null,
      paneId: null,
    };
    store.emitDecision(event);

    await waitFor(() => expect(counts).toHaveBeenCalledTimes(2));
  });
});
