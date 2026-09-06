import type { DecisionNotifier, DeliverResult } from "../ports";

export type FakeNotifierCall = { paneId: string | null; text: string };

export function createFakeDecisionNotifier(
  result: DeliverResult = { state: "sent", pane: "pane-1" },
) {
  const calls: FakeNotifierCall[] = [];
  let nextResult = result;
  const notifier: DecisionNotifier = {
    async deliver(paneId, text) {
      calls.push({ paneId, text });
      return nextResult;
    },
  };
  return {
    notifier,
    calls,
    setResult(next: DeliverResult) {
      nextResult = next;
    },
  };
}
