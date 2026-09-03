import { describe, expect, test } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import FileTree from "./FileTree";
import { buildFileTree } from "./tree";
import type { CommitFile } from "@contract/git";

const files: CommitFile[] = [
  { status: "M", path: "src/client/App.tsx", additions: 5, deletions: 2 },
  { status: "A", path: "src/client/New.tsx", additions: 10, deletions: 0 },
  { status: "D", path: "README.md", additions: 0, deletions: 8 },
  { status: "R", path: "src/c.ts", oldPath: "src/b.ts", additions: 3, deletions: 1 },
  { status: "M", path: "bin.dat", additions: null, deletions: null },
];

describe("FileTree", () => {
  test('renders a tree with role="tree" and treeitem rows for dirs and files', () => {
    const tree = buildFileTree(files);
    const { getByRole, getAllByRole } = render(<FileTree nodes={tree} />);
    expect(getByRole("tree")).toBeInTheDocument();
    // 2 dirs (root-level "src" collapses with nothing since it also holds
    // README.md as a sibling at root — "src" itself, plus "src/client") + 3 files.
    expect(getAllByRole("treeitem").length).toBeGreaterThan(0);
  });

  test("directories default to expanded and toggle closed on click", () => {
    const tree = buildFileTree(files);
    const { getByText, queryByText } = render(<FileTree nodes={tree} />);

    // "src" holds both "client/" and "c.ts" so it can't collapse further;
    // its child "App.tsx" (under src/client) should be visible by default.
    expect(getByText("App.tsx")).toBeInTheDocument();

    fireEvent.click(getByText("src"));
    expect(queryByText("App.tsx")).not.toBeInTheDocument();

    fireEvent.click(getByText("src"));
    expect(getByText("App.tsx")).toBeInTheDocument();
  });

  test("file rows show a status badge with the status letter", () => {
    const tree = buildFileTree(files);
    const { getByText } = render(<FileTree nodes={tree} />);
    const readme = getByText("README.md").closest('li[role="treeitem"]') as HTMLElement;
    expect(within(readme).getByText("D")).toBeInTheDocument();
  });

  test("a renamed file shows its oldPath", () => {
    const tree = buildFileTree(files);
    const { getByText } = render(<FileTree nodes={tree} />);
    expect(getByText(/src\/b\.ts/)).toBeInTheDocument();
  });

  test("a modified file shows +additions and -deletions counts", () => {
    const tree = buildFileTree(files);
    const { getByText } = render(<FileTree nodes={tree} />);
    const row = getByText("App.tsx").closest('li[role="treeitem"]') as HTMLElement;
    expect(within(row).getByText("+5")).toBeInTheDocument();
    expect(within(row).getByText("−2")).toBeInTheDocument();
  });

  test('a binary file shows "bin" instead of +/- counts', () => {
    const tree = buildFileTree(files);
    const { getByText } = render(<FileTree nodes={tree} />);
    const row = getByText("bin.dat").closest('li[role="treeitem"]') as HTMLElement;
    expect(within(row).getByText("bin")).toBeInTheDocument();
  });

  test("the stats column (status, +N, −M) precedes the file name in DOM order", () => {
    const tree = buildFileTree(files);
    const { getByText } = render(<FileTree nodes={tree} />);
    const row = getByText("README.md").closest('li[role="treeitem"]') as HTMLElement;
    const name = within(row).getByText("README.md");
    const badge = within(row).getByText("D");
    const adds = within(row).getByText("+0");
    const dels = within(row).getByText("−8");
    // eslint-disable-next-line no-bitwise
    expect(badge.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // eslint-disable-next-line no-bitwise
    expect(adds.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // eslint-disable-next-line no-bitwise
    expect(dels.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("every row carries its depth so the stats column can sit at the left edge", () => {
    const tree = buildFileTree(files);
    const { getByText } = render(<FileTree nodes={tree} />);
    const nested = getByText("App.tsx").closest('li[role="treeitem"]') as HTMLElement;
    const top = getByText("README.md").closest('li[role="treeitem"]') as HTMLElement;
    expect(nested.style.getPropertyValue("--depth")).toBe("2");
    expect(top.style.getPropertyValue("--depth")).toBe("0");
  });
});
