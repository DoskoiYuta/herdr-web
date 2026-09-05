import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { StatusResponse } from "@contract/git";
import type { FileResponse, LsResponse, TrashResponse } from "@contract/fs";

const lsMock = vi.fn<(params: { root: string; dir: string }) => Promise<LsResponse>>();
const statusMock = vi.fn<(repo: string) => Promise<StatusResponse>>();
const fileMock = vi.fn<(params: { root: string; path: string }) => Promise<FileResponse>>();
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
  }: {
    paths: string[];
    onSelectFile: (path: string) => void;
    onExpandedDirsChange: (dirs: string[]) => void;
    contextMenuItems?: (item: {
      path: string;
      kind: "file" | "directory";
    }) => { label: string; onSelect: () => void }[];
    onExternalDrop?: (target: { dir: string }, dataTransfer: DataTransfer) => void;
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
    </div>
  ),
}));

const collectDroppedFilesMock = vi.fn<(dataTransfer: DataTransfer) => Promise<File[]>>();
vi.mock("@/lib/dropEntries", () => ({
  collectDroppedFiles: (dataTransfer: DataTransfer) => collectDroppedFilesMock(dataTransfer),
}));

vi.mock("./MarkdownView", () => ({
  MarkdownView: ({ contents }: { contents: string }) => (
    <div data-testid="markdown-view-stub">{contents}</div>
  ),
}));

vi.mock("./CodeFileView", () => ({
  CodeFileView: ({ path, contents }: { path: string; contents: string }) => (
    <div data-testid="code-file-view-stub">
      {path}:{contents}
    </div>
  ),
}));

const { default: FilesPanel } = await import("./FilesPanel");

function ls(entries: LsResponse["entries"] = []): LsResponse {
  return { entries };
}

function renderPanel(props: Partial<React.ComponentProps<typeof FilesPanel>> = {}): ReactElement {
  const client = new QueryClient();
  return (
    <QueryClientProvider client={client}>
      <FilesPanel repo="/repo" repoChangedTick={0} {...props} />
    </QueryClientProvider>
  );
}

const writeTextMock = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  vi.clearAllMocks();
  statusMock.mockResolvedValue({ status: [] });
  fileMock.mockResolvedValue({ kind: "text", path: "a.md", contents: "# hi", size: 4 });
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

test("selecting a .md file loads and routes it to MarkdownView", async () => {
  lsMock.mockResolvedValue(ls([{ name: "a.md", kind: "file" }]));
  fileMock.mockResolvedValue({ kind: "text", path: "a.md", contents: "# hi", size: 4 });
  render(renderPanel());
  (await screen.findByText("a.md")).click();
  expect(await screen.findByTestId("markdown-view-stub")).toHaveTextContent("# hi");
  expect(fileMock).toHaveBeenCalledWith({ root: "/repo", path: "a.md" });
});

test("selecting a non-markdown file routes it to CodeFileView", async () => {
  lsMock.mockResolvedValue(ls([{ name: "a.ts", kind: "file" }]));
  fileMock.mockResolvedValue({ kind: "text", path: "a.ts", contents: "const x = 1;", size: 12 });
  render(renderPanel());
  (await screen.findByText("a.ts")).click();
  const view = await screen.findByTestId("code-file-view-stub");
  expect(view).toHaveTextContent("a.ts:const x = 1;");
});

test("an initialLocation prop selects the path without a click, and calls onInitialLocationConsumed once the file has loaded", async () => {
  lsMock.mockResolvedValue(ls([{ name: "a.ts", kind: "file" }]));
  fileMock.mockResolvedValue({ kind: "text", path: "a.ts", contents: "const x = 1;", size: 12 });
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

test("shows the binary-file message with size", async () => {
  lsMock.mockResolvedValue(ls([{ name: "bin", kind: "file" }]));
  fileMock.mockResolvedValue({ kind: "binary", path: "bin", size: 42 });
  render(renderPanel());
  (await screen.findByText("bin")).click();
  expect(await screen.findByText("バイナリファイル (42 bytes)")).toBeInTheDocument();
});

test("shows the too-large message with size and the cap", async () => {
  lsMock.mockResolvedValue(ls([{ name: "big", kind: "file" }]));
  fileMock.mockResolvedValue({ kind: "too-large", path: "big", size: 5_000_000 });
  render(renderPanel());
  (await screen.findByText("big")).click();
  expect(
    await screen.findByText("大きすぎるため表示しません (5000000 bytes、上限 2 MiB)"),
  ).toBeInTheDocument();
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
  fileMock.mockResolvedValue({ kind: "text", path: "a.ts", contents: "x", size: 1 });
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

test("ゴミ箱に移動 confirms and trashes the file, clearing its selection", async () => {
  lsMock.mockResolvedValue(ls([{ name: "a.md", kind: "file" }]));
  fileMock.mockResolvedValue({ kind: "text", path: "a.md", contents: "# hi", size: 4 });
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
  expect(await screen.findByText("ファイルを選択してください")).toBeInTheDocument();
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
  fileMock.mockResolvedValue({ kind: "text", path: "a.md", contents: "# hi", size: 4 });
  trashMock.mockRejectedValue(new TrashUnavailableError());
  render(renderPanel());

  (await screen.findByText("ゴミ箱に移動")).click();
  within(await screen.findByRole("dialog"))
    .getByRole("button", { name: "ゴミ箱に移動" })
    .click();

  expect(await screen.findByText("この環境ではゴミ箱に移動できません")).toBeInTheDocument();
});
