import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast/ToastProvider";
import type { Note } from "@/lib/api";

const listMock = vi.fn<(repoKey: string) => Promise<Note[]>>();
const createMock = vi.fn<(body: { repoKey: string; title?: string }) => Promise<Note>>();
const updateMock = vi.fn<(id: string, body: { title?: string; body?: string }) => Promise<Note>>();
const deleteMock = vi.fn<(id: string) => Promise<void>>();

vi.mock("@/lib/api", () => ({
  notesApi: {
    list: (repoKey: string) => listMock(repoKey),
    create: (body: { repoKey: string; title?: string }) => createMock(body),
    update: (id: string, body: { title?: string; body?: string }) => updateMock(id, body),
    delete: (id: string) => deleteMock(id),
  },
}));

vi.mock("@/components/files/MarkdownView", () => ({
  MarkdownView: ({
    contents,
    onChange,
  }: {
    contents: string;
    onChange?: (markdown: string) => void;
  }) => (
    <textarea
      data-testid="markdown-editor-stub"
      value={contents}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

const { NotesPanel } = await import("./NotesPanel");

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    repoKey: "/repo/.git",
    title: "TODO",
    body: "- a",
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    ...overrides,
  };
}

/** `selectedId` は URL 由来の controlled prop なので、行クリック後の実際の
 * URL 遷移（ToolPane.handleSelectNote）を模してテスト側で明示的に
 * rerender する。 */
function renderPanel(initialProps: Partial<React.ComponentProps<typeof NotesPanel>> = {}) {
  const client = new QueryClient();
  const onSelectId = vi.fn();
  function ui(props: Partial<React.ComponentProps<typeof NotesPanel>>): ReactElement {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>
          <NotesPanel repoKey="/repo/.git" selectedId={null} onSelectId={onSelectId} {...props} />
        </ToastProvider>
      </QueryClientProvider>
    );
  }
  const utils = render(ui(initialProps));
  return {
    onSelectId,
    ...utils,
    rerenderWith: (props: Partial<React.ComponentProps<typeof NotesPanel>>) =>
      utils.rerender(ui({ ...initialProps, ...props })),
  };
}

beforeEach(() => {
  listMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  deleteMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("NotesPanel", () => {
  // 無いと壊れる: repoKey が無いのに一覧/エディタを描こうとして herdr 未接続時に
  // クラッシュするか、意味の無い空リストを本物の空状態のように見せてしまう。
  test("repoKey が null のとき空状態を表示する", () => {
    listMock.mockResolvedValue([]);
    renderPanel({ repoKey: null });
    expect(screen.getByText("worktree を解決できません")).toBeInTheDocument();
    expect(listMock).not.toHaveBeenCalled();
  });

  // 無いと壊れる: 入力のたびに PATCH が飛び、サーバー負荷が上がるか、
  // 「保存中」表示がキー入力ごとにちらつく。
  test("入力が止まって 1 秒後に 1 回だけ PATCH される", async () => {
    listMock.mockResolvedValue([note()]);
    updateMock.mockResolvedValue(note({ body: "- a - edited" }));
    renderPanel();
    await screen.findByTestId("markdown-editor-stub");
    vi.useFakeTimers();

    fireEvent.change(screen.getByTestId("markdown-editor-stub"), {
      target: { value: "- a - ed" },
    });
    await act(async () => vi.advanceTimersByTimeAsync(400));
    fireEvent.change(screen.getByTestId("markdown-editor-stub"), {
      target: { value: "- a - edited" },
    });
    expect(updateMock).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith("n1", { body: "- a - edited" });
  });

  // 無いと壊れる: 1 秒経つ前に別ページへ切り替えると編集内容が PATCH されずに
  // 失われる。
  test("ページ切替で未保存分が flush される", async () => {
    listMock.mockResolvedValue([note({ id: "n1", title: "A" }), note({ id: "n2", title: "B" })]);
    updateMock.mockResolvedValue(note({ id: "n1", body: "edited" }));
    const { onSelectId, rerenderWith } = renderPanel();
    await screen.findByTestId("markdown-editor-stub");

    fireEvent.change(screen.getByTestId("markdown-editor-stub"), {
      target: { value: "edited" },
    });
    expect(updateMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("note-row-n2"));
    expect(onSelectId).toHaveBeenCalledWith("n2");

    // ToolPane が URL の `id` を書き換えて戻す遷移を模す。
    await act(async () => rerenderWith({ selectedId: "n2" }));
    expect(updateMock).toHaveBeenCalledWith("n1", { body: "edited" });
  });

  // 無いと壊れる: 「＋」を押しても一覧に増えず、新規ページが選択もされない。
  test("新規作成で一覧に増えて選択される", async () => {
    listMock.mockResolvedValue([]);
    createMock.mockResolvedValue(note({ id: "new1", title: "無題" }));
    const { onSelectId } = renderPanel();
    await screen.findByText("ページがありません");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "＋ ページを作成" }));
    });

    expect(createMock).toHaveBeenCalledWith({ repoKey: "/repo/.git", title: "無題" });
    expect(onSelectId).toHaveBeenCalledWith("new1");
  });

  // 無いと壊れる: 削除しても一覧からページが消えず、消したはずのページが
  // 開けてしまう。
  test("削除確認後に一覧から消える", async () => {
    listMock.mockResolvedValue([note({ id: "n1", title: "A" })]);
    deleteMock.mockResolvedValue(undefined);
    renderPanel();
    await screen.findByTestId("note-row-n1");

    fireEvent.click(screen.getByRole("button", { name: "「A」を削除" }));
    await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "削除" }));
    });

    expect(deleteMock).toHaveBeenCalledWith("n1");
    await waitFor(() => expect(screen.queryByTestId("note-row-n1")).not.toBeInTheDocument());
  });
});
