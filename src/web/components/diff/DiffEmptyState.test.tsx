import assert from "node:assert/strict";
import { fireEvent, render, screen } from "@testing-library/react";
import { test, vi } from "vitest";
import { DiffEmptyState } from "./DiffEmptyState";

test("DiffEmptyState: shows the branch name and a shortened HEAD", () => {
  render(<DiffEmptyState branch="feat/foo" head="abcdef1234567890" onOpenGraph={() => {}} />);
  assert.ok(screen.getByText("feat/foo"));
  assert.ok(screen.getByText("abcdef1"));
});

test("DiffEmptyState: clicking 'Graph を開く' calls onOpenGraph", () => {
  const onOpenGraph = vi.fn();
  render(<DiffEmptyState branch="main" head="1234567890abcdef" onOpenGraph={onOpenGraph} />);
  fireEvent.click(screen.getByRole("button", { name: "Graph を開く" }));
  assert.equal(onOpenGraph.mock.calls.length, 1);
});

test("DiffEmptyState: renders without a branch (detached HEAD)", () => {
  render(<DiffEmptyState branch={null} head="1234567890abcdef" onOpenGraph={() => {}} />);
  assert.ok(screen.getByText("1234567"));
});
