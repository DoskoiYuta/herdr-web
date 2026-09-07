import assert from "node:assert/strict";
import { render, screen } from "@testing-library/react";
import { test } from "vitest";
import type { AgentStatus } from "@contract/herdr";
import { AgentStatusDot, STATUS_META } from "./AgentStatusDot";

const STATUSES: AgentStatus[] = ["idle", "working", "blocked", "done", "unknown"];

test.each(STATUSES)("AgentStatusDot: renders an accessible label for status=%s", (status) => {
  render(<AgentStatusDot status={status} />);
  assert.ok(screen.getByLabelText(new RegExp(status)));
});

test("AgentStatusDot: optional label text is shown alongside the dot", () => {
  render(<AgentStatusDot status="working" label="claude" />);
  assert.ok(screen.getByText("claude"));
});

// design.pen P0: 5 状態は互いに見分けが付く色でなければならない（色の具体値
// はテストで固定しない — design.pen 側の色調整で壊れるテストにしないため）。
test("STATUS_META: every status has a distinct color from every other status", () => {
  const classNames = STATUSES.map((status) => STATUS_META[status].className);
  assert.equal(new Set(classNames).size, STATUSES.length);
});
