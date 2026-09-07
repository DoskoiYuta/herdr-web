import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Decision, DecisionEvent } from "@contract/decision";
import { clearDecisionDraft, getDecisionDraft } from "@/lib/decisionDrafts";
import { renderWithStore } from "@/testing/renderWithRouter";
import { DecisionView } from "./DecisionView";

const get = vi.fn();
const answer = vi.fn();
const dismiss = vi.fn();
const resend = vi.fn();

vi.mock("@/lib/api", () => ({
  decisionApi: {
    get: (...args: unknown[]) => get(...args),
    answer: (...args: unknown[]) => answer(...args),
    dismiss: (...args: unknown[]) => dismiss(...args),
    resend: (...args: unknown[]) => resend(...args),
  },
}));

function baseDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "decision-1",
    status: "open",
    spec: {
      title: "方針を決めてください",
      context: [],
      items: [
        {
          id: "q1",
          header: "どちらにしますか",
          question: "選んでください",
          kind: "single",
          options: [
            { label: "A", description: null, recommended: false, preview: [] },
            { label: "B", description: null, recommended: false, preview: [] },
          ],
          allowOther: true,
          required: true,
        },
      ],
      layout: null,
    },
    answer: null,
    paneId: "pane-1",
    claudeSessionId: null,
    worktreeRoot: "/repo",
    repoKey: "/repo/.git",
    agent: "claude",
    createdAt: new Date().toISOString(),
    answeredAt: null,
    delivery: null,
    ...overrides,
  };
}

beforeEach(() => {
  get.mockReset();
  answer.mockReset();
  dismiss.mockReset();
  resend.mockReset();
  clearDecisionDraft("decision-1");
});

describe("DecisionView", () => {
  // 無いと壊れる: single 設問を選んで送信しても answer API が一切呼ばれず、
  // 回答した内容がエージェントへ届かない。
  test("selecting a single option and submitting calls the answer API", async () => {
    const decision = baseDecision();
    get.mockResolvedValue(decision);
    answer.mockResolvedValue({ ...decision, status: "answered" });

    renderWithStore(<DecisionView id="decision-1" />);

    await waitFor(() => expect(screen.getByText("A")).toBeInTheDocument());
    const radios = screen.getAllByRole("radio");
    fireEvent.click(radios[0]!);
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    await waitFor(() => expect(answer).toHaveBeenCalledTimes(1));
    expect(answer.mock.calls[0]![0]).toBe("decision-1");
    expect(answer.mock.calls[0]![1].answers.q1.selected).toEqual(["A"]);
  });

  // 無いと壊れる: 却下ボタンが dismiss API を呼ばず、UI 上「却下」を押しても
  // エージェントに何も届かない。
  test("clicking 却下 calls the dismiss API", async () => {
    const decision = baseDecision();
    get.mockResolvedValue(decision);
    dismiss.mockResolvedValue({ ...decision, status: "answered" });

    renderWithStore(<DecisionView id="decision-1" />);

    await waitFor(() => expect(screen.getByRole("button", { name: "却下" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "却下" }));

    await waitFor(() => expect(dismiss).toHaveBeenCalledWith("decision-1"));
  });

  // 無いと壊れる: required:false の設問を未回答のままにできず、送信が
  // 常にブロックされてしまう。
  test("a decision with only a non-required item can be submitted unanswered", async () => {
    const decision = baseDecision({
      spec: {
        title: "t",
        context: [],
        items: [
          {
            id: "q1",
            header: "任意の設問",
            question: "答えなくても構いません",
            kind: "text",
            options: [],
            allowOther: true,
            required: false,
          },
        ],
        layout: null,
      },
    });
    get.mockResolvedValue(decision);
    answer.mockResolvedValue({ ...decision, status: "answered" });

    renderWithStore(<DecisionView id="decision-1" />);

    await waitFor(() => expect(screen.getByRole("button", { name: "送信" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    await waitFor(() => expect(answer).toHaveBeenCalledTimes(1));
  });

  // 無いと壊れる: WS の decision イベントを受けても再取得されず、他所（herdr
  // 側の agent.prompt 配達完了など）で進んだ配達状況が画面に反映されない。
  test("refetches when a decision WS event fires", async () => {
    const decision = baseDecision();
    get.mockResolvedValue(decision);
    const fakeEvent: DecisionEvent = {
      type: "decision",
      action: "answered",
      id: "decision-1",
      worktreeRoot: null,
      paneId: null,
    };

    const { store } = renderWithStore(<DecisionView id="decision-1" />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

    store.emitDecision(fakeEvent);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  // 無いと壊れる: 確定済みの依頼を開いても回答内容が見えず、人間が何を
  // 答えたか後から確認できない。
  test("shows the confirmed answer read-only for a non-open decision", async () => {
    const decision = baseDecision({
      status: "answered",
      answer: {
        answers: { q1: { selected: ["A"], other: null, note: "念のため" } },
      },
      answeredAt: new Date().toISOString(),
    });
    get.mockResolvedValue(decision);

    renderWithStore(<DecisionView id="decision-1" />);

    await waitFor(() => expect(screen.getByText("A")).toBeInTheDocument());
    expect(screen.getByText(/念のため/)).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  // 無いと壊れる: layout: "compare" でもラジオボタンのままになり、選択肢の
  // preview を横並びで比較できない。
  test("layout: compare renders cards, and clicking one selects it", async () => {
    const decision = baseDecision({
      spec: {
        title: "t",
        context: [],
        items: [
          {
            id: "q1",
            header: "どちらにしますか",
            question: "選んでください",
            kind: "single",
            options: [
              {
                label: "A",
                description: null,
                recommended: false,
                preview: [{ kind: "svg", markup: "<svg><text>A</text></svg>" }],
              },
              {
                label: "B",
                description: null,
                recommended: false,
                preview: [{ kind: "svg", markup: "<svg><text>B</text></svg>" }],
              },
            ],
            allowOther: true,
            required: true,
          },
        ],
        layout: "compare",
      },
    });
    get.mockResolvedValue(decision);
    answer.mockResolvedValue({ ...decision, status: "answered" });

    renderWithStore(<DecisionView id="decision-1" />);

    await waitFor(() => expect(screen.getByRole("button", { name: "A" })).toBeInTheDocument());
    expect(screen.queryAllByRole("radio")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "A" }));
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    await waitFor(() => expect(answer).toHaveBeenCalledTimes(1));
    expect(answer.mock.calls[0]![1].answers.q1.selected).toEqual(["A"]);
  });

  // 無いと壊れる: compare レイアウトでは「その他」欄が描画されず、
  // カードに無い選択肢を自由記述で答える手段が無い。
  test("layout: compare still shows the allowOther free-text field", async () => {
    const decision = baseDecision({
      spec: {
        title: "t",
        context: [],
        items: [
          {
            id: "q1",
            header: "どちらにしますか",
            question: "選んでください",
            kind: "single",
            options: [
              {
                label: "A",
                description: null,
                recommended: false,
                preview: [{ kind: "svg", markup: "<svg><text>A</text></svg>" }],
              },
            ],
            allowOther: true,
            required: true,
          },
        ],
        layout: "compare",
      },
    });
    get.mockResolvedValue(decision);
    answer.mockResolvedValue({ ...decision, status: "answered" });

    renderWithStore(<DecisionView id="decision-1" />);

    await waitFor(() => expect(screen.getByRole("button", { name: "A" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("どちらにしますか その他"), {
      target: { value: "C案" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));

    await waitFor(() => expect(answer).toHaveBeenCalledTimes(1));
    expect(answer.mock.calls[0]![1].answers.q1.other).toBe("C案");
  });

  // 無いと壊れる: 却下後も下書きが localStorage に残り続け、同じ id の依頼が
  // 二度と存在しないのに永久にストレージを専有する。
  test("dismissing clears the persisted draft", async () => {
    const decision = baseDecision();
    get.mockResolvedValueOnce(decision).mockResolvedValue({ ...decision, status: "dismissed" });
    dismiss.mockResolvedValue({ ...decision, status: "dismissed" });

    renderWithStore(<DecisionView id="decision-1" />);
    await waitFor(() => expect(screen.getByText("A")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "却下" }));

    await waitFor(() => expect(getDecisionDraft("decision-1")).toBeUndefined());
  });

  // 無いと壊れる: ビューを閉じて開き直すと入力途中の回答が消え、Files タブへ
  // 寄り道しただけで書きかけの回答をやり直すことになる。
  test("closing and reopening the view keeps the in-progress answer", async () => {
    const decision = baseDecision({
      spec: {
        title: "t",
        context: [],
        items: [
          {
            id: "q1",
            header: "メモ",
            question: "自由記述",
            kind: "text",
            options: [],
            allowOther: true,
            required: false,
          },
        ],
        layout: null,
      },
    });
    get.mockResolvedValue(decision);

    const { unmount } = renderWithStore(<DecisionView id="decision-1" />);
    await waitFor(() => expect(screen.getByLabelText("メモ")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("メモ"), { target: { value: "書きかけの回答" } });
    unmount();

    renderWithStore(<DecisionView id="decision-1" />);
    await waitFor(() => expect(screen.getByLabelText("メモ")).toHaveValue("書きかけの回答"));
  });

  // 無いと壊れる: agent_blocked のまま resend ボタンが出ないと、確定した回答が
  // 相手に届いていないのに気づく手段がなくなる。
  test("shows a resend control when the delivery is agent_blocked, wired to the resend API", async () => {
    const decision = baseDecision({
      status: "answered",
      answer: { answers: { q1: { selected: ["A"], other: null, note: null } } },
      delivery: { state: "agent_blocked", attempts: 2, pane: null, at: "t" },
    });
    get.mockResolvedValue(decision);
    resend.mockResolvedValue({ ...decision, delivery: { ...decision.delivery!, state: "sent" } });

    renderWithStore(<DecisionView id="decision-1" />);
    await waitFor(() => expect(screen.getByTestId("delivery-chip")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "再送" }));
    await waitFor(() => expect(resend).toHaveBeenCalledWith("decision-1"));
  });

  // 無いと壊れる: すでに届いている確定回答にまで再送ボタンを出すと、
  // ユーザーが不要な再送を叩けてしまう。
  test("shows no resend control once delivery is sent", async () => {
    const decision = baseDecision({
      status: "answered",
      answer: { answers: { q1: { selected: ["A"], other: null, note: null } } },
      delivery: { state: "sent", attempts: 1, pane: null, at: "t" },
    });
    get.mockResolvedValue(decision);

    renderWithStore(<DecisionView id="decision-1" />);
    await waitFor(() => expect(screen.getByTestId("delivery-chip")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "再送" })).not.toBeInTheDocument();
  });

  // 無いと壊れる: cancelled（エージェント側の取り下げ）は宛先が無いので、
  // 配達が滞って見えても再送すべきではない。
  test("shows no resend control for a cancelled decision even with a blocked delivery", async () => {
    const decision = baseDecision({
      status: "cancelled",
      delivery: { state: "agent_blocked", attempts: 1, pane: null, at: "t" },
    });
    get.mockResolvedValue(decision);

    renderWithStore(<DecisionView id="decision-1" />);
    await waitFor(() => expect(screen.getByTestId("delivery-chip")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "再送" })).not.toBeInTheDocument();
  });
});
