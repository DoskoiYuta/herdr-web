import assert from "node:assert/strict";
import { render, screen } from "@testing-library/react";
import { test } from "vitest";
import type { Turn } from "@/lib/statusVocab";
import { StatusChip } from "./StatusChip";

const TURNS: Turn[] = ["action", "progress", "done", "void"];

test.each(TURNS)("StatusChip: renders a distinct label for turn=%s", (turn) => {
  render(<StatusChip turn={turn} />);
  const chip = screen.getByTestId("status-chip");
  assert.equal(chip.dataset.turn, turn);
});

test("StatusChip: each turn gets a different visible label", () => {
  const labels = TURNS.map((turn) => {
    const { unmount } = render(<StatusChip turn={turn} />);
    const label = screen.getByTestId("status-chip").textContent;
    unmount();
    return label;
  });
  assert.equal(new Set(labels).size, TURNS.length);
});
