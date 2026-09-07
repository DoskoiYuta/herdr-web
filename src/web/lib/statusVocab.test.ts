import assert from "node:assert/strict";
import { test } from "vitest";
import type { AskStatus } from "@contract/ask";
import type { DecisionDelivery, DecisionStatus } from "@contract/decision";
import type { NotifyState, ReviewStatus } from "@contract/review";
import { deliveryOf, turnOf } from "./statusVocab.ts";

// docs/ui-redesign.md §6.2: 内部状態を 4 語（要対応/進行中/完了/無効）に写像する表。
const REVIEW_TURN_CASES: [ReviewStatus, boolean, string][] = [
  ["replied", false, "action"],
  ["replied", true, "action"],
  ["open", true, "action"],
  ["open", false, "progress"],
  ["resolved", false, "done"],
  ["resolved", true, "done"],
  ["outdated", false, "void"],
  ["outdated", true, "void"],
];

test.each(REVIEW_TURN_CASES)(
  "turnOf review: status=%s hasUnsentDraft=%s -> %s",
  (status, hasUnsentDraft, expected) => {
    assert.equal(turnOf("review", { status, hasUnsentDraft }), expected);
  },
);

const ASK_TURN_CASES: [AskStatus, string][] = [
  ["replied", "action"],
  ["open", "progress"],
  ["resolved", "done"],
  ["outdated", "void"],
];

test.each(ASK_TURN_CASES)("turnOf ask: status=%s -> %s", (status, expected) => {
  assert.equal(turnOf("ask", status), expected);
});

// レビュー指摘: dismissed（人間が却下）は done（緑）ではなく void（灰）—
// answered だけが「完了」で、却下・取り下げはどちらも「無効」(§6.2)。
const DECISION_TURN_CASES: [DecisionStatus, string][] = [
  ["open", "action"],
  ["answered", "done"],
  ["dismissed", "void"],
  ["cancelled", "void"],
];

test.each(DECISION_TURN_CASES)("turnOf decision: status=%s -> %s", (status, expected) => {
  assert.equal(turnOf("decision", status), expected);
});

// docs/ui-redesign.md §6.3: 配達状態の写像。canResend は「操作」列が再送のものだけ true。
const REVIEW_DELIVERY_CASES: [NotifyState, string, boolean][] = [
  ["none", "unsent", false],
  ["pending", "pending", false],
  ["sent", "sent", false],
  ["agent_blocked", "blocked", true],
  ["no_target", "no_target", true],
  ["unknown", "unknown", true],
];

test.each(REVIEW_DELIVERY_CASES)(
  "deliveryOf review: notify.state=%s -> state=%s canResend=%s",
  (state, expectedState, expectedCanResend) => {
    const result = deliveryOf("review", { state });
    assert.equal(result.state, expectedState);
    assert.equal(result.canResend, expectedCanResend);
  },
);

const DECISION_DELIVERY_CASES: [DecisionDelivery["state"], string, boolean][] = [
  ["pending", "pending", false],
  ["sent", "sent", false],
  ["agent_blocked", "blocked", true],
  ["gone", "no_target", true],
  ["unknown", "unknown", true],
];

test.each(DECISION_DELIVERY_CASES)(
  "deliveryOf decision: delivery.state=%s -> state=%s canResend=%s",
  (state, expectedState, expectedCanResend) => {
    const result = deliveryOf("decision", { state, attempts: 1, pane: null, at: "" });
    assert.equal(result.state, expectedState);
    assert.equal(result.canResend, expectedCanResend);
  },
);

test("deliveryOf decision: null delivery -> unsent, not resendable", () => {
  const result = deliveryOf("decision", null);
  assert.equal(result.state, "unsent");
  assert.equal(result.canResend, false);
});

type AskLastPrompt = { state: "sent" | "agent_blocked" | "gone" | "failed"; at: string };
const ASK_DELIVERY_CASES: [AskLastPrompt["state"], string, boolean][] = [
  ["sent", "sent", false],
  ["agent_blocked", "blocked", true],
  ["gone", "no_target", true],
  ["failed", "unknown", true],
];

test.each(ASK_DELIVERY_CASES)(
  "deliveryOf ask: lastPrompt.state=%s -> state=%s canResend=%s",
  (state, expectedState, expectedCanResend) => {
    const result = deliveryOf("ask", { state, at: "" });
    assert.equal(result.state, expectedState);
    assert.equal(result.canResend, expectedCanResend);
  },
);

test("deliveryOf ask: null lastPrompt -> unsent, not resendable", () => {
  const result = deliveryOf("ask", null);
  assert.equal(result.state, "unsent");
  assert.equal(result.canResend, false);
});
