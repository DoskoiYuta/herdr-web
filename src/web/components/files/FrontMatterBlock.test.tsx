// front matter をキー/値のテーブルとして表示・編集する振る舞い
// (@/lib/frontMatterEntries.ts で行単位モデルに変換したものを描画する)。
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { FrontMatterBlock } from "./FrontMatterBlock";

const FM = "---\ntitle: Hello\ntags: [x]\n---\n";

test("表示モードで各キーと値がテーブルに表示される", () => {
  render(<FrontMatterBlock frontMatter={FM} editable={false} />);
  const card = screen.getByTestId("front-matter-card");
  expect(within(card).getByText("title")).toBeInTheDocument();
  expect(within(card).getByText("Hello")).toBeInTheDocument();
  expect(within(card).getByText("tags")).toBeInTheDocument();
  expect(within(card).getByText("[x]")).toBeInTheDocument();
});

test("値の入力欄を変えると他の行はそのままに変更後の生テキストが渡る", () => {
  const onChange = vi.fn();
  render(<FrontMatterBlock frontMatter={FM} editable={true} onChange={onChange} />);

  const valueInputs = screen.getAllByLabelText("front-matter-value");
  fireEvent.change(valueInputs[0]!, { target: { value: "World" } });

  expect(onChange).toHaveBeenLastCalledWith("---\ntitle: World\ntags: [x]\n---\n");
});

test("行を追加すると入力欄が増え、キーを埋めて保存すると末尾に反映される", () => {
  const onChange = vi.fn();
  render(<FrontMatterBlock frontMatter={FM} editable={true} onChange={onChange} />);

  fireEvent.click(screen.getByRole("button", { name: "行を追加" }));
  expect(screen.getAllByLabelText("front-matter-key")).toHaveLength(3);

  const keyInputs = screen.getAllByLabelText("front-matter-key");
  fireEvent.change(keyInputs[2]!, { target: { value: "extra" } });

  expect(onChange).toHaveBeenLastCalledWith("---\ntitle: Hello\ntags: [x]\nextra: \n---\n");
});

test("行を削除できる", () => {
  const onChange = vi.fn();
  render(<FrontMatterBlock frontMatter={FM} editable={true} onChange={onChange} />);

  const deleteButtons = screen.getAllByRole("button", { name: "front matter の行を削除" });
  fireEvent.click(deleteButtons[0]!);

  expect(onChange).toHaveBeenLastCalledWith("---\ntags: [x]\n---\n");
});
