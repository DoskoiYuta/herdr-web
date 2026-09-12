// Files タブの編集モード + 明示保存（PUT /api/fs/file）の振る舞い。
// CodeFileView は @pierre/diffs のエディタごとモックし、`onEditChange` を
// textarea 経由で直接呼ぶ（本物のエディタは jsdom で動かないため）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast/ToastProvider";
import { HerdrStoreProvider } from "@/lib/HerdrStoreContext";
import { makeFakeStore } from "@/testing/renderWithRouter";
import type { FileResponse, LsResponse, StatResponse } from "@contract/fs";
import { resetFileEditsForTests } from "@/lib/fileDrafts";

const lsMock = vi.fn<(params: { root: string; dir: string }) => Promise<LsResponse>>();
const statusMock = vi.fn().mockResolvedValue({ status: [] });
const fileMock = vi.fn<(params: { root: string; path: string }) => Promise<FileResponse>>();
const writeFileMock = vi.fn<
  (params: { root: string; path: string; contents: string; baseHash: string }) => Promise<{
    hash: string;
    size: number;
  }>
>();
const statMock = vi.fn<(params: { root: string; paths: string[] }) => Promise<StatResponse>>();
const askForFileMock = vi.fn().mockResolvedValue([]);
const gitRootMock = vi.fn().mockResolvedValue({
  root: "/repo",
  commonDir: "/repo/.git",
  branch: "main",
  isMain: true,
  head: "headHash",
  rootCommit: "headHash",
});

const { WriteConflictError } = vi.hoisted(() => {
  class WriteConflictErrorImpl extends Error {
    hash: string;
    constructor(hash: string) {
      super("保存に失敗しました（ファイルが外部で変更されています）");
      this.name = "WriteConflictError";
      this.hash = hash;
    }
  }
  return { WriteConflictError: WriteConflictErrorImpl };
});

vi.mock("@/lib/api", () => ({
  gitApi: {
    status: (...args: [string]) => statusMock(...args),
    root: (...args: [string]) => gitRootMock(...args),
  },
  fsApi: {
    ls: (...args: [{ root: string; dir: string }]) => lsMock(...args),
    file: (...args: [{ root: string; path: string }]) => fileMock(...args),
    writeFile: (...args: [{ root: string; path: string; contents: string; baseHash: string }]) =>
      writeFileMock(...args),
    upload: vi.fn(),
    rawUrl: (params: { root: string; path: string; tick: number }) =>
      `/api/fs/raw?root=${encodeURIComponent(params.root)}&path=${encodeURIComponent(params.path)}&t=${params.tick}`,
    trash: vi.fn(),
    stat: (...args: [{ root: string; paths: string[] }]) => statMock(...args),
  },
  configApi: {
    get: vi.fn().mockResolvedValue({
      terminal: { fontFamily: "monospace", fontSize: 13, lineHeight: 1 },
      graphInitialCommits: 200,
      ask: { agents: ["claude"], defaultAgent: "claude", maxSessions: 5 },
    }),
  },
  askApi: {
    forFile: (...args: unknown[]) => askForFileMock(...args),
    counts: vi.fn().mockResolvedValue({ unresolved: 0, byPath: {} }),
    create: vi.fn(),
    reply: vi.fn(),
    resolve: vi.fn(),
    resend: vi.fn(),
    focus: vi.fn(),
    get: vi.fn(),
  },
  FileNotFoundError: class extends Error {},
  UploadConflictError: class extends Error {},
  TrashUnavailableError: class extends Error {},
  AskLimitError: class extends Error {},
  AskUnavailableError: class extends Error {},
  WriteConflictError,
}));

vi.mock("@/components/tree/PathTree", () => ({
  PathTree: ({
    paths,
    onSelectFile,
  }: {
    paths: string[];
    onSelectFile: (path: string) => void;
  }) => (
    <div data-testid="path-tree-stub">
      {paths.map((p) => (
        <button key={p} type="button" onClick={() => onSelectFile(p)}>
          {p}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("./MarkdownView", () => ({
  MarkdownView: ({ contents }: { contents: string }) => (
    <div data-testid="markdown-view-stub">{contents}</div>
  ),
}));

vi.mock("./HtmlFileView", () => ({
  HtmlFileView: ({ contents }: { contents: string }) => (
    <div data-testid="html-file-view-stub">{contents}</div>
  ),
}));

vi.mock("./CodeFileView", () => ({
  // Mimics the real `@pierre/diffs` editor (see M1): the textarea's buffer
  // is seeded from `contents` only at mount and otherwise ignores prop
  // changes — a naive controlled stub that always re-renders `contents`
  // into the textarea would hide the exact bug this is meant to catch
  // (the caller must force a remount, via `key`, whenever the editor's
  // underlying document needs to be rebuilt from a new base/draft).
  CodeFileView: ({
    path,
    contents,
    editable,
    onEditChange,
  }: {
    path: string;
    contents: string;
    editable?: boolean;
    onEditChange?: (contents: string) => void;
  }) => {
    const [buffer, setBuffer] = useState(contents);
    return (
      <div data-testid="code-file-view-stub" data-editable={editable ? "true" : "false"}>
        {path}:{contents}
        <textarea
          aria-label="code-editor"
          value={buffer}
          readOnly={!editable}
          onChange={(e) => {
            setBuffer(e.target.value);
            onEditChange?.(e.target.value);
          }}
        />
      </div>
    );
  },
}));

const { default: FilesPanel } = await import("./FilesPanel");

function ls(entries: LsResponse["entries"]): LsResponse {
  return { entries };
}

type FilesPanelTestProps = Partial<React.ComponentProps<typeof FilesPanel>>;

function TestFilesPanel({ ...rest }: FilesPanelTestProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [mdMode, setMdMode] = useState<"source" | "preview">("preview");
  return (
    <FilesPanel
      repo="/repo"
      repoChangedTick={0}
      repoKey="/repo"
      selectedPath={selectedPath}
      onSelectedPathChange={setSelectedPath}
      mdMode={mdMode}
      onMdModeChange={setMdMode}
      {...rest}
    />
  );
}

function renderPanel(props: FilesPanelTestProps = {}): {
  element: ReactElement;
  rerenderProps: (p: FilesPanelTestProps) => ReactElement;
} {
  const client = new QueryClient();
  const wrap = (p: FilesPanelTestProps) => (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <HerdrStoreProvider store={makeFakeStore()}>
          <TestFilesPanel {...p} />
        </HerdrStoreProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
  return { element: wrap(props), rerenderProps: wrap };
}

function textFile(overrides: Partial<Extract<FileResponse, { kind: "text" }>> = {}) {
  return {
    kind: "text" as const,
    path: "a.ts",
    contents: "const x = 1;",
    size: 12,
    hash: "h1",
    editable: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetFileEditsForTests();
  statusMock.mockResolvedValue({ status: [] });
  statMock.mockResolvedValue({});
  askForFileMock.mockResolvedValue([]);
  lsMock.mockResolvedValue(ls([{ name: "a.ts", kind: "file" }]));
});

afterEach(() => {
  vi.clearAllMocks();
});

async function openFile(path = "a.ts") {
  const tree = await screen.findByTestId("path-tree-stub");
  fireEvent.click(within(tree).getByText(path));
}

// S5: the toggle stays disabled until the for-file lookup (used to count
// unresolved questions) settles, so enabling it here mirrors what a user
// waits through in the real UI.
async function editToggle() {
  const button = await screen.findByRole("button", { name: /^編集/ });
  await waitFor(() => expect(button).not.toBeDisabled());
  return button;
}

test("editable: false のファイルは編集トグルが無効", async () => {
  fileMock.mockResolvedValue(textFile({ editable: false, readOnlyReason: "not-writable" }));
  render(renderPanel().element);
  await openFile();
  expect(await screen.findByRole("button", { name: "編集" })).toBeDisabled();
});

test("Markdown をプレビュー表示中は編集トグルが無効", async () => {
  lsMock.mockResolvedValue(ls([{ name: "a.md", kind: "file" }]));
  fileMock.mockResolvedValue(textFile({ path: "a.md", contents: "# hi" }));
  render(renderPanel().element);
  await openFile("a.md");
  // TestFilesPanel は mdMode を "preview" で初期化する。
  expect(await screen.findByRole("button", { name: "編集" })).toBeDisabled();
});

test("保存は base の hash で writeFile を呼び、成功後は下書きが消える", async () => {
  fileMock.mockResolvedValue(textFile());
  writeFileMock.mockResolvedValue({ hash: "h2", size: 20 });
  render(renderPanel().element);
  await openFile();
  fireEvent.click(await editToggle());

  const editor = await screen.findByLabelText("code-editor");
  fireEvent.change(editor, { target: { value: "const x = 2;" } });

  const saveButton = await screen.findByRole("button", { name: "保存" });
  await waitFor(() => expect(saveButton).not.toBeDisabled());
  fireEvent.click(saveButton);

  await waitFor(() =>
    expect(writeFileMock).toHaveBeenCalledWith({
      root: "/repo",
      path: "a.ts",
      contents: "const x = 2;",
      baseHash: "h1",
    }),
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeDisabled());
});

test("409 の衝突は上書き保存でディスク側 hash を使って再送する", async () => {
  fileMock.mockResolvedValue(textFile());
  writeFileMock
    .mockRejectedValueOnce(new WriteConflictError("diskHash"))
    .mockResolvedValueOnce({ hash: "diskHash2", size: 20 });
  render(renderPanel().element);
  await openFile();
  fireEvent.click(await editToggle());
  fireEvent.change(await screen.findByLabelText("code-editor"), {
    target: { value: "const x = 2;" },
  });
  fireEvent.click(await screen.findByRole("button", { name: "保存" }));

  const overwriteButton = await screen.findByRole("button", { name: "上書き保存" });
  fireEvent.click(overwriteButton);

  await waitFor(() =>
    expect(writeFileMock).toHaveBeenLastCalledWith({
      root: "/repo",
      path: "a.ts",
      contents: "const x = 2;",
      baseHash: "diskHash",
    }),
  );
});

test("破棄して再読込は下書きを捨ててディスク内容を取り直す", async () => {
  fileMock.mockResolvedValue(textFile());
  writeFileMock.mockRejectedValue(new WriteConflictError("diskHash"));
  render(renderPanel().element);
  await openFile();
  fireEvent.click(await editToggle());
  fireEvent.change(await screen.findByLabelText("code-editor"), {
    target: { value: "const x = 2;" },
  });
  fireEvent.click(await screen.findByRole("button", { name: "保存" }));
  await screen.findByRole("button", { name: "上書き保存" });

  fileMock.mockResolvedValue(textFile({ hash: "h3", contents: "const x = 3;" }));
  fireEvent.click(screen.getByRole("button", { name: "破棄して再読込" }));

  await waitFor(() =>
    expect(screen.getByTestId("code-file-view-stub")).toHaveTextContent("const x = 3;"),
  );
});

test("dirty 中の外部変更（hash 変化）はバナーを出し、エディタの内容は保たれる", async () => {
  fileMock.mockResolvedValue(textFile());
  const { element } = renderPanel({ repoChangedTick: 0 });
  const { rerender } = render(element);
  await openFile();
  fireEvent.click(await editToggle());
  fireEvent.change(await screen.findByLabelText("code-editor"), {
    target: { value: "const x = 2;" },
  });

  fileMock.mockResolvedValue(textFile({ hash: "h-external", contents: "const x = 99;" }));
  rerender(renderPanel({ repoChangedTick: 1 }).element);

  await screen.findByText("ディスク上で変更されました");
  expect(screen.getByTestId("code-file-view-stub")).toHaveTextContent("const x = 2;");
});

test("dirty でないときの外部変更（hash 変化）は追従する", async () => {
  fileMock.mockResolvedValue(textFile());
  const { rerender } = render(renderPanel({ repoChangedTick: 0 }).element);
  await openFile();
  fireEvent.click(await editToggle());

  fileMock.mockResolvedValue(textFile({ hash: "h-external", contents: "const x = 99;" }));
  rerender(renderPanel({ repoChangedTick: 1 }).element);

  await waitFor(() =>
    expect(screen.getByTestId("code-file-view-stub")).toHaveTextContent("const x = 99;"),
  );
  expect(screen.queryByText("ディスク上で変更されました")).not.toBeInTheDocument();
});

test("dirty なタブを閉じようとすると確認ダイアログが出る", async () => {
  fileMock.mockResolvedValue(textFile());
  render(renderPanel().element);
  await openFile();
  fireEvent.click(await editToggle());
  fireEvent.change(await screen.findByLabelText("code-editor"), {
    target: { value: "const x = 2;" },
  });

  fireEvent.click(screen.getByRole("button", { name: "a.ts を閉じる" }));
  expect(await screen.findAllByText("保存していない変更があります")).not.toHaveLength(0);
});

test("編集モードのままタブを切り替えて戻ると下書きが保持される", async () => {
  lsMock.mockResolvedValue(
    ls([
      { name: "a.ts", kind: "file" },
      { name: "b.ts", kind: "file" },
    ]),
  );
  fileMock.mockImplementation(async ({ path }) =>
    textFile({ path, contents: path === "a.ts" ? "const a = 1;" : "const b = 1;" }),
  );
  render(renderPanel().element);
  await openFile("a.ts");
  fireEvent.click(await editToggle());
  fireEvent.change(await screen.findByLabelText("code-editor"), {
    target: { value: "const a = 2;" },
  });

  await openFile("b.ts");
  await screen.findByText(/b\.ts:const b = 1;/);

  fireEvent.click(await screen.findByRole("tab", { name: /^a\.ts/ }));
  await waitFor(() =>
    expect(screen.getByTestId("code-file-view-stub")).toHaveTextContent("const a = 2;"),
  );
});

test("CRLF ファイルは保存時も CRLF のまま送られる", async () => {
  fileMock.mockResolvedValue(textFile({ contents: "const x = 1;\r\nconst y = 2;\r\n" }));
  writeFileMock.mockResolvedValue({ hash: "h2", size: 30 });
  render(renderPanel().element);
  await openFile();
  fireEvent.click(await editToggle());
  fireEvent.change(await screen.findByLabelText("code-editor"), {
    target: { value: "const x = 1;\nconst y = 3;\n" },
  });
  fireEvent.click(await screen.findByRole("button", { name: "保存" }));

  await waitFor(() =>
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ contents: "const x = 1;\r\nconst y = 3;\r\n" }),
    ),
  );
});

test("未解決の質問があるファイルの編集開始は確認ダイアログを出す", async () => {
  fileMock.mockResolvedValue(textFile());
  askForFileMock.mockResolvedValue([
    { ask: { id: "ask-1", status: "open" }, startLine: null, endLine: null },
  ]);
  render(renderPanel().element);
  await openFile();
  await waitFor(() => expect(askForFileMock).toHaveBeenCalled());
  fireEvent.click(await editToggle());

  expect(await screen.findByText("未解決の質問があります")).toBeInTheDocument();
  expect(screen.queryByLabelText("code-editor")).toHaveAttribute("readonly");

  fireEvent.click(screen.getByRole("button", { name: "続行" }));
  await waitFor(() => expect(screen.getByLabelText("code-editor")).not.toHaveAttribute("readonly"));
});

test("Cmd+S は編集モードでなければ何もしない", async () => {
  fileMock.mockResolvedValue(textFile());
  const { container } = render(renderPanel().element);
  await openFile();
  const root = container.querySelector('[class*="flex h-full min-h-0 flex-col"]') ?? container;
  fireEvent.keyDown(root, { key: "s", metaKey: true });
  expect(writeFileMock).not.toHaveBeenCalled();
});

// N1: 確認ダイアログの選択肢と Cmd+S の保存が競合してはいけない。
test("Cmd+S は確認ダイアログが開いている間は保存しない", async () => {
  fileMock.mockResolvedValue(textFile());
  const { container } = render(renderPanel().element);
  await openFile();
  fireEvent.click(await editToggle());
  fireEvent.change(await screen.findByLabelText("code-editor"), {
    target: { value: "const x = 2;" },
  });

  const editToggleButton = await screen.findByRole("button", { name: "編集 ON" });
  fireEvent.click(editToggleButton);
  await screen.findByText("保存していない変更があります");

  const root = container.querySelector('[class*="flex h-full min-h-0 flex-col"]') ?? container;
  fireEvent.keyDown(root, { key: "s", metaKey: true });
  expect(writeFileMock).not.toHaveBeenCalled();
});

// M1: pierre の Editor は `contents` prop の差し替えだけでは内部の
// TextDocument を作り直さない。表示は新内容でも編集用の文書が旧 draft の
// ままだと、次の入力が「旧文書 + その1文字」を返し、新しい baseHash と
// 組み合わさって楽観ロックを素通りしたまま外部の変更を上書き保存する。
test("破棄して再読込の直後の入力は、捨てたはずの下書きを復活させない", async () => {
  fileMock.mockResolvedValue(textFile({ contents: "alpha\n" }));
  writeFileMock
    .mockRejectedValueOnce(new WriteConflictError("diskHash"))
    .mockResolvedValueOnce({ hash: "h3", size: 20 });
  render(renderPanel().element);
  await openFile();
  fireEvent.click(await editToggle());
  const editor = () => screen.getByLabelText("code-editor") as HTMLTextAreaElement;
  fireEvent.change(editor(), { target: { value: "alpha X\n" } });
  fireEvent.click(await screen.findByRole("button", { name: "保存" }));
  await screen.findByRole("button", { name: "上書き保存" });

  fileMock.mockResolvedValue(textFile({ hash: "h-ext", contents: "alpha\neps\n" }));
  fireEvent.click(screen.getByRole("button", { name: "破棄して再読込" }));
  await waitFor(() => expect(editor().value).toBe("alpha\neps\n"));

  fireEvent.change(editor(), { target: { value: "alpha\neps\n W" } });
  fireEvent.click(await screen.findByRole("button", { name: "保存" }));

  await waitFor(() =>
    expect(writeFileMock).toHaveBeenLastCalledWith({
      root: "/repo",
      path: "a.ts",
      contents: "alpha\neps\n W",
      baseHash: "h-ext",
    }),
  );
});

// M2: `FilesPanel` はツールタブの切替（Files→Diff→Files 等）や worktree
// 切替のたびに unmount/remount される。下書きがこのコンポーネントの state
// にあると、そのどちらでも確認なしに消えてしまう。
test("FilesPanel を unmount しても下書きと編集 ON が保たれる", async () => {
  fileMock.mockResolvedValue(textFile());
  const { unmount } = render(renderPanel().element);
  await openFile();
  fireEvent.click(await editToggle());
  fireEvent.change(await screen.findByLabelText("code-editor"), {
    target: { value: "const x = 2;" },
  });
  unmount();

  render(renderPanel().element);
  await openFile();
  await waitFor(() =>
    expect(screen.getByTestId("code-file-view-stub")).toHaveAttribute("data-editable", "true"),
  );
  expect(screen.getByLabelText("code-editor")).toHaveValue("const x = 2;");
});

// M3: `useFile` は `placeholderData: keepPreviousData` を使うため、path
// 切替直後の `fileQuery.data` は前のファイルのもの。外部変更検出の effect
// がそれを見ないと、戻ってきたファイルに無関係な hash の偽バナーが出る。
test("タブ切替中の外部変更 tick は、戻った側のファイルに誤って波及しない", async () => {
  lsMock.mockResolvedValue(
    ls([
      { name: "a.ts", kind: "file" },
      { name: "b.ts", kind: "file" },
    ]),
  );
  fileMock.mockImplementation(async ({ path }) =>
    textFile({
      path,
      contents: path === "a.ts" ? "const a = 1;" : "const b = 1;",
      hash: path === "a.ts" ? "ha" : "hb",
    }),
  );
  const client = new QueryClient();
  const tree = (tick: number) => (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <HerdrStoreProvider store={makeFakeStore()}>
          <TestFilesPanel repoChangedTick={tick} />
        </HerdrStoreProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
  const { rerender } = render(tree(0));
  await openFile("b.ts");
  fireEvent.click(await editToggle());
  fireEvent.change(await screen.findByLabelText("code-editor"), {
    target: { value: "const b = 2;" },
  });

  await openFile("a.ts");
  await screen.findByText(/a\.ts:const a = 1;/);

  // b.ts を編集中に見ていなかった間に tick を上げる — 戻ったときの
  // fileQuery.data は一瞬 a.ts の placeholder のままになる。
  rerender(tree(1));
  await waitFor(() => expect(fileMock).toHaveBeenCalledWith({ root: "/repo", path: "a.ts" }));

  fireEvent.click(await screen.findByRole("tab", { name: /^b\.ts/ }));
  await screen.findByText(/b\.ts:const b = 2;/);
  expect(screen.queryByText("ディスク上で変更されました")).not.toBeInTheDocument();
});

// M4: closeAll/closeOthers も dirty ならタブ単体の close と同じ確認が要る
// ——さもないと保存していない編集が確認なしに画面から消える。
test("dirty なタブがあるとき「すべて閉じる」は確認を出し、破棄で下書きが消える", async () => {
  lsMock.mockResolvedValue(
    ls([
      { name: "a.ts", kind: "file" },
      { name: "b.ts", kind: "file" },
    ]),
  );
  fileMock.mockImplementation(async ({ path }) => textFile({ path, contents: path }));
  render(renderPanel().element);
  await openFile("a.ts");
  fireEvent.click(await editToggle());
  fireEvent.change(await screen.findByLabelText("code-editor"), {
    target: { value: "dirty a" },
  });
  await openFile("b.ts");

  const tab = await screen.findByRole("tab", { name: /^b\.ts/ });
  fireEvent.contextMenu(tab);
  fireEvent.click(screen.getByText("すべて閉じる"));

  expect(await screen.findByText(/保存していないタブが 1 件あります/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "破棄" }));

  await waitFor(() => expect(screen.queryByRole("tab")).not.toBeInTheDocument());
  await openFile("a.ts");
  await waitFor(() =>
    expect(screen.getByTestId("code-file-view-stub")).toHaveAttribute("data-editable", "false"),
  );
}, 20000);
