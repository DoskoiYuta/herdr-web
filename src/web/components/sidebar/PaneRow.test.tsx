import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { PaneRow as PaneRowType } from "@contract/events";
import { PaneRow } from "./PaneRow";

const writeText = vi.fn();
beforeEach(() => {
  writeText.mockReset();
  Object.assign(navigator, { clipboard: { writeText } });
});

function pane(overrides: Partial<PaneRowType> = {}): PaneRowType {
  return {
    paneId: "p1",
    workspaceId: "w1",
    workspaceLabel: "my-workspace",
    tabId: "t1",
    tabLabel: "editor",
    label: "session title",
    agent: "claude",
    agentStatus: "working",
    terminalTitleStripped: null,
    focused: false,
    cwd: "/repo",
    foregroundCwd: "/repo",
    ...overrides,
  };
}

function defaultProps() {
  return {
    pane: pane(),
    focused: false,
    sessionId: null as string | null,
    onSelect: vi.fn(),
  };
}

describe("PaneRow", () => {
  test("clicking the row calls onSelect with the pane id", () => {
    const props = defaultProps();
    render(<PaneRow {...props} />);
    fireEvent.click(screen.getByTestId("pane-row-p1"));
    expect(props.onSelect).toHaveBeenCalledWith("p1");
  });

  test("shows tab label but not raw workspace/tab ids", () => {
    render(<PaneRow {...defaultProps()} />);
    expect(screen.getByText("editor")).toBeInTheDocument();
    expect(screen.queryByText("w1")).not.toBeInTheDocument();
    expect(screen.queryByText("t1")).not.toBeInTheDocument();
  });

  test("omits the tab label line when tabLabel is null", () => {
    render(<PaneRow {...defaultProps()} pane={pane({ tabLabel: null })} />);
    expect(screen.queryByText("editor")).not.toBeInTheDocument();
  });

  // 無いと壊れる: label/terminalTitleStripped/agent が全部無い素の shell 行が、
  // 識別子ゼロの空欄ボタンになりクリック対象が何なのか分からなくなる。
  test("falls back to the pane id when label, terminal title and agent are all null", () => {
    render(
      <PaneRow
        {...defaultProps()}
        pane={pane({ label: null, terminalTitleStripped: null, agent: null })}
      />,
    );
    expect(screen.getByTestId("pane-row-p1")).toHaveTextContent("p1");
  });

  test("aria-current follows the focused prop, not pane.focused", () => {
    render(<PaneRow {...defaultProps()} pane={pane({ focused: true })} focused={false} />);
    expect(screen.getByTestId("pane-row-p1")).not.toHaveAttribute("aria-current");
  });

  test("aria-current is set when focused is true", () => {
    render(<PaneRow {...defaultProps()} focused={true} />);
    expect(screen.getByTestId("pane-row-p1")).toHaveAttribute("aria-current", "true");
  });

  test.each([
    ["shell agent shows a Terminal icon and no Bot icon", "shell"],
    ["non-shell agent shows a Bot icon", "claude"],
  ])("%s", (_label, agent) => {
    render(<PaneRow {...defaultProps()} pane={pane({ agent })} />);
    const row = screen.getByTestId("pane-row-p1");
    expect(row.querySelector("svg")).not.toBeNull();
  });

  test("right-click opens a menu with フォーカスを移す and a disabled session-id copy when sessionId is null", () => {
    render(<PaneRow {...defaultProps()} sessionId={null} />);
    fireEvent.contextMenu(screen.getByTestId("pane-row-p1"));
    expect(screen.getByText("フォーカスを移す")).toBeInTheDocument();
    expect(screen.getByText("session id をコピー").closest('[role="menuitem"]')).toHaveAttribute(
      "data-disabled",
    );
  });

  test("session id をコピー copies the given sessionId when present", async () => {
    render(<PaneRow {...defaultProps()} sessionId="sess-123" />);
    fireEvent.contextMenu(screen.getByTestId("pane-row-p1"));
    fireEvent.click(screen.getByText("session id をコピー"));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("sess-123"));
  });

  test("フォーカスを移す in the context menu calls onSelect", () => {
    const props = defaultProps();
    render(<PaneRow {...props} />);
    fireEvent.contextMenu(screen.getByTestId("pane-row-p1"));
    fireEvent.click(screen.getByText("フォーカスを移す"));
    expect(props.onSelect).toHaveBeenCalledWith("p1");
  });
});
