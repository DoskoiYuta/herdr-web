import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { DiffFileList } from "./DiffFileList.tsx";
import type { TreeNode } from "./tree.ts";

const nodes: TreeNode[] = [
  {
    kind: "dir",
    label: "assets",
    path: "assets",
    children: [
      {
        kind: "file",
        label: "logo.png",
        path: "assets/logo.png",
        id: "1",
        status: "M",
        additions: 0,
        deletions: 0,
      },
    ],
  },
  {
    kind: "dir",
    label: "src",
    path: "src",
    children: [
      {
        kind: "file",
        label: "app.ts",
        path: "src/app.ts",
        id: "2",
        status: "M",
        additions: 4,
        deletions: 0,
      },
      {
        kind: "file",
        label: "util.ts",
        path: "src/util.ts",
        id: "3",
        status: "D",
        additions: 0,
        deletions: 3,
      },
    ],
  },
];

// 無いと壊れる: 検索欄を空にしても絞り込みが残ったままになり、全ファイルへ
// 戻る手段がなくなる。
test("clearing the search box after filtering restores the full file list", () => {
  render(<DiffFileList nodes={nodes} selectedPath={null} onSelectFile={vi.fn()} />);
  const search = screen.getByPlaceholderText("Search…");

  fireEvent.change(search, { target: { value: "util" } });
  expect(screen.getByRole("button", { name: "util.ts" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "app.ts" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "logo.png" })).not.toBeInTheDocument();

  fireEvent.change(search, { target: { value: "" } });
  expect(screen.getByRole("button", { name: "util.ts" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "app.ts" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "logo.png" })).toBeInTheDocument();
});

test("clicking a file row calls onSelectFile with its path", () => {
  const onSelectFile = vi.fn();
  render(<DiffFileList nodes={nodes} selectedPath={null} onSelectFile={onSelectFile} />);
  fireEvent.click(screen.getByRole("button", { name: "app.ts" }));
  expect(onSelectFile).toHaveBeenCalledWith("src/app.ts");
});
