import assert from "node:assert/strict";
import { render, screen } from "@testing-library/react";
import { test } from "vitest";
import { KindIcon } from "./KindIcon";

const KINDS = ["review", "ask", "decision", "agent"] as const;

test.each(KINDS)("KindIcon: kind=%s has a non-empty accessible label", (kind) => {
  render(<KindIcon kind={kind} />);
  const icon = screen.getByRole("img");
  assert.ok(icon.getAttribute("aria-label"));
});

test("KindIcon: the four kinds have distinct accessible labels", () => {
  const labels = KINDS.map((kind) => {
    const { unmount } = render(<KindIcon kind={kind} />);
    const label = screen.getByRole("img").getAttribute("aria-label");
    unmount();
    return label;
  });
  assert.equal(new Set(labels).size, KINDS.length);
});

test("KindIcon: the four kinds render visually distinct icons", () => {
  const svgs = KINDS.map((kind) => {
    const { container, unmount } = render(<KindIcon kind={kind} />);
    const svg = container.querySelector("svg");
    unmount();
    return svg?.getAttribute("data-kind-svg");
  });
  assert.equal(new Set(svgs).size, KINDS.length);
});
