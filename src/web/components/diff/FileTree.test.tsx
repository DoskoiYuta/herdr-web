import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import FileTree from "./FileTree.tsx";
import type { TreeNode } from "./tree.ts";

afterEach(() => {
  cleanup();
});

function nodes(): TreeNode[] {
  return [
    {
      kind: "dir",
      label: "src",
      path: "src",
      children: [
        {
          kind: "file",
          label: "index.ts",
          path: "src/index.ts",
          id: "diff:src/index.ts#1",
          status: "M",
          additions: 3,
          deletions: 1,
        },
      ],
    },
    {
      kind: "file",
      label: "README.md",
      path: "README.md",
      id: "diff:README.md#1",
      status: "A",
      additions: 5,
      deletions: 0,
    },
  ];
}

function baseProps() {
  return {
    nodes: nodes(),
    activeId: "diff:README.md#1" as string | null,
    onSelect: vi.fn(),
    collapsed: new Set<string>(),
    onToggleDir: vi.fn(),
  };
}

test("renders dir and file rows", () => {
  render(<FileTree {...baseProps()} />);
  expect(screen.getByText("src")).toBeInTheDocument();
  expect(screen.getByText("index.ts")).toBeInTheDocument();
  expect(screen.getByText("README.md")).toBeInTheDocument();
});

test("renders stats, omitting zero parts", () => {
  render(<FileTree {...baseProps()} />);
  expect(screen.getByText("+3 −1")).toBeInTheDocument();
  expect(screen.getByText("+5")).toBeInTheDocument();
});

test("clicking a file row calls onSelect with its id", () => {
  const props = baseProps();
  render(<FileTree {...props} />);
  fireEvent.click(screen.getByText("index.ts"));
  expect(props.onSelect).toHaveBeenCalledWith("diff:src/index.ts#1");
});

test("clicking a dir row calls onToggleDir with its path, and a collapsed dir hides its children", () => {
  const props = baseProps();
  const { rerender } = render(<FileTree {...props} />);
  fireEvent.click(screen.getByText("src"));
  expect(props.onToggleDir).toHaveBeenCalledWith("src");

  rerender(<FileTree {...props} collapsed={new Set(["src"])} />);
  expect(screen.queryByText("index.ts")).not.toBeInTheDocument();
  expect(screen.getByText("src")).toBeInTheDocument();
});

test('the active file row has aria-current="true"', () => {
  render(<FileTree {...baseProps()} />);
  const active = screen.getByText("README.md").closest("[aria-current]");
  expect(active).not.toBeNull();
  expect(active).toHaveAttribute("aria-current", "true");

  const inactive = screen.getByText("index.ts").closest(".tree-row");
  expect(inactive).not.toHaveAttribute("aria-current");
});
