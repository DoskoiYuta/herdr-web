import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StatusLine from "./StatusLine.tsx";

test("renders file/addition/deletion summary", () => {
  render(
    <StatusLine
      summary={{ files: 3, additions: 10, deletions: 2 }}
      generatedAt="2026-08-31T07:00:00.000Z"
      untrackedCount={0}
      untrackedErrors={0}
    />,
  );
  expect(screen.getByText(/3 files \+10 -2/)).toBeInTheDocument();
});

test("puts the fetch time in a tooltip, showing -- when generatedAt is null", () => {
  render(
    <StatusLine
      summary={{ files: 0, additions: 0, deletions: 0 }}
      generatedAt={null}
      untrackedCount={0}
      untrackedErrors={0}
    />,
  );
  expect(screen.getByText(/0 files/)).toHaveAttribute("title", "更新 --:--:--");
});

test("appends untracked count and untracked-error count when present", () => {
  render(
    <StatusLine
      summary={{ files: 1, additions: 0, deletions: 0 }}
      generatedAt={null}
      untrackedCount={4}
      untrackedErrors={2}
    />,
  );
  expect(screen.getByText(/untracked 4/)).toBeInTheDocument();
  expect(screen.getByText(/untracked errors 2/)).toBeInTheDocument();
});

test("omits untracked parts when zero", () => {
  render(
    <StatusLine
      summary={{ files: 1, additions: 0, deletions: 0 }}
      generatedAt={null}
      untrackedCount={0}
      untrackedErrors={0}
    />,
  );
  expect(screen.queryByText(/untracked/)).not.toBeInTheDocument();
});
