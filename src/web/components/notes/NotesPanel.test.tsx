import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, type ReactElement } from "react";
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

// wysimark の実際の挙動（node_modules/@wysimark/react/.dist/browser/index.esm.js
// の Editable2）を模す: `contents`（value prop）を受け取るたびに、その内容を
// そのまま onChange で返す。実物は mount 時も value prop を一度読み込むため、
// 再マウントであっても「同じ内容の onChange」は起こりうる — NotesPanel 側の
// 「直近の確定内容と同じなら保存しない」ガードが無いと、ページ切替のたびに
// 無変化の PATCH が飛ぶ。
vi.mock("@/components/files/MarkdownView", () => ({
  MarkdownView: ({
    contents,
    onChange,
  }: {
    contents: string;
    onChange?: (markdown: string) => void;
  }) => {
    useEffect(() => {
      onChange?.(contents);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contents]);
    return (
      <textarea
        data-testid="markdown-editor-stub"
        value={contents}
        onChange={(e) => onChange?.(e.target.value)}
      />
    );
  },
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

  // 【実走で確認】無いと壊れる: wysimark の Editable は value prop（contents）が
  // 変わると parse→serialize した同一内容の onChange を発火しうる
  // （ignoreNextChangeRef は wysimark 側で参照されておらず効かない）。編集して
  // いない方のページに切り替えただけで PATCH が飛び、updatedAt が更新される
  // ＝他ブラウザの編集を無編集側が上書きしうる。
  test("ページ切替直後は（編集していなくても）PATCH が呼ばれない", async () => {
    listMock.mockResolvedValue([
      note({ id: "n1", title: "A", body: "body A" }),
      note({ id: "n2", title: "B", body: "body B" }),
    ]);
    const { rerenderWith } = renderPanel();
    await screen.findByTestId("markdown-editor-stub");

    fireEvent.click(screen.getByTestId("note-row-n2"));
    await act(async () => rerenderWith({ selectedId: "n2" }));

    vi.useFakeTimers();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(updateMock).not.toHaveBeenCalled();
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

  // 無いと壊れる: 削除済み・別リポジトリの残骸など、一覧に無い id が URL に
  // 残っていると selectedNote が null になり、ページがあるのに空状態を
  // 出してしまう。
  test("URL の id が一覧に無いとき先頭ページが表示される", async () => {
    listMock.mockResolvedValue([note({ id: "n1", title: "A" }), note({ id: "n2", title: "B" })]);
    renderPanel({ selectedId: "gone" });
    await screen.findByTestId("markdown-editor-stub");
    expect(screen.getByDisplayValue("A")).toBeInTheDocument();
  });

  // 無いと壊れる: 削除しても一覧からページが消えず、消したはずのページが
  // 開けてしまう。
  // Radix のメニュー描画は jsdom ではフルスイートの並走時に既定の 5s を
  // 超えることがある（WorktreeSelect.open.test.tsx と同じ理由）。
  test("削除確認後に一覧から消える", async () => {
    listMock.mockResolvedValue([note({ id: "n1", title: "A" })]);
    deleteMock.mockResolvedValue(undefined);
    renderPanel();
    await screen.findByTestId("note-row-n1");

    fireEvent.pointerDown(screen.getByRole("button", { name: "「A」のメニュー" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "削除" }));
    await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "削除" }));
    });

    expect(deleteMock).toHaveBeenCalledWith("n1");
    await waitFor(() => expect(screen.queryByTestId("note-row-n1")).not.toBeInTheDocument());
  }, 20_000);

  // 無いと壊れる: 行のメニューから id をコピーする手段が無く、エージェントに
  // `hw notes show <id>` を伝えるのに本文中の id を手打ちさせることになる。
  test("メニューの「コマンドをコピー」で hw notes show <短縮 id> がコピーされる", async () => {
    listMock.mockResolvedValue([note({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", title: "A" })]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderPanel();
    await screen.findByTestId("note-row-01ARZ3NDEKTSV4RRFFQ69G5FAV");

    fireEvent.pointerDown(screen.getByRole("button", { name: "「A」のメニュー" }), {
      button: 0,
      ctrlKey: false,
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("menuitem", { name: "コマンドをコピー" }));
    });

    expect(writeText).toHaveBeenCalledWith("hw notes show Q69G5FAV");
  }, 20_000);
});
