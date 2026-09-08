import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { FileTabBar } from "./FileTabBar";

function renderBar(props: Partial<React.ComponentProps<typeof FileTabBar>> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const onCloseOthers = vi.fn();
  const onCloseAll = vi.fn();
  const onCopyPath = vi.fn();
  const onReorder = vi.fn();
  render(
    <FileTabBar
      paths={["a.ts", "b.ts"]}
      activePath="a.ts"
      exists={{}}
      onSelect={onSelect}
      onClose={onClose}
      onCloseOthers={onCloseOthers}
      onCloseAll={onCloseAll}
      onCopyPath={onCopyPath}
      onReorder={onReorder}
      {...props}
    />,
  );
  return { onSelect, onClose, onCloseOthers, onCloseAll, onCopyPath, onReorder };
}

test("renders nothing when no tabs are open", () => {
  const { container } = render(
    <FileTabBar
      paths={[]}
      activePath={null}
      exists={{}}
      onSelect={vi.fn()}
      onClose={vi.fn()}
      onCloseOthers={vi.fn()}
      onCloseAll={vi.fn()}
      onCopyPath={vi.fn()}
      onReorder={vi.fn()}
    />,
  );
  expect(container).toBeEmptyDOMElement();
});

test("clicking a tab calls onSelect with its path", () => {
  const { onSelect } = renderBar();
  fireEvent.click(screen.getByRole("tab", { name: /b\.ts/ }));
  expect(onSelect).toHaveBeenCalledWith("b.ts");
});

test("clicking a tab's close button calls onClose without selecting it", () => {
  const { onClose, onSelect } = renderBar();
  fireEvent.click(screen.getByRole("button", { name: "b.ts を閉じる" }));
  expect(onClose).toHaveBeenCalledWith("b.ts");
  expect(onSelect).not.toHaveBeenCalled();
});

test("middle-clicking a tab calls onClose", () => {
  const { onClose } = renderBar();
  fireEvent.mouseDown(screen.getByRole("tab", { name: /b\.ts/ }), { button: 1 });
  expect(onClose).toHaveBeenCalledWith("b.ts");
});

test("a missing tab is marked (data-missing) and shown strikethrough", () => {
  renderBar({ exists: { "a.ts": true, "b.ts": false } });
  const missingTab = screen.getByRole("tab", { name: /b\.ts/ });
  expect(missingTab).toHaveAttribute("data-missing", "true");
  expect(missingTab).toHaveAttribute("title", "この worktree には存在しません");
  expect(missingTab.querySelector(".line-through")).not.toBeNull();
});

test("a tab whose existence hasn't resolved yet is not marked missing", () => {
  renderBar({ exists: {} });
  const tab = screen.getByRole("tab", { name: /b\.ts/ });
  expect(tab).not.toHaveAttribute("data-missing");
});

test("duplicate basenames get a parent-directory hint, unique ones don't", () => {
  renderBar({ paths: ["src/a.ts", "lib/a.ts", "b.ts"], activePath: "src/a.ts" });
  expect(screen.getByText("src")).toBeInTheDocument();
  expect(screen.getByText("lib")).toBeInTheDocument();
  // b.ts is unique among the open tabs: no parent-dir hint rendered for it.
  expect(screen.queryByText("lib", { selector: "span" })).toBeInTheDocument();
});

test("context menu actions call the matching handler for that tab", () => {
  const { onClose, onCloseOthers, onCloseAll, onCopyPath } = renderBar();
  const tab = screen.getByRole("tab", { name: /b\.ts/ });

  fireEvent.contextMenu(tab);
  fireEvent.click(screen.getByText("他を閉じる"));
  expect(onCloseOthers).toHaveBeenCalledWith("b.ts");

  fireEvent.contextMenu(tab);
  fireEvent.click(screen.getByText("パスをコピー"));
  expect(onCopyPath).toHaveBeenCalledWith("b.ts");

  fireEvent.contextMenu(tab);
  fireEvent.click(screen.getByText("すべて閉じる"));
  expect(onCloseAll).toHaveBeenCalled();

  fireEvent.contextMenu(tab);
  fireEvent.click(screen.getByText("閉じる"));
  expect(onClose).toHaveBeenCalledWith("b.ts");
});
