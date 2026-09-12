import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast/ToastProvider";
import { HerdrStoreProvider } from "@/lib/HerdrStoreContext";
import { makeFakeStore } from "@/testing/renderWithRouter";
import type { StatusResponse } from "@contract/git";
import type { FileResponse, LsResponse, StatResponse, TrashResponse } from "@contract/fs";

const lsMock = vi.fn<(params: { root: string; dir: string }) => Promise<LsResponse>>();
const statusMock = vi.fn<(repo: string) => Promise<StatusResponse>>();
const fileMock = vi.fn<(params: { root: string; path: string }) => Promise<FileResponse>>();
const statMock = vi.fn<(params: { root: string; paths: string[] }) => Promise<StatResponse>>();
const uploadMock =
  vi.fn<
    (params: {
      root: string;
      dir: string;
      files: File[];
      overwrite?: boolean;
    }) => Promise<{ written: string[] }>
  >();
const trashMock = vi.fn<(params: { root: string; path: string }) => Promise<TrashResponse>>();

const askForFileMock = vi.fn().mockResolvedValue([]);
const askCountsMock = vi.fn().mockResolvedValue({ unresolved: 0, byPath: {} });
const gitRootMock = vi.fn().mockResolvedValue({
  root: "/repo",
  commonDir: "/repo/.git",
  branch: "main",
  isMain: true,
  head: "headHash",
  rootCommit: "headHash",
});

const {
  FileNotFoundError,
  UploadConflictError,
  TrashUnavailableError,
  AskLimitError,
  AskUnavailableError,
} = vi.hoisted(() => {
  class FileNotFoundErrorImpl extends Error {
    path: string;
    constructor(path: string) {
      super(`not found: ${path}`);
      this.name = "FileNotFoundError";
      this.path = path;
    }
  }
  class UploadConflictErrorImpl extends Error {
    paths: string[];
    constructor(paths: string[]) {
      super("既存のファイルと衝突しました");
      this.name = "UploadConflictError";
      this.paths = paths;
    }
  }
  class TrashUnavailableErrorImpl extends Error {
    constructor() {
      super("この環境ではゴミ箱に移動できません");
      this.name = "TrashUnavailableError";
    }
  }
  class AskLimitErrorImpl extends Error {
    limit: number;
    constructor(limit: number) {
      super(`質問セッションの上限 (${limit}) に達しています。解決して閉じてください`);
      this.name = "AskLimitError";
      this.limit = limit;
    }
  }
  class AskUnavailableErrorImpl extends Error {
    constructor() {
      super("herdr 未接続");
      this.name = "AskUnavailableError";
    }
  }
  return {
    FileNotFoundError: FileNotFoundErrorImpl,
    UploadConflictError: UploadConflictErrorImpl,
    TrashUnavailableError: TrashUnavailableErrorImpl,
    AskLimitError: AskLimitErrorImpl,
    AskUnavailableError: AskUnavailableErrorImpl,
  };
});

vi.mock("@/lib/api", () => ({
  gitApi: {
    status: (...args: [string]) => statusMock(...args),
    root: (...args: [string]) => gitRootMock(...args),
  },
  fsApi: {
    ls: (...args: [{ root: string; dir: string }]) => lsMock(...args),
    file: (...args: [{ root: string; path: string }]) => fileMock(...args),
    upload: (...args: [{ root: string; dir: string; files: File[]; overwrite?: boolean }]) =>
      uploadMock(...args),
    rawUrl: (params: { root: string; path: string; tick: number }) =>
      `/api/fs/raw?root=${encodeURIComponent(params.root)}&path=${encodeURIComponent(params.path)}&t=${params.tick}`,
    trash: (...args: [{ root: string; path: string }]) => trashMock(...args),
    stat: (...args: [{ root: string; paths: string[] }]) => statMock(...args),
  },
  configApi: {
    get: vi.fn().mockResolvedValue({
      terminal: { fontFamily: "monospace", fontSize: 13, lineHeight: 1 },
      graphInitialCommits: 200,
      ask: { agents: ["claude", "codex", "gemini"], defaultAgent: "claude", maxSessions: 5 },
    }),
  },
  askApi: {
    forFile: (...args: unknown[]) => askForFileMock(...args),
    counts: (...args: unknown[]) => askCountsMock(...args),
    create: vi.fn(),
    reply: vi.fn(),
    resolve: vi.fn(),
    resend: vi.fn(),
    focus: vi.fn(),
    get: vi.fn(),
  },
  FileNotFoundError,
  UploadConflictError,
  TrashUnavailableError,
  AskLimitError,
  AskUnavailableError,
}));

vi.mock("@/components/tree/PathTree", () => ({
  PathTree: ({
    paths,
    onSelectFile,
    onExpandedDirsChange,
    contextMenuItems,
    onExternalDrop,
    onExternalDragOver,
  }: {
    paths: string[];
    onSelectFile: (path: string) => void;
    onExpandedDirsChange: (dirs: string[]) => void;
    contextMenuItems?: (item: {
      path: string;
      kind: "file" | "directory";
    }) => { label: string; onSelect: () => void }[];
    onExternalDrop?: (target: { dir: string }, dataTransfer: DataTransfer) => void;
    onExternalDragOver?: (dir: string | null) => void;
  }) => (
    <div data-testid="path-tree-stub">
      {paths.map((p) => (
        <button key={p} type="button" onClick={() => onSelectFile(p)}>
          {p}
        </button>
      ))}
      <button type="button" onClick={() => onExpandedDirsChange(["src"])}>
        expand-src
      </button>
      <button type="button" onClick={() => onExpandedDirsChange([])}>
        collapse-all
      </button>
      {contextMenuItems?.({ path: "a.md", kind: "file" }).map((mi) => (
        <button key={mi.label} type="button" onClick={mi.onSelect}>
          {mi.label}
        </button>
      ))}
      {contextMenuItems?.({ path: "src/", kind: "directory" }).map((mi) => (
        <button key={`dir-${mi.label}`} type="button" onClick={mi.onSelect}>
          dir-{mi.label}
        </button>
      ))}
      <button
        type="button"
        onClick={() =>
          onExternalDrop?.({ dir: "src" }, { types: ["Files"] } as unknown as DataTransfer)
        }
      >
        drop-into-src
      </button>
      <button type="button" onClick={() => onExternalDragOver?.("src")}>
        drag-over-src
      </button>
      <button type="button" onClick={() => onExternalDragOver?.(null)}>
        drag-leave
      </button>
    </div>
  ),
}));

const collectDroppedFilesMock = vi.fn<(dataTransfer: DataTransfer) => Promise<File[]>>();
vi.mock("@/lib/dropEntries", () => ({
  collectDroppedFiles: (dataTransfer: DataTransfer) => collectDroppedFilesMock(dataTransfer),
}));

vi.mock("./MarkdownView", () => ({
  MarkdownView: ({
    contents,
    scrollTop,
    onScrollTopChange,
  }: {
    contents: string;
    scrollTop?: number;
    onScrollTopChange?: (top: number) => void;
  }) => (
    <div data-testid="markdown-view-stub">
      <span data-testid="markdown-view-scroll-top">{scrollTop ?? "none"}</span>
      {contents}
      <button type="button" onClick={() => onScrollTopChange?.(77)}>
        report-markdown-scroll
      </button>
    </div>
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
    scrollTop,
    onScrollTopChange,
  }: {
    path: string;
    contents: string;
    scrollTop?: number;
    onScrollTopChange?: (top: number) => void;
  }) => (
    <div data-testid="code-file-view-stub">
      <span data-testid="code-file-view-scroll-top">{scrollTop ?? "none"}</span>
      {path}:{contents}
      <button type="button" onClick={() => onScrollTopChange?.(123)}>
        report-code-scroll
      </button>
    </div>
  ),
}));

const { default: FilesPanel } = await import("./FilesPanel");

function ls(entries: LsResponse["entries"] = []): LsResponse {
  return { entries };
}

type FilesPanelTestProps = Partial<React.ComponentProps<typeof FilesPanel>>;

/** Stands in for ToolPane: owns `selectedPath`/`mdMode` locally so tests can
 * click a tree entry (via the PathTree stub below) and see FilesPanel react,
 * exactly as it did when FilesPanel owned that state itself. */
function TestFilesPanel({ initialLocation, ...rest }: FilesPanelTestProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(initialLocation?.path ?? null);
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
      initialLocation={initialLocation}
      {...rest}
    />
  );
}

function renderPanel(props: FilesPanelTestProps = {}): ReactElement {
  const client = new QueryClient();
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <HerdrStoreProvider store={makeFakeStore()}>
          <TestFilesPanel {...props} />
        </HerdrStoreProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const writeTextMock = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  statusMock.mockResolvedValue({ status: [] });
  fileMock.mockResolvedValue({
    kind: "text",
    path: "a.md",
    contents: "# hi",
    size: 4,
    hash: "h",
    editable: true,
  });
  statMock.mockResolvedValue({});
  writeTextMock.mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText: writeTextMock } });
  collectDroppedFilesMock.mockResolvedValue([new File(["x"], "a.txt")]);
});

afterEach(() => {
  vi.clearAllMocks();
});

test("shows a placeholder when nothing is selected", async () => {
  lsMock.mockResolvedValue(ls([{ name: "a.md", kind: "file" }]));
  render(renderPanel());
  expect(await screen.findByText("ファイルを選択してください")).toBeInTheDocument();
});

test("hides the repository's .git directory from the tree", async () => {
  lsMock.mockResolvedValue(
    ls([
      { name: ".git", kind: "dir" },
      { name: "a.md", kind: "file" },
    ]),
  );
  render(renderPanel());
  expect(await screen.findByText("a.md")).toBeInTheDocument();
  expect(screen.queryByText(".git")).not.toBeInTheDocument();
});

test("selecting a .md file loads and routes it to MarkdownView", async () => {
  lsMock.mockResolvedValue(ls([{ name: "a.md", kind: "file" }]));
  fileMock.mockResolvedValue({
    kind: "text",
    path: "a.md",
    contents: "# hi",
    size: 4,
    hash: "h",
    editable: true,
  });
  render(renderPanel());
  (await screen.findByText("a.md")).click();
  expect(await screen.findByTestId("markdown-view-stub")).toHaveTextContent("# hi");
  expect(fileMock).toHaveBeenCalledWith({ root: "/repo", path: "a.md" });
});

test("selecting a .html file loads and routes it to HtmlFileView", async () => {
  lsMock.mockResolvedValue(ls([{ name: "a.html", kind: "file" }]));
  fileMock.mockResolvedValue({
    kind: "text",
    path: "a.html",
    contents: "<h1>hi</h1>",
    size: 11,
    hash: "h",
    editable: true,
  });
  render(renderPanel());
  (await screen.findByText("a.html")).click();
  expect(await screen.findByTestId("html-file-view-stub")).toHaveTextContent("<h1>hi</h1>");
  expect(fileMock).toHaveBeenCalledWith({ root: "/repo", path: "a.html" });
});

test("switching the markdown viewer to ソース routes it to CodeFileView instead", async () => {
  lsMock.mockResolvedValue(ls([{ name: "a.md", kind: "file" }]));
  fileMock.mockResolvedValue({
    kind: "text",
    path: "a.md",
    contents: "# hi",
    size: 4,
    hash: "h",
    editable: true,
  });
  render(renderPanel());
  (await screen.findByText("a.md")).click();
  await screen.findByTestId("markdown-view-stub");

  fireEvent.mouseDown(screen.getByRole("tab", { name: "ソース" }));

  expect(await screen.findByTestId("code-file-view-stub")).toHaveTextContent("a.md:# hi");
  expect(screen.queryByTestId("markdown-view-stub")).not.toBeInTheDocument();
});

test("selecting a non-markdown file routes it to CodeFileView", async () => {
  lsMock.mockResolvedValue(ls([{ name: "a.ts", kind: "file" }]));
  fileMock.mockResolvedValue({
    kind: "text",
    path: "a.ts",
    contents: "const x = 1;",
    size: 12,
    hash: "h",
    editable: true,
  });
  render(renderPanel());
  (await screen.findByText("a.ts")).click();
  const view = await screen.findByTestId("code-file-view-stub");
  expect(view).toHaveTextContent("a.ts:const x = 1;");
});

test("an initialLocation prop selects the path without a click, and calls onInitialLocationConsumed once the file has loaded", async () => {
  lsMock.mockResolvedValue(ls([{ name: "a.ts", kind: "file" }]));
  fileMock.mockResolvedValue({
    kind: "text",
    path: "a.ts",
    contents: "const x = 1;",
    size: 12,
    hash: "h",
    editable: true,
  });
  const onInitialLocationConsumed = vi.fn();
  render(
    renderPanel({
      initialLocation: { path: "a.ts", line: 3 },
      onInitialLocationConsumed,
    }),
  );
  const view = await screen.findByTestId("code-file-view-stub");
  expect(view).toHaveTextContent("a.ts:const x = 1;");
  await waitFor(() => expect(onInitialLocationConsumed).toHaveBeenCalled());
});

test.each(["logo.png", "logo.PNG", "icon.svg", "photo.jpg"])(
  "selecting %s renders an img from the raw URL and skips gitApi.file",
  async (name) => {
    lsMock.mockResolvedValue(ls([{ name, kind: "file" }]));
    render(renderPanel());
    (await screen.findByText(name)).click();
    const img = await screen.findByAltText(name);
    expect(img).toHaveAttribute("src", expect.stringContaining(`path=${encodeURIComponent(name)}`));
    expect(fileMock).not.toHaveBeenCalled();
  },
);

test("selecting a .pdf file renders an iframe from the raw URL", async () => {
  lsMock.mockResolvedValue(ls([{ name: "doc.pdf", kind: "file" }]));
  render(renderPanel());
  (await screen.findByText("doc.pdf")).click();
  const iframe = await screen.findByTitle("doc.pdf");
  expect(iframe.tagName).toBe("IFRAME");
  expect(iframe).toHaveAttribute("src", expect.stringContaining("path=doc.pdf"));
  expect(fileMock).not.toHaveBeenCalled();
});

// Without this, a broken/unreadable image would silently render nothing
// instead of telling the user the preview failed.
test("shows a load-failure message when the image preview errors", async () => {
  lsMock.mockResolvedValue(ls([{ name: "logo.png", kind: "file" }]));
  render(renderPanel());
  (await screen.findByText("logo.png")).click();
  const img = await screen.findByAltText("logo.png");
  img.dispatchEvent(new Event("error"));
  expect(await screen.findByText("プレビューを読み込めませんでした")).toBeInTheDocument();
});

test("clicking the image preview toggles fit and full-size, resetting on a new selection", async () => {
  lsMock.mockResolvedValue(
    ls([
      { name: "logo.png", kind: "file" },
      { name: "b.png", kind: "file" },
    ]),
  );
  render(renderPanel());
  (await screen.findByText("logo.png")).click();
  const img = await screen.findByAltText("logo.png");
  expect(img).toHaveAttribute("data-zoomed", "false");

  img.click();
  await waitFor(() => expect(img).toHaveAttribute("data-zoomed", "true"));

  (await screen.findByText("b.png")).click();
  const img2 = await screen.findByAltText("b.png");
  expect(img2).toHaveAttribute("data-zoomed", "false");
});

test("shows the binary-file message with size", async () => {
  lsMock.mockResolvedValue(ls([{ name: "bin", kind: "file" }]));
  fileMock.mockResolvedValue({ kind: "binary", path: "bin", size: 42 });
  render(renderPanel());
  (await screen.findByText("bin")).click();
  expect(await screen.findByText("バイナリファイル")).toBeInTheDocument();
  expect(screen.getByText("bin · 42 bytes")).toBeInTheDocument();
});

test("shows the too-large message with size and the cap", async () => {
  lsMock.mockResolvedValue(ls([{ name: "big", kind: "file" }]));
  fileMock.mockResolvedValue({ kind: "too-large", path: "big", size: 5_000_000 });
  render(renderPanel());
  (await screen.findByText("big")).click();
  expect(await screen.findByText("2 MiB を超えています")).toBeInTheDocument();
  expect(screen.getAllByText("5000000 bytes").length).toBeGreaterThan(0);
});

// 無いと壊れる: バイナリ/too-large 状態でパスをコピーする手段が無いと、
// 中身を見られないファイルをエージェントに渡す方法が無くなる。
test("binary/too-large states offer a 絶対パスをコピー action", async () => {
  lsMock.mockResolvedValue(ls([{ name: "bin", kind: "file" }]));
  fileMock.mockResolvedValue({ kind: "binary", path: "bin", size: 42 });
  render(renderPanel());
  (await screen.findByText("bin")).click();
  await screen.findByText("バイナリファイル");

  // The tree stub also renders a same-labelled context-menu button (for
  // "a.md", unrelated to this test) — scope to the ones outside the tree.
  const copyButtons = screen
    .getAllByRole("button", { name: "絶対パスをコピー" })
    .filter((btn) => !btn.closest('[data-testid="path-tree-stub"]'));
  expect(copyButtons).toHaveLength(1);
  copyButtons[0]!.click();

  await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith("/repo/bin"));
});

test("shows a not-found message when gitApi.file throws FileNotFoundError", async () => {
  lsMock.mockResolvedValue(ls([{ name: "gone.ts", kind: "file" }]));
  fileMock.mockRejectedValue(new FileNotFoundError("gone.ts"));
  render(renderPanel());
  (await screen.findByText("gone.ts")).click();
  expect(await screen.findByText("ファイルがありません（削除済み）")).toBeInTheDocument();
});

test("shows the root listing's error message", async () => {
  lsMock.mockRejectedValue(new Error("boom"));
  render(renderPanel());
  expect(await screen.findByText("boom")).toBeInTheDocument();
});

test("shows the selected path in the header", async () => {
  lsMock.mockResolvedValue(ls([{ name: "a.ts", kind: "file" }]));
  fileMock.mockResolvedValue({
    kind: "text",
    path: "a.ts",
    contents: "x",
    size: 1,
    hash: "h",
    editable: true,
  });
  render(renderPanel());
  (await screen.findByText("a.ts")).click();
  await waitFor(() => expect(screen.getByTestId("code-file-view-stub")).toBeInTheDocument());
  expect(screen.getAllByText("a.ts").length).toBeGreaterThan(0);
});

test("expanding a directory fetches its listing and passes children as dir/name paths", async () => {
  lsMock.mockImplementation(({ dir }) =>
    Promise.resolve(
      dir === "src" ? ls([{ name: "index.ts", kind: "file" }]) : ls([{ name: "src", kind: "dir" }]),
    ),
  );
  render(renderPanel());
  (await screen.findByText("expand-src")).click();
  await waitFor(() => expect(lsMock).toHaveBeenCalledWith({ root: "/repo", dir: "src" }));
  expect(await screen.findByText("src/index.ts")).toBeInTheDocument();
});

test("collapsing a directory keeps its already-listed children in the tree", async () => {
  lsMock.mockImplementation(({ dir }) =>
    Promise.resolve(
      dir === "src" ? ls([{ name: "index.ts", kind: "file" }]) : ls([{ name: "src", kind: "dir" }]),
    ),
  );
  render(renderPanel());
  (await screen.findByText("expand-src")).click();
  expect(await screen.findByText("src/index.ts")).toBeInTheDocument();
  screen.getByText("collapse-all").click();
  await waitFor(() => expect(screen.getByText("src/index.ts")).toBeInTheDocument());
});

test("relative-path copy item copies the path as-is for a file", async () => {
  lsMock.mockResolvedValue(ls([]));
  render(renderPanel());
  (await screen.findByText("相対パスをコピー")).click();
  await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith("a.md"));
});

test("absolute-path copy item prefixes the repo root", async () => {
  lsMock.mockResolvedValue(ls([]));
  render(renderPanel());
  (await screen.findByText("絶対パスをコピー")).click();
  await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith("/repo/a.md"));
});

test("copying a directory's relative path strips the trailing slash", async () => {
  lsMock.mockResolvedValue(ls([]));
  render(renderPanel());
  (await screen.findByText("dir-相対パスをコピー")).click();
  await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith("src"));
});

// Without this, a clipboard failure (permissions, insecure context) would
// leave the user with no feedback that the copy silently did nothing.
test("shows a message when the clipboard write fails", async () => {
  lsMock.mockResolvedValue(ls([]));
  writeTextMock.mockRejectedValue(new Error("denied"));
  render(renderPanel());
  (await screen.findByText("相対パスをコピー")).click();
  expect(await screen.findByText("クリップボードにコピーできませんでした")).toBeInTheDocument();
});

test("shows a hint naming the hovered directory while an external drag is over the tree, and clears it on drag-leave", async () => {
  lsMock.mockResolvedValue(ls([]));
  render(renderPanel());

  expect(screen.queryByText(/にドロップして取り込む/)).not.toBeInTheDocument();

  (await screen.findByText("drag-over-src")).click();
  expect(await screen.findByText("src/ にドロップして取り込む")).toBeInTheDocument();

  (await screen.findByText("drag-leave")).click();
  await waitFor(() => expect(screen.queryByText(/にドロップして取り込む/)).not.toBeInTheDocument());
});

test("dropping files uploads them to the hovered directory and invalidates the ls queries", async () => {
  lsMock.mockResolvedValue(ls([]));
  uploadMock.mockResolvedValue({ written: ["a.txt"] });
  render(renderPanel());
  (await screen.findByText("drop-into-src")).click();
  await waitFor(() =>
    expect(uploadMock).toHaveBeenCalledWith({
      root: "/repo",
      dir: "src",
      files: [expect.any(File)],
      overwrite: false,
    }),
  );
  expect(await screen.findByText("1 件をインポートしました")).toBeInTheDocument();
});

// レビュー指摘: toast 移行で「インポート中… (N 件)」の進捗表示が消えた。
// アップロード中は sticky な進捗 toast が出続け、完了でそれが結果 toast に
// 置き換わる（積み重ならない）ことを確認する。
test("shows a sticky upload-progress toast that gets replaced by the result on completion", async () => {
  lsMock.mockResolvedValue(ls([]));
  let resolveUpload: (v: { written: string[] }) => void = () => {};
  uploadMock.mockReturnValue(
    new Promise((resolve) => {
      resolveUpload = resolve;
    }),
  );
  render(renderPanel());
  (await screen.findByText("drop-into-src")).click();

  expect(await screen.findByText("インポート中… (1 件)")).toBeInTheDocument();

  resolveUpload({ written: ["a.txt"] });
  expect(await screen.findByText("1 件をインポートしました")).toBeInTheDocument();
  expect(screen.queryByText("インポート中… (1 件)")).not.toBeInTheDocument();
  expect(screen.getAllByTestId("toast")).toHaveLength(1);
});

test("a 409 conflict opens a dialog listing the paths, and 上書き retries with overwrite", async () => {
  lsMock.mockResolvedValue(ls([]));
  uploadMock
    .mockRejectedValueOnce(new UploadConflictError(["a.txt"]))
    .mockResolvedValueOnce({ written: ["a.txt"] });
  render(renderPanel());
  (await screen.findByText("drop-into-src")).click();
  expect(await screen.findByText("既存のファイルと衝突しました")).toBeInTheDocument();
  expect(screen.getByText("a.txt")).toBeInTheDocument();
  screen.getByText("上書き").click();
  await waitFor(() =>
    expect(uploadMock).toHaveBeenLastCalledWith({
      root: "/repo",
      dir: "src",
      files: [expect.any(File)],
      overwrite: true,
    }),
  );
});

// トラッシュ後もタブ自体は残る（取り消し線になるかは fs-stat の再確認 —
// 別テストの対象）。選択は一度 null に落ちても「アクティブなタブを復元する」
// 規則がすぐ元の a.md に戻すため、プレースホルダーには留まらない。
test("ゴミ箱に移動 confirms and trashes the file; its tab stays open (not closed)", async () => {
  lsMock.mockResolvedValue(ls([{ name: "a.md", kind: "file" }]));
  fileMock.mockResolvedValue({
    kind: "text",
    path: "a.md",
    contents: "# hi",
    size: 4,
    hash: "h",
    editable: true,
  });
  trashMock.mockResolvedValue({ trashed: "a.md" });
  render(renderPanel());

  (await screen.findByText("a.md")).click();
  await screen.findByTestId("markdown-view-stub");

  (await screen.findByText("ゴミ箱に移動")).click();
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("a.md")).toBeInTheDocument();
  within(dialog).getByRole("button", { name: "ゴミ箱に移動" }).click();

  await waitFor(() => expect(trashMock).toHaveBeenCalledWith({ root: "/repo", path: "a.md" }));
  expect(await screen.findByText("ゴミ箱に移動しました: a.md")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /a\.md/ })).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: /a\.md/ })).toHaveAttribute("aria-selected", "true"),
  );
});

test("ゴミ箱に移動 on a directory notes that its contents move too", async () => {
  lsMock.mockResolvedValue(ls([]));
  render(renderPanel());

  (await screen.findByText("dir-ゴミ箱に移動")).click();
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("ディレクトリの場合は中身ごと移動します")).toBeInTheDocument();
});

// Without this, a 501 (no OS-trash backend on this machine) would surface
// as a generic error message instead of telling the user why it can't work.
test("a 501 from fsApi.trash shows the unavailable message", async () => {
  lsMock.mockResolvedValue(ls([{ name: "a.md", kind: "file" }]));
  fileMock.mockResolvedValue({
    kind: "text",
    path: "a.md",
    contents: "# hi",
    size: 4,
    hash: "h",
    editable: true,
  });
  trashMock.mockRejectedValue(new TrashUnavailableError());
  render(renderPanel());

  (await screen.findByText("ゴミ箱に移動")).click();
  within(await screen.findByRole("dialog"))
    .getByRole("button", { name: "ゴミ箱に移動" })
    .click();

  expect(await screen.findByText("この環境ではゴミ箱に移動できません")).toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// File tab bar (ui-redesign.md §5.4)
// ---------------------------------------------------------------------------

test("clicking tree entries opens tabs in click order; reclicking an open tab doesn't duplicate it", async () => {
  lsMock.mockResolvedValue(
    ls([
      { name: "a.ts", kind: "file" },
      { name: "b.ts", kind: "file" },
    ]),
  );
  fileMock.mockImplementation(({ path }) =>
    Promise.resolve({ kind: "text", path, contents: path, size: 1, hash: "h", editable: true }),
  );
  render(renderPanel());

  (await screen.findByText("a.ts")).click();
  await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
  (await screen.findByText("b.ts")).click();
  await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));

  fireEvent.click(screen.getByRole("tab", { name: /a\.ts/ }));
  expect(screen.getAllByRole("tab")).toHaveLength(2);
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: /a\.ts/ })).toHaveAttribute("aria-selected", "true"),
  );
});

test("closing the active tab selects its right neighbor; closing an inactive tab leaves the selection alone", async () => {
  lsMock.mockResolvedValue(
    ls([
      { name: "a.ts", kind: "file" },
      { name: "b.ts", kind: "file" },
      { name: "c.ts", kind: "file" },
    ]),
  );
  fileMock.mockImplementation(({ path }) =>
    Promise.resolve({ kind: "text", path, contents: path, size: 1, hash: "h", editable: true }),
  );
  render(renderPanel());

  (await screen.findByText("a.ts")).click();
  await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
  (await screen.findByText("b.ts")).click();
  await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
  (await screen.findByText("c.ts")).click();
  await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));

  // b.ts is inactive (c.ts is) — closing it must not move the selection.
  fireEvent.click(screen.getByRole("button", { name: "b.ts を閉じる" }));
  await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
  expect(screen.getByRole("tab", { name: /c\.ts/ })).toHaveAttribute("aria-selected", "true");

  // closing the active tab (c.ts, rightmost) falls back to its left neighbor.
  fireEvent.click(screen.getByRole("button", { name: "c.ts を閉じる" }));
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: /a\.ts/ })).toHaveAttribute("aria-selected", "true"),
  );
});

test("closing the only open tab clears the selection back to the placeholder", async () => {
  lsMock.mockResolvedValue(ls([{ name: "a.ts", kind: "file" }]));
  fileMock.mockResolvedValue({
    kind: "text",
    path: "a.ts",
    contents: "a",
    size: 1,
    hash: "h",
    editable: true,
  });
  render(renderPanel());

  (await screen.findByText("a.ts")).click();
  await screen.findByRole("tab", { name: /a\.ts/ });

  fireEvent.click(screen.getByRole("button", { name: "a.ts を閉じる" }));
  await waitFor(() => expect(screen.queryByRole("tab")).not.toBeInTheDocument());
  expect(await screen.findByText("ファイルを選択してください")).toBeInTheDocument();
});

// ToolPane owns `selectedPath` via a router navigate, which lands a render
// (or more) after the tab store already updated — TestFilesPanel above
// applies `onSelectedPathChange` synchronously in the same tick, which
// doesn't exercise that gap. This harness defers it like the real navigate
// does, to catch the effect-scheduling bug: an effect keyed on `tabs.active`
// firing before `selectedPath` catches up, re-opening the tab that was just
// closed.
function DeferredTestFilesPanel(props: FilesPanelTestProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const onSelectedPathChange = (path: string | null) => {
    setTimeout(() => setSelectedPath(path), 0);
  };
  const [mdMode, setMdMode] = useState<"source" | "preview">("preview");
  return (
    <FilesPanel
      repo="/repo"
      repoChangedTick={0}
      repoKey="/repo"
      selectedPath={selectedPath}
      onSelectedPathChange={onSelectedPathChange}
      mdMode={mdMode}
      onMdModeChange={setMdMode}
      {...props}
    />
  );
}

test("closing the only open tab still removes it when the URL update lands a tick later", async () => {
  lsMock.mockResolvedValue(ls([{ name: "a.ts", kind: "file" }]));
  fileMock.mockResolvedValue({
    kind: "text",
    path: "a.ts",
    contents: "a",
    size: 1,
    hash: "h",
    editable: true,
  });
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <HerdrStoreProvider store={makeFakeStore()}>
          <DeferredTestFilesPanel />
        </HerdrStoreProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );

  (await screen.findByText("a.ts")).click();
  await screen.findByRole("tab", { name: /a\.ts/ });

  fireEvent.click(screen.getByRole("button", { name: "a.ts を閉じる" }));
  await waitFor(() => expect(screen.queryByRole("tab")).not.toBeInTheDocument());
  expect(await screen.findByText("ファイルを選択してください")).toBeInTheDocument();
});

test("a tab whose path doesn't exist in this worktree is marked missing via the bulk stat check", async () => {
  lsMock.mockResolvedValue(ls([{ name: "a.ts", kind: "file" }]));
  statMock.mockResolvedValue({ "a.ts": false });
  render(renderPanel());

  (await screen.findByText("a.ts")).click();
  await waitFor(() => expect(statMock).toHaveBeenCalledWith({ root: "/repo", paths: ["a.ts"] }));
  expect(await screen.findByRole("tab", { name: /a\.ts/ })).toHaveAttribute("data-missing", "true");
});

// ---------------------------------------------------------------------------
// Restoring the active tab when selectedPath is null (ui-redesign.md §5.4):
// one rule covers both "reloaded with no path in the URL" and "ToolPane just
// dropped path on a worktree switch, same repoKey" — both land here as
// selectedPath === null with a persisted `active` tab.
// ---------------------------------------------------------------------------

test("mounting with no selectedPath restores the repo's persisted active tab", async () => {
  localStorage.setItem(
    "herdr-web.fileTabs",
    JSON.stringify({ "/repo": { paths: ["a.ts"], active: "a.ts" } }),
  );
  lsMock.mockResolvedValue(ls([{ name: "a.ts", kind: "file" }]));
  fileMock.mockResolvedValue({
    kind: "text",
    path: "a.ts",
    contents: "a",
    size: 1,
    hash: "h",
    editable: true,
  });
  render(renderPanel());

  await waitFor(() =>
    expect(screen.getByRole("tab", { name: /a\.ts/ })).toHaveAttribute("aria-selected", "true"),
  );
  expect(await screen.findByTestId("code-file-view-stub")).toHaveTextContent("a.ts:a");
});

test("restoreSuppressed defers restoring the active tab until it clears", async () => {
  localStorage.setItem(
    "herdr-web.fileTabs",
    JSON.stringify({ "/repo": { paths: ["a.ts"], active: "a.ts" } }),
  );
  lsMock.mockResolvedValue(ls([{ name: "a.ts", kind: "file" }]));
  fileMock.mockResolvedValue({
    kind: "text",
    path: "a.ts",
    contents: "a",
    size: 1,
    hash: "h",
    editable: true,
  });
  const { rerender } = render(renderPanel({ restoreSuppressed: true }));

  // Suppressed: the tab list persists (still shown) but nothing gets
  // auto-selected — restoring here would race the navigate ToolPane is
  // still mid-flight on.
  await screen.findByRole("tab", { name: /a\.ts/ });
  expect(screen.getByText("ファイルを選択してください")).toBeInTheDocument();

  rerender(renderPanel({ restoreSuppressed: false }));
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: /a\.ts/ })).toHaveAttribute("aria-selected", "true"),
  );
});

// Without this, a trashed/checked-out-away file's tab would keep showing as
// present forever once `fs-stat` had been fetched once, since the query key
// didn't change when only the worktree's content did.
test("bumping repoChangedTick refetches existence, so a since-removed file's tab becomes missing", async () => {
  lsMock.mockResolvedValue(ls([{ name: "a.ts", kind: "file" }]));
  statMock.mockResolvedValue({ "a.ts": true });
  const client = new QueryClient();
  const store = makeFakeStore();
  const tree = (repoChangedTick: number) => (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <HerdrStoreProvider store={store}>
          <TestFilesPanel repoChangedTick={repoChangedTick} />
        </HerdrStoreProvider>
      </ToastProvider>
    </QueryClientProvider>
  );

  const { rerender } = render(tree(0));
  (await screen.findByText("a.ts")).click();
  await waitFor(() => expect(statMock).toHaveBeenCalledWith({ root: "/repo", paths: ["a.ts"] }));
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: /a\.ts/ })).not.toHaveAttribute("data-missing"),
  );

  statMock.mockClear();
  statMock.mockResolvedValue({ "a.ts": false });
  rerender(tree(1));
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: /a\.ts/ })).toHaveAttribute("data-missing", "true"),
  );
});

// ---------------------------------------------------------------------------
// Toolbar row: tree toggle + view-settings menu (moved from
// ViewerControls.test.tsx — the header is now one row owned by FilesPanel).
// ---------------------------------------------------------------------------

test("the tree toggle button shows and hides the file tree", async () => {
  lsMock.mockResolvedValue(ls([{ name: "a.ts", kind: "file" }]));
  render(renderPanel());
  await screen.findByTestId("path-tree-stub");

  fireEvent.click(screen.getByTitle("ファイルツリー"));
  expect(screen.queryByTestId("path-tree-stub")).not.toBeInTheDocument();

  fireEvent.click(screen.getByTitle("ファイルツリー"));
  expect(await screen.findByTestId("path-tree-stub")).toBeInTheDocument();
});

// Without this, the view-settings menu's A+/A- buttons could silently do
// nothing (or throw) if the popover wiring broke, and the buttons could stay
// clickable past MIN_FONT_SIZE/MAX_FONT_SIZE.
test("the view-settings menu shows the current font size, changes it via A+/A-, and disables at the bounds", async () => {
  localStorage.setItem(
    "herdr-web:viewer-settings",
    JSON.stringify({ fontSize: 23, showTree: true, treeWidth: 240 }),
  );
  lsMock.mockResolvedValue(ls([]));
  render(renderPanel());
  await screen.findByText("ファイルを選択してください");

  fireEvent.click(screen.getByTitle("表示設定"));
  expect(screen.getByText("23")).toBeInTheDocument();

  fireEvent.click(screen.getByTitle("文字を大きく"));
  expect(screen.getByText("24")).toBeInTheDocument();
  expect(screen.getByTitle("文字を大きく")).toBeDisabled();

  for (let i = 0; i < 15; i++) fireEvent.click(screen.getByTitle("文字を小さく"));
  expect(screen.getByText("10")).toBeInTheDocument();
  expect(screen.getByTitle("文字を小さく")).toBeDisabled();
  expect(screen.getByTitle("文字を大きく")).not.toBeDisabled();
});

// ---------------------------------------------------------------------------
// Per-file scroll position restore (fileScroll.ts).
// ---------------------------------------------------------------------------

test("a file's reported scroll position survives switching to another file and back", async () => {
  lsMock.mockResolvedValue(
    ls([
      { name: "a.ts", kind: "file" },
      { name: "b.ts", kind: "file" },
    ]),
  );
  fileMock.mockImplementation(({ path }) =>
    Promise.resolve({
      kind: "text",
      path,
      contents: path,
      size: path.length,
      hash: "h",
      editable: true,
    }),
  );
  render(renderPanel());

  (await screen.findByText("a.ts")).click();
  await screen.findByTestId("code-file-view-stub");
  fireEvent.click(screen.getByText("report-code-scroll")); // saves a.ts -> 123

  (await screen.findByText("b.ts")).click();
  await waitFor(() =>
    expect(screen.getByTestId("code-file-view-stub")).toHaveTextContent("b.ts:b.ts"),
  );
  expect(screen.getByTestId("code-file-view-scroll-top")).toHaveTextContent("none");

  fireEvent.click(screen.getByRole("tab", { name: /a\.ts/ }));
  await waitFor(() =>
    expect(screen.getByTestId("code-file-view-stub")).toHaveTextContent("a.ts:a.ts"),
  );
  expect(screen.getByTestId("code-file-view-scroll-top")).toHaveTextContent("123");
}, 15000); // this suite's per-test wall time grows as more tests in the file run before it

test("markdown source and preview modes keep separate scroll positions for the same file", async () => {
  lsMock.mockResolvedValue(ls([{ name: "a.md", kind: "file" }]));
  fileMock.mockResolvedValue({
    kind: "text",
    path: "a.md",
    contents: "# hi",
    size: 4,
    hash: "h",
    editable: true,
  });
  render(renderPanel());

  (await screen.findByText("a.md")).click();
  await screen.findByTestId("markdown-view-stub"); // default mdMode: preview
  fireEvent.click(screen.getByText("report-markdown-scroll")); // saves preview -> 77

  fireEvent.mouseDown(screen.getByRole("tab", { name: "ソース" }));
  await screen.findByTestId("code-file-view-stub");
  expect(screen.getByTestId("code-file-view-scroll-top")).toHaveTextContent("none");

  fireEvent.mouseDown(screen.getByRole("tab", { name: "プレビュー" }));
  await screen.findByTestId("markdown-view-stub");
  expect(screen.getByTestId("markdown-view-scroll-top")).toHaveTextContent("77");
});
