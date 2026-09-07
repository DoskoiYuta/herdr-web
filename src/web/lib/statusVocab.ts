// Review / Ask / Decision の内部状態を、ユーザーに見せる 4 語（要対応/進行中/
// 完了/無効）と配達状態の 6 語に写像する。写像表は docs/ui-redesign.md §6.2/§6.3。
// 内部状態（ReviewStatus 等）は変えない — ここは表示語への変換だけを担う。

import type { AskStatus } from "@contract/ask";
import type { DecisionDelivery, DecisionStatus } from "@contract/decision";
import type { NotifyState, ReviewStatus } from "@contract/review";

export type Turn = "action" | "progress" | "done" | "void";

export function turnOf(
  kind: "review",
  input: { status: ReviewStatus; hasUnsentDraft: boolean },
): Turn;
export function turnOf(kind: "ask", status: AskStatus): Turn;
export function turnOf(kind: "decision", status: DecisionStatus): Turn;
export function turnOf(
  kind: "review" | "ask" | "decision",
  input: { status: ReviewStatus; hasUnsentDraft: boolean } | AskStatus | DecisionStatus,
): Turn {
  if (kind === "review") {
    const { status, hasUnsentDraft } = input as { status: ReviewStatus; hasUnsentDraft: boolean };
    switch (status) {
      case "resolved":
        return "done";
      case "outdated":
        return "void";
      case "replied":
        return "action";
      case "open":
        return hasUnsentDraft ? "action" : "progress";
    }
  }
  if (kind === "ask") {
    switch (input as AskStatus) {
      case "resolved":
        return "done";
      case "outdated":
        return "void";
      case "replied":
        return "action";
      case "open":
        return "progress";
    }
  }
  // decision: §6.2 に「進行中」の行は無い（open が要対応、確定すればすぐ完了/無効）。
  // dismissed（人間の却下）・cancelled（エージェントの取り下げ）はどちらも
  // 「無効」— 「完了」は人間が実際に回答した answered だけ。
  switch (input as DecisionStatus) {
    case "open":
      return "action";
    case "answered":
      return "done";
    case "dismissed":
    case "cancelled":
      return "void";
  }
}

export type DeliveryState = "unsent" | "pending" | "sent" | "blocked" | "no_target" | "unknown";

export type DeliveryResult = { state: DeliveryState; canResend: boolean };

type AskLastPrompt = { state: "sent" | "agent_blocked" | "gone" | "failed"; at: string } | null;

export function deliveryOf(kind: "review", notify: { state: NotifyState }): DeliveryResult;
export function deliveryOf(kind: "decision", delivery: DecisionDelivery | null): DeliveryResult;
export function deliveryOf(kind: "ask", lastPrompt: AskLastPrompt): DeliveryResult;
export function deliveryOf(
  kind: "review" | "decision" | "ask",
  x: { state: NotifyState } | DecisionDelivery | null | AskLastPrompt,
): DeliveryResult {
  if (kind === "review") {
    const { state } = x as { state: NotifyState };
    switch (state) {
      case "none":
        return { state: "unsent", canResend: false };
      case "pending":
        return { state: "pending", canResend: false };
      case "sent":
        return { state: "sent", canResend: false };
      case "agent_blocked":
        return { state: "blocked", canResend: true };
      case "no_target":
        return { state: "no_target", canResend: true };
      case "unknown":
        return { state: "unknown", canResend: true };
    }
  }
  if (kind === "decision") {
    const delivery = x as DecisionDelivery | null;
    if (delivery === null) return { state: "unsent", canResend: false };
    switch (delivery.state) {
      case "pending":
        return { state: "pending", canResend: false };
      case "sent":
        return { state: "sent", canResend: false };
      case "agent_blocked":
        return { state: "blocked", canResend: true };
      case "gone":
        return { state: "no_target", canResend: true };
      case "unknown":
        return { state: "unknown", canResend: true };
    }
  }
  // ask
  const lastPrompt = x as AskLastPrompt;
  if (lastPrompt === null) return { state: "unsent", canResend: false };
  switch (lastPrompt.state) {
    case "sent":
      return { state: "sent", canResend: false };
    case "agent_blocked":
      return { state: "blocked", canResend: true };
    case "gone":
      return { state: "no_target", canResend: true };
    case "failed":
      return { state: "unknown", canResend: true };
  }
}
