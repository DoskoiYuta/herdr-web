import { beforeEach, expect, test, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

test("an in-progress answer survives a reload (module re-initialization)", async () => {
  const first = await import("./decisionDrafts");
  first.setDecisionDraft("decision-1", {
    answers: { q1: { selected: ["A"], other: null, note: "note" } },
  });

  vi.resetModules();
  const second = await import("./decisionDrafts");
  expect(second.getDecisionDraft("decision-1")).toEqual({
    answers: { q1: { selected: ["A"], other: null, note: "note" } },
  });
});
