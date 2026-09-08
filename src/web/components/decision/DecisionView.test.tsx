import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Decision, DecisionEvent } from "@contract/decision";
import { clearDecisionDraft, getDecisionDraft } from "@/lib/decisionDrafts";
import { makeFakeStore, renderWithStore } from "@/testing/renderWithRouter";
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
    fireEvent.click(screen.getByRole("button", { name: "回答を送信" }));

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

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "回答を送信" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "回答を送信" }));

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
    // A/B のカード自体はラジオではなくクリック可能な div。ラジオが残るのは
    // 「その他」欄の選択状態表示用の 1 個だけ。
    expect(screen.queryAllByRole("radio")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "A" }));
    fireEvent.click(screen.getByRole("button", { name: "回答を送信" }));

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
    fireEvent.click(screen.getByRole("button", { name: "回答を送信" }));

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
  // 相手に届いていないのに気づく手段がなくなる。配達に問題がある依頼は
  // 警告カード（上部）にまとまっている想定 (docs/ui-redesign.md §5.4)。
  test("shows a resend control when the delivery is agent_blocked, wired to the resend API", async () => {
    const decision = baseDecision({
      status: "answered",
      answer: { answers: { q1: { selected: ["A"], other: null, note: null } } },
      delivery: { state: "agent_blocked", attempts: 2, pane: null, at: "t" },
    });
    get.mockResolvedValue(decision);
    resend.mockResolvedValue({ ...decision, delivery: { ...decision.delivery!, state: "sent" } });

    renderWithStore(<DecisionView id="decision-1" />);
    const warning = await screen.findByTestId("decision-delivery-warning");
    expect(within(warning).getByTestId("delivery-chip")).toBeInTheDocument();
    fireEvent.click(within(warning).getByRole("button", { name: "再送" }));
    await waitFor(() => expect(resend).toHaveBeenCalledWith("decision-1"));
  });

  // レビュー指摘: 再送 API に状態ゲートが無いので、連打がそのまま複数回の
  // 通知になる。再送中は DeliveryChip のボタンを無効化する。
  test("disables the resend control while a resend request is in flight", async () => {
    let resolveResend: (v: unknown) => void = () => {};
    resend.mockReturnValue(new Promise((resolve) => (resolveResend = resolve)));
    const decision = baseDecision({
      status: "answered",
      answer: { answers: { q1: { selected: ["A"], other: null, note: null } } },
      delivery: { state: "agent_blocked", attempts: 2, pane: null, at: "t" },
    });
    get.mockResolvedValue(decision);

    renderWithStore(<DecisionView id="decision-1" />);
    await waitFor(() => expect(screen.getByTestId("delivery-chip")).toBeInTheDocument());
    const button = screen.getByRole("button", { name: "再送" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(resend).toHaveBeenCalledTimes(1);

    resolveResend({ ...decision, delivery: { ...decision.delivery!, state: "sent" } });
    await waitFor(() => expect(button).not.toBeDisabled());
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
    await waitFor(() => expect(screen.getByText("A")).toBeInTheDocument());
    expect(screen.queryByTestId("delivery-chip")).not.toBeInTheDocument();
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

  // 無いと壊れる: パンくずの「Decisions」が一覧へ戻す手段を持たないと、閉じる
  // ボタンが無い今、詳細から一覧へ戻れなくなる (docs/ui-redesign.md §5.4)。
  test("clicking the Decisions breadcrumb calls onClose", async () => {
    const decision = baseDecision();
    get.mockResolvedValue(decision);
    const onClose = vi.fn();

    renderWithStore(<DecisionView id="decision-1" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText("A")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Decisions" }));

    expect(onClose).toHaveBeenCalled();
  });

  // 無いと壊れる: Esc が効かないと、キーボードだけで一覧に戻れなくなる。
  test("pressing Escape calls onClose", async () => {
    const decision = baseDecision();
    get.mockResolvedValue(decision);
    const onClose = vi.fn();

    renderWithStore(<DecisionView id="decision-1" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText("A")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  // 無いと壊れる: pane が生きているのに herdr state を見ずに固定表示すると、
  // blocked のまま止まっているエージェントに気づけない。
  test("shows the agent's live status when its pane is still in herdr state", async () => {
    const decision = baseDecision({ paneId: "pane-1" });
    get.mockResolvedValue(decision);
    const store = makeFakeStore({
      repos: [
        {
          key: "/repo/.git",
          name: "repo",
          counts: { blocked: 0, done: 0 },
          worktrees: [
            {
              root: "/repo",
              branch: "main",
              isMain: true,
              panes: [
                {
                  paneId: "pane-1",
                  workspaceId: "w1",
                  workspaceLabel: null,
                  tabId: "t1",
                  tabLabel: null,
                  label: null,
                  agent: "claude",
                  agentStatus: "blocked",
                  terminalTitleStripped: null,
                  focused: false,
                  cwd: null,
                  foregroundCwd: null,
                },
              ],
            },
          ],
        },
      ],
    });

    renderWithStore(<DecisionView id="decision-1" />, { store });
    await waitFor(() => expect(screen.getByText("A")).toBeInTheDocument());

    expect(screen.getByLabelText("状態: blocked")).toBeInTheDocument();
  });

  // レビュー指摘（実走）: `hw` が呼び出し元 pane を解決できなかった依頼は
  // `decision.agent` が null になる。pane が herdr state に見つかるなら、
  // pane 側の agent 名を出すべき。無いと壊れる: agent 名の欄が空欄のまま
  // 何のエージェントか分からない。
  test("falls back to the live pane's agent name when decision.agent is null", async () => {
    const decision = baseDecision({ paneId: "pane-1", agent: null });
    get.mockResolvedValue(decision);
    const store = makeFakeStore({
      repos: [
        {
          key: "/repo/.git",
          name: "repo",
          counts: { blocked: 0, done: 0 },
          worktrees: [
            {
              root: "/repo",
              branch: "main",
              isMain: true,
              panes: [
                {
                  paneId: "pane-1",
                  workspaceId: "w1",
                  workspaceLabel: null,
                  tabId: "t1",
                  tabLabel: null,
                  label: null,
                  agent: "codex",
                  agentStatus: "working",
                  terminalTitleStripped: null,
                  focused: false,
                  cwd: null,
                  foregroundCwd: null,
                },
              ],
            },
          ],
        },
      ],
    });

    renderWithStore(<DecisionView id="decision-1" />, { store });
    await waitFor(() => expect(screen.getByText("A")).toBeInTheDocument());

    expect(screen.getByLabelText("状態: working")).toBeInTheDocument();
    expect(screen.getByText("codex")).toBeInTheDocument();
  });

  // 無いと壊れる: pane が見つからないのに何も言わないと、エージェントが
  // まだ生きているのか判断できない。tree は既に届いている（repos が空でない）
  // 状態でテストする — repos 空はまだ tree 未着のケース（後述のテスト）。
  test("shows a 'pane 消失' notice when the pane can't be found in herdr state", async () => {
    const decision = baseDecision({ paneId: "pane-gone" });
    get.mockResolvedValue(decision);
    const store = makeFakeStore({
      repos: [
        {
          key: "/other/.git",
          name: "other",
          counts: { blocked: 0, done: 0 },
          worktrees: [{ root: "/other", branch: "main", isMain: true, panes: [] }],
        },
      ],
    });

    renderWithStore(<DecisionView id="decision-1" />, { store });
    await waitFor(() => expect(screen.getByText("A")).toBeInTheDocument());

    expect(screen.getByText(/pane 消失/)).toBeInTheDocument();
  });

  // レビュー指摘（Low 5）: herdr は pane id を再利用しうるので、paneId が
  // 一致するだけでは別のエージェントの pane を「生きている」と誤認しうる。
  // 無いと壊れる: エージェントが変わった再利用 pane の状態を、依頼のエージェント
  // のものとして誤表示する。
  test("treats a pane whose live agent differs from the decision's agent as gone", async () => {
    const decision = baseDecision({ paneId: "pane-1", agent: "claude" });
    get.mockResolvedValue(decision);
    const store = makeFakeStore({
      repos: [
        {
          key: "/repo/.git",
          name: "repo",
          counts: { blocked: 0, done: 0 },
          worktrees: [
            {
              root: "/repo",
              branch: "main",
              isMain: true,
              panes: [
                {
                  paneId: "pane-1",
                  workspaceId: "w1",
                  workspaceLabel: null,
                  tabId: "t1",
                  tabLabel: null,
                  label: null,
                  agent: "codex",
                  agentStatus: "working",
                  terminalTitleStripped: null,
                  focused: false,
                  cwd: null,
                  foregroundCwd: null,
                },
              ],
            },
          ],
        },
      ],
    });

    renderWithStore(<DecisionView id="decision-1" />, { store });
    await waitFor(() => expect(screen.getByText("A")).toBeInTheDocument());

    expect(screen.getByText(/pane 消失/)).toBeInTheDocument();
    expect(screen.queryByLabelText("状態: working")).not.toBeInTheDocument();
  });

  // レビュー指摘（Low 6）: tree がまだ届いていない／WS 未接続の間に「pane 消失」
  // と決めつけると、実際には生きているエージェントを死んだと誤表示する。
  test.each([
    ["open" as const, [], "settling"],
    ["connecting" as const, ["repo-with-pane"], "settling"],
    ["open" as const, ["repo-with-pane"], "live"],
    ["open" as const, ["repo-without-pane"], "gone"],
  ])("connection=%s repos=%s -> pane display is %s", async (connection, reposKind, expected) => {
    const decision = baseDecision({ paneId: "pane-1", agent: "claude" });
    get.mockResolvedValue(decision);
    const pane = {
      paneId: "pane-1",
      workspaceId: "w1",
      workspaceLabel: null,
      tabId: "t1",
      tabLabel: null,
      label: null,
      agent: "claude",
      agentStatus: "working" as const,
      terminalTitleStripped: null,
      focused: false,
      cwd: null,
      foregroundCwd: null,
    };
    const repos =
      reposKind.length === 0
        ? []
        : [
            {
              key: "/repo/.git",
              name: "repo",
              counts: { blocked: 0, done: 0 },
              worktrees: [
                {
                  root: "/repo",
                  branch: "main",
                  isMain: true,
                  panes: reposKind[0] === "repo-with-pane" ? [pane] : [],
                },
              ],
            },
          ];
    const store = makeFakeStore({ repos, connection });

    renderWithStore(<DecisionView id="decision-1" />, { store });
    await waitFor(() => expect(screen.getByText("A")).toBeInTheDocument());

    if (expected === "settling") {
      expect(screen.getByText(/状態を取得中/)).toBeInTheDocument();
    } else if (expected === "live") {
      expect(screen.getByLabelText("状態: working")).toBeInTheDocument();
    } else {
      expect(screen.getByText(/pane 消失/)).toBeInTheDocument();
    }
  });

  // 無いと壊れる: セッション id を丸ごと出すと表示が長すぎるうえ、識別子として
  // 意味のある先頭/末尾以外の情報まで漏らす。
  test("shows a truncated form of the Claude session id, not the full string", async () => {
    const decision = baseDecision({ claudeSessionId: "abcd1234efgh5678" });
    get.mockResolvedValue(decision);

    renderWithStore(<DecisionView id="decision-1" />);
    await waitFor(() => expect(screen.getByText("A")).toBeInTheDocument());

    expect(screen.queryByText("abcd1234efgh5678")).not.toBeInTheDocument();
    expect(screen.getByText(/abcd.*5678/)).toBeInTheDocument();
  });

  // 無いと壊れる: 確定後も context が常に展開されたままだと、答えを確認したい
  // だけの場面で毎回長い context を読まされる。
  test("collapses the context by default once the decision is no longer open", async () => {
    const decision = baseDecision({
      status: "answered",
      answer: { answers: { q1: { selected: ["A"], other: null, note: null } } },
      spec: { ...baseDecision().spec, context: [{ kind: "markdown", text: "背景情報" }] },
    });
    get.mockResolvedValue(decision);

    renderWithStore(<DecisionView id="decision-1" />);
    const details = (await screen.findByTestId("decision-context")) as HTMLDetailsElement;
    expect(details.open).toBe(false);

    fireEvent.click(screen.getByText("コンテキスト"));
    expect(details.open).toBe(true);
  });

  // 無いと壊れる: 「その他」欄に入力しても選択状態が変わらないと、必須設問で
  // 自由記述だけ書いても回答済みに見えず、送信していいか判断できない。
  test("typing into the allowOther field marks it as the selected option", async () => {
    const decision = baseDecision();
    get.mockResolvedValue(decision);

    renderWithStore(<DecisionView id="decision-1" />);
    await waitFor(() => expect(screen.getByText("A")).toBeInTheDocument());

    const otherInput = screen.getByLabelText("どちらにしますか その他");
    const otherRadio = screen.getByRole("radio", { name: "その他" });
    expect(otherRadio).not.toBeChecked();

    fireEvent.change(otherInput, { target: { value: "C案" } });
    expect(otherRadio).toBeChecked();
  });

  // 無いと壊れる: 下書きに保存済みの note が最初は畳まれたままだと、
  // 書いたメモが見えなくなり回答の中身が失われて見える。
  test("a note already present on the answer starts the memo field expanded", async () => {
    const decision = baseDecision();
    get.mockResolvedValue(decision);

    const first = renderWithStore(<DecisionView id="decision-1" />);
    await waitFor(() => expect(screen.getByText("A")).toBeInTheDocument());
    expect(screen.queryByLabelText("どちらにしますか メモ")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "＋ メモを追加" }));
    fireEvent.change(screen.getByLabelText("どちらにしますか メモ"), {
      target: { value: "念のため" },
    });
    first.unmount();

    renderWithStore(<DecisionView id="decision-1" />);
    await waitFor(() =>
      expect(screen.getByLabelText("どちらにしますか メモ")).toHaveValue("念のため"),
    );
  });
});
