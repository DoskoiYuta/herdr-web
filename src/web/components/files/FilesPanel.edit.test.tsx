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
  }) => (
    <div data-testid="code-file-view-stub" data-editable={editable ? "true" : "false"}>
      {path}:{contents}
      <textarea
        aria-label="code-editor"
        value={contents}
        readOnly={!editable}
        onChange={(e) => onEditChange?.(e.target.value)}
      />
    </div>
  ),
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
  within(tree).getByText(path).click();
}

async function editToggle() {
  return screen.findByRole("button", { name: /^編集/ });
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
  (await editToggle()).click();

  const editor = await screen.findByLabelText("code-editor");
  fireEvent.change(editor, { target: { value: "const x = 2;" } });

  const saveButton = await screen.findByRole("button", { name: "保存" });
  await waitFor(() => expect(saveButton).not.toBeDisabled());
  saveButton.click();

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
  (await editToggle()).click();
  fireEvent.change(await screen.findByLabelText("code-editor"), {
    target: { value: "const x = 2;" },
  });
  (await screen.findByRole("button", { name: "保存" })).click();

  const overwriteButton = await screen.findByRole("button", { name: "上書き保存" });
  overwriteButton.click();

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
  (await editToggle()).click();
  fireEvent.change(await screen.findByLabelText("code-editor"), {
    target: { value: "const x = 2;" },
  });
  (await screen.findByRole("button", { name: "保存" })).click();
  await screen.findByRole("button", { name: "上書き保存" });

  fileMock.mockResolvedValue(textFile({ hash: "h3", contents: "const x = 3;" }));
  screen.getByRole("button", { name: "破棄して再読込" }).click();

  await waitFor(() =>
    expect(screen.getByTestId("code-file-view-stub")).toHaveTextContent("const x = 3;"),
  );
});

test("dirty 中の外部変更（hash 変化）はバナーを出し、エディタの内容は保たれる", async () => {
  fileMock.mockResolvedValue(textFile());
  const { element } = renderPanel({ repoChangedTick: 0 });
  const { rerender } = render(element);
  await openFile();
  (await editToggle()).click();
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
  (await editToggle()).click();

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
  (await editToggle()).click();
  fireEvent.change(await screen.findByLabelText("code-editor"), {
    target: { value: "const x = 2;" },
  });

  screen.getByRole("button", { name: "a.ts を閉じる" }).click();
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
  (await editToggle()).click();
  fireEvent.change(await screen.findByLabelText("code-editor"), {
    target: { value: "const a = 2;" },
  });

  await openFile("b.ts");
  await screen.findByText(/b\.ts:const b = 1;/);

  (await screen.findByRole("tab", { name: /^a\.ts/ })).click();
  await waitFor(() =>
    expect(screen.getByTestId("code-file-view-stub")).toHaveTextContent("const a = 2;"),
  );
});

test("CRLF ファイルは保存時も CRLF のまま送られる", async () => {
  fileMock.mockResolvedValue(textFile({ contents: "const x = 1;\r\nconst y = 2;\r\n" }));
  writeFileMock.mockResolvedValue({ hash: "h2", size: 30 });
  render(renderPanel().element);
  await openFile();
  (await editToggle()).click();
  fireEvent.change(await screen.findByLabelText("code-editor"), {
    target: { value: "const x = 1;\nconst y = 3;\n" },
  });
  (await screen.findByRole("button", { name: "保存" })).click();

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
  (await editToggle()).click();

  expect(await screen.findByText("未解決の質問があります")).toBeInTheDocument();
  expect(screen.queryByLabelText("code-editor")).toHaveAttribute("readonly");

  screen.getByRole("button", { name: "続行" }).click();
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
