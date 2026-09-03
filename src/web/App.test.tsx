import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "./App";

// xterm.js は実 canvas / WebGL コンテキストを要求するため jsdom では動かせない。
// レイアウトのテストではターミナルの中身自体は関心の対象外なのでモックする。
vi.mock("@/components/terminal/Terminal", () => ({
  Terminal: ({ className }: { className?: string }) => (
    <div data-testid="terminal-stub" className={className} />
  ),
}));

function renderApp() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("renders the three-column layout skeleton", () => {
    renderApp();
    expect(screen.getByText("サイドバー")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-stub")).toBeInTheDocument();
    expect(screen.getByText("herdr 未接続 / worktree 未選択")).toBeInTheDocument();
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  test("collapsing the tool area hides its content and the divider", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "ツール領域を折りたたむ" }));
    expect(screen.queryByText("herdr 未接続 / worktree 未選択")).not.toBeInTheDocument();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ツール領域を開く" })).toBeInTheDocument();
  });

  test("persists the collapsed state to localStorage", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "ツール領域を折りたたむ" }));
    const stored = JSON.parse(localStorage.getItem("herdr-web:layout") ?? "{}");
    expect(stored.toolCollapsed).toBe(true);
  });
});
