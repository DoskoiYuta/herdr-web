import { describe, expect, test } from "bun:test";
import { DECISION_PROMPT_MAX_BYTES, type Decision } from "../../contract/decision";
import { renderAnsweredPrompt, renderDismissedPrompt } from "./prompt";

function baseDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "0000000000000000000000000000abcd1234",
    status: "answered",
    spec: {
      title: "title",
      context: [],
      items: [
        {
          id: "q1",
          header: "方針",
          question: "q?",
          kind: "single",
          options: [],
          allowOther: true,
          required: true,
        },
      ],
      layout: null,
    },
    answer: {
      answers: { q1: { selected: ["A"], other: null, note: "理由" } },
    },
    paneId: "pane-1",
    claudeSessionId: null,
    worktreeRoot: "/wt",
    repoKey: "/wt/.git",
    agent: "claude",
    createdAt: "2026-01-01T00:00:00.000Z",
    answeredAt: "2026-01-01T00:01:00.000Z",
    delivery: null,
    ...overrides,
  };
}

describe("renderAnsweredPrompt", () => {
  // 無いと壊れる: エージェントが `hw decision show` を打たずに回答内容を読めない。
  test("includes the answer and the show command", () => {
    const text = renderAnsweredPrompt(baseDecision());
    expect(text).toContain("方針=A（note: 理由）");
    expect(text).toContain("hw decision show 0000000000000000000000000000abcd1234");
  });

  // 無いと壊れる: 選択肢に加えて自由記述もある回答で other が欠け、
  // エージェントが「その他」の内容を読めない (plan F13-7)。
  test("includes both selected and other when both are present", () => {
    const decision = baseDecision({
      answer: {
        answers: { q1: { selected: ["その他"], other: "JWT", note: null } },
      },
    });
    const text = renderAnsweredPrompt(decision);
    expect(text).toContain("その他（その他: JWT）");
  });

  // 無いと壊れる: 巨大な note を持つ回答が agent.prompt の上限を超え、herdr 側で
  // 送信が拒否/切り詰められて壊れた通知になる。
  test("stays within DECISION_PROMPT_MAX_BYTES even with a huge note", () => {
    const decision = baseDecision({
      answer: {
        answers: { q1: { selected: ["A"], other: null, note: "x".repeat(10_000) } },
      },
    });
    const text = renderAnsweredPrompt(decision);
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(
      DECISION_PROMPT_MAX_BYTES,
    );
    expect(text).toContain("hw decision show");
  });
});

describe("renderDismissedPrompt", () => {
  // 無いと壊れる: 却下されたことがエージェントに伝わらず、いつまでも回答を待ち続ける。
  test("says the decision was dismissed", () => {
    const text = renderDismissedPrompt(baseDecision({ status: "dismissed" }));
    expect(text).toContain("却下されました");
    expect(text).toContain("hw decision show 0000000000000000000000000000abcd1234");
  });
});
