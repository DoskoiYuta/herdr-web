import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { PaneRow } from "@contract/events";
import { AskComposer } from "./AskComposer";

// Radix Select relies on pointer-capture/scrollIntoView APIs jsdom doesn't
// implement — stub it as a native <select> so target-picking is testable
// with plain fireEvent, same as any other form control here.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) => (
    <select
      data-testid="target-select"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

function pane(paneId: string, label: string | null = null): PaneRow {
  return {
    paneId,
    workspaceId: "w",
    workspaceLabel: null,
    tabId: "t",
    tabLabel: null,
    label,
    agent: "claude",
    agentStatus: "idle",
    terminalTitleStripped: null,
    focused: false,
    cwd: null,
    foregroundCwd: null,
  };
}

test("submitting with no target change sends { kind: 'new' }", async () => {
  const onSubmit = vi.fn();
  render(<AskComposer panes={[]} onCancel={vi.fn()} onSubmit={onSubmit} />);
  fireEvent.change(screen.getByPlaceholderText("質問を入力"), { target: { value: "why?" } });
  fireEvent.click(screen.getByText("送信"));
  expect(onSubmit).toHaveBeenCalledWith("why?", { kind: "new" });
});

// Without this, a question meant for an already-running agent pane would
// always start a brand-new session instead.
test("choosing a pane target sends { kind: 'pane', paneId }", async () => {
  const onSubmit = vi.fn();
  render(<AskComposer panes={[pane("pane-1", "worker")]} onCancel={vi.fn()} onSubmit={onSubmit} />);
  fireEvent.change(screen.getByPlaceholderText("質問を入力"), { target: { value: "why?" } });
  fireEvent.change(screen.getByTestId("target-select"), { target: { value: "pane-1" } });
  fireEvent.click(screen.getByText("送信"));
  expect(onSubmit).toHaveBeenCalledWith("why?", { kind: "pane", paneId: "pane-1" });
});

test("disabled blocks submit and shows the reason", () => {
  const onSubmit = vi.fn();
  render(<AskComposer panes={[]} onCancel={vi.fn()} onSubmit={onSubmit} disabled />);
  fireEvent.change(screen.getByPlaceholderText("質問を入力"), { target: { value: "why?" } });
  fireEvent.click(screen.getByText("送信"));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(
    screen.getByText("リポジトリを解決できていません（少し待ってから再度お試しください）"),
  ).toBeInTheDocument();
});
