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

// design.pen P0: blocked は琥珀(amber)、unknown は灰系（枠線色）— 旧仕様の
// blocked=赤/unknown=黄は廃止（design.pen 準拠）。
test("STATUS_META: blocked is amber, not red; unknown is not yellow", () => {
  assert.match(STATUS_META.blocked.className, /amber/);
  assert.doesNotMatch(STATUS_META.blocked.className, /red-/);
  assert.doesNotMatch(STATUS_META.unknown.className, /yellow/);
});

test("STATUS_META: working is blue, done is green, idle is gray/muted", () => {
  assert.match(STATUS_META.working.className, /blue/);
  assert.match(STATUS_META.done.className, /green/);
  assert.match(STATUS_META.idle.className, /muted/);
});
