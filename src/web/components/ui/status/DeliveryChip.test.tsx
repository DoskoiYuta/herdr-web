import assert from "node:assert/strict";
import { fireEvent, render, screen } from "@testing-library/react";
import { test } from "vitest";
import type { DeliveryState } from "@/lib/statusVocab";
import { DeliveryChip } from "./DeliveryChip";

const RESENDABLE: DeliveryState[] = ["blocked", "no_target", "unknown"];
const NOT_RESENDABLE: DeliveryState[] = ["unsent", "pending", "sent"];

test.each(RESENDABLE)("DeliveryChip: state=%s shows a resend control", (state) => {
  render(<DeliveryChip delivery={{ state, canResend: true }} onResend={() => {}} />);
  assert.ok(screen.getByRole("button", { name: "再送" }));
});

test.each(NOT_RESENDABLE)("DeliveryChip: state=%s has no resend control", (state) => {
  render(<DeliveryChip delivery={{ state, canResend: false }} onResend={() => {}} />);
  assert.equal(screen.queryByRole("button", { name: "再送" }), null);
});

test("DeliveryChip: clicking resend calls onResend", () => {
  let called = 0;
  render(
    <DeliveryChip
      delivery={{ state: "blocked", canResend: true }}
      onResend={() => {
        called++;
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "再送" }));
  assert.equal(called, 1);
});

// レビュー指摘: 再送 API に状態ゲートが無いので、連打がそのまま複数回の
// 通知になる。busy 中はリンクを無効化して連打を防ぐ。
test("DeliveryChip: busy disables the resend control so clicking it does not call onResend", () => {
  let called = 0;
  render(
    <DeliveryChip
      delivery={{ state: "blocked", canResend: true }}
      onResend={() => {
        called++;
      }}
      busy
    />,
  );
  const button = screen.getByRole("button", { name: "再送" });
  assert.ok((button as HTMLButtonElement).disabled);
  fireEvent.click(button);
  assert.equal(called, 0);
});
