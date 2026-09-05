// F10 ask feature wiring: composer target resolution, anchor construction,
// for-file match placement (inline vs. mismatch strip), and error messages.
// CodeFileView is mocked at the FilesPanel boundary — real @pierre/diffs
// rendering is out of scope here (see FilesPanel.test.tsx's identical
// pattern for the pre-existing viewer routing tests).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CodeViewLineSelection, LineAnnotation } from "@pierre/diffs";
import type { Ask, ForFileMatch } from "@/lib/api";
import type { FileResponse, LsResponse } from "@contract/fs";
import type { AskAnnotationMeta } from "@/components/ask/askAnnotations";

const lsMock = vi.fn<(...args: unknown[]) => Promise<LsResponse>>();
const fileMock = vi.fn<(...args: unknown[]) => Promise<FileResponse>>();
const gitRootMock = vi.fn();
const createMock = vi.fn();
const forFileMock = vi.fn();
const replyMock = vi.fn();
const resolveMock = vi.fn();
const resendMock = vi.fn();

const { AskLimitError, AskUnavailableError } = vi.hoisted(() => {
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
  return { AskLimitError: AskLimitErrorImpl, AskUnavailableError: AskUnavailableErrorImpl };
});

vi.mock("@/lib/api", () => ({
  gitApi: { root: (...args: unknown[]) => gitRootMock(...args), status: vi.fn() },
  fsApi: {
    ls: (...args: unknown[]) => lsMock(...args),
    file: (...args: unknown[]) => fileMock(...args),
    rawUrl: () => "/raw",
  },
  askApi: {
    create: (...args: unknown[]) => createMock(...args),
    forFile: (...args: unknown[]) => forFileMock(...args),
    reply: (...args: unknown[]) => replyMock(...args),
    resolve: (...args: unknown[]) => resolveMock(...args),
    resend: (...args: unknown[]) => resendMock(...args),
    focus: vi.fn(),
    get: vi.fn().mockResolvedValue(undefined),
  },
  FileNotFoundError: class extends Error {},
  UploadConflictError: class extends Error {},
  TrashUnavailableError: class extends Error {},
  AskLimitError,
  AskUnavailableError,
}));

vi.mock("@/components/tree/PathTree", () => ({
  PathTree: ({
    paths,
    onSelectFile,
  }: {
    paths: string[];
    onSelectFile: (path: string) => void;
  }) => (
    <div>
      {paths.map((p) => (
        <button key={p} type="button" onClick={() => onSelectFile(p)}>
          {p}
        </button>
      ))}
    </div>
  ),
}));

// Radix Select (AskComposer's send-target picker) needs pointer-capture APIs
// jsdom doesn't implement — stub it as a native <select>.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) => (
    <select
      data-testid="target-select"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

// Stands in for the real CodeFileView (which mounts @pierre/diffs' CodeView —
// out of scope here): exposes the selection lifecycle as buttons, and
// actually calls `renderAnnotation` for each `annotations` entry so the
// composer/thread FilesPanel builds are reachable from a test, the same way
// DiffPanel.review.test.tsx's CodeView stand-in does for the diff side.
vi.mock("./CodeFileView", () => ({
  CodeFileView: ({
    annotations,
    renderAnnotation,
    onSelectedLinesChange,
    onLineSelectionStart,
    onLineSelectionEnd,
  }: {
    annotations?: LineAnnotation<AskAnnotationMeta>[];
    renderAnnotation?: (
      annotation: LineAnnotation<AskAnnotationMeta>,
      item: unknown,
    ) => React.ReactNode;
    onSelectedLinesChange?: (selection: CodeViewLineSelection | null) => void;
    onLineSelectionStart?: () => void;
    onLineSelectionEnd?: () => void;
  }) => (
    <div data-testid="code-file-view-stub">
      <button type="button" onClick={() => onLineSelectionStart?.()}>
        start-selection
      </button>
      <button
        type="button"
        onClick={() => onSelectedLinesChange?.({ id: "file", range: { start: 2, end: 3 } })}
      >
        select-lines-2-3
      </button>
      <button type="button" onClick={() => onLineSelectionEnd?.()}>
        end-selection
      </button>
      {(annotations ?? []).map((a, i) => (
        <div key={i} data-testid="annotation">
          {renderAnnotation?.(a, { id: "file" })}
        </div>
      ))}
    </div>
  ),
}));

const { default: FilesPanel } = await import("./FilesPanel");

function ls(names: string[]): LsResponse {
  return { entries: names.map((name) => ({ name, kind: "file" as const })) };
}

function makeAsk(overrides: Partial<Ask> = {}): Ask {
  return {
    id: "abc12345",
    repo: "/repokey",
    worktreeRoot: "/repo",
    path: "a.ts",
    anchor: { side: "new", lines: ["x"], before: [], after: [], lineHint: 1, hash: "h" },
    createdAtHead: null,
    status: "open",
    session: null,
    thread: [{ seq: 0, author: "user", body: "why?", at: "t", agentSession: null }],
    lastPrompt: null,
    createdAt: "t",
    updatedAt: "t",
    ...overrides,
  };
}

function renderPanel(props: Partial<React.ComponentProps<typeof FilesPanel>> = {}): ReactElement {
  const client = new QueryClient();
  return (
    <QueryClientProvider client={client}>
      <FilesPanel
        repo="/repo"
        repoChangedTick={0}
        repoKey="/repokey"
        worktreeRoot="/repo"
        {...props}
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  lsMock.mockResolvedValue(ls(["a.ts"]));
  fileMock.mockResolvedValue({
    kind: "text",
    path: "a.ts",
    contents: "line1\nline2\nline3\nline4\nline5",
    size: 30,
  });
  gitRootMock.mockResolvedValue({
    root: "/repo",
    commonDir: "/repo/.git",
    branch: "main",
    isMain: true,
    head: "headHash",
    rootCommit: "headHash",
  });
  forFileMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function selectFileAndDragLines23() {
  (await screen.findByText("a.ts")).click();
  await screen.findByTestId("code-file-view-stub");
  screen.getByText("start-selection").click();
  screen.getByText("select-lines-2-3").click();
  screen.getByText("end-selection").click();
}

test("selecting lines opens the composer; submitting with the default target creates an ask anchored to those lines", async () => {
  createMock.mockResolvedValue(makeAsk());
  render(renderPanel());
  await selectFileAndDragLines23();

  fireEvent.change(await screen.findByPlaceholderText("質問を入力"), {
    target: { value: "why?" },
  });
  fireEvent.click(screen.getByText("送信"));

  await vi.waitFor(() => expect(createMock).toHaveBeenCalled());
  expect(createMock).toHaveBeenCalledWith(
    expect.objectContaining({
      repo: "/repokey",
      worktreeRoot: "/repo",
      path: "a.ts",
      body: "why?",
      target: { kind: "new" },
      anchor: expect.objectContaining({ lines: ["line2", "line3"] }),
    }),
  );
});

test("choosing a pane target sends { kind: 'pane', paneId }", async () => {
  createMock.mockResolvedValue(makeAsk());
  render(
    renderPanel({
      repos: [
        {
          key: "/repokey",
          name: "repo",
          counts: { blocked: 0, done: 0 },
          worktrees: [
            {
              root: "/repo",
              branch: "main",
              isMain: true,
              panes: [
                {
                  paneId: "pane-1",
                  workspaceId: "w",
                  workspaceLabel: null,
                  tabId: "t",
                  tabLabel: null,
                  label: "worker",
                  agent: "claude",
                  agentStatus: "idle",
                  terminalTitleStripped: null,
                  focused: false,
                  cwd: null,
                  foregroundCwd: null,
                },
              ],
            },
          ],
        },
      ],
    }),
  );
  await selectFileAndDragLines23();

  fireEvent.change(await screen.findByPlaceholderText("質問を入力"), {
    target: { value: "why?" },
  });
  fireEvent.change(screen.getByTestId("target-select"), { target: { value: "pane-1" } });
  fireEvent.click(screen.getByText("送信"));

  await vi.waitFor(() =>
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: "pane", paneId: "pane-1" } }),
    ),
  );
});

test("anchored for-file matches render inline as ask threads", async () => {
  forFileMock.mockResolvedValue([
    { ask: makeAsk({ id: "anchored-1" }), startLine: 2, endLine: 2 },
  ] satisfies ForFileMatch[]);
  render(renderPanel());
  (await screen.findByText("a.ts")).click();
  expect(await screen.findByTestId("ask-thread")).toBeInTheDocument();
  expect(screen.queryByTestId("ask-mismatch-strip")).not.toBeInTheDocument();
});

// Without this, an ask whose anchor no longer matches the file's current
// content would either vanish or render at the wrong line instead of
// surfacing in the "一致しない質問" strip.
test("outdated (unanchored) for-file matches render in the mismatch strip, not inline", async () => {
  forFileMock.mockResolvedValue([
    { ask: makeAsk({ id: "outdated-1" }), startLine: null, endLine: null },
  ] satisfies ForFileMatch[]);
  render(renderPanel());
  (await screen.findByText("a.ts")).click();
  expect(await screen.findByTestId("ask-mismatch-strip")).toHaveTextContent("一致しない質問 1 件");
  expect(screen.queryByTestId("ask-thread")).not.toBeInTheDocument();
});

test("replying to an inline thread calls askApi.reply with the ask id", async () => {
  forFileMock.mockResolvedValue([
    { ask: makeAsk({ id: "anchored-1" }), startLine: 2, endLine: 2 },
  ] satisfies ForFileMatch[]);
  render(renderPanel());
  (await screen.findByText("a.ts")).click();
  await screen.findByTestId("ask-thread");

  fireEvent.change(screen.getByPlaceholderText("返信"), { target: { value: "because" } });
  fireEvent.click(screen.getByText("返信"));
  await vi.waitFor(() =>
    expect(replyMock).toHaveBeenCalledWith("anchored-1", {
      body: "because",
      author: "user",
      agentSession: null,
    }),
  );
});

test("解決 on an inline thread calls askApi.resolve with the ask id", async () => {
  forFileMock.mockResolvedValue([
    { ask: makeAsk({ id: "anchored-1" }), startLine: 2, endLine: 2 },
  ] satisfies ForFileMatch[]);
  render(renderPanel());
  (await screen.findByText("a.ts")).click();
  await screen.findByTestId("ask-thread");

  screen.getByText("解決").click();
  await vi.waitFor(() => expect(resolveMock).toHaveBeenCalledWith("anchored-1"));
});

// Without this, a resolved thread would keep rendering with its last-known
// (pre-resolve) status until something else happens to remount it — the
// server drops resolved asks from for-file, so the panel must refetch and
// let the thread disappear rather than trusting the stale local match.
test("解決 removes the inline thread once for-file stops returning it", async () => {
  forFileMock.mockResolvedValueOnce([
    { ask: makeAsk({ id: "anchored-1" }), startLine: 2, endLine: 2 },
  ] satisfies ForFileMatch[]);
  resolveMock.mockResolvedValue(makeAsk({ id: "anchored-1", status: "resolved" }));
  render(renderPanel());
  (await screen.findByText("a.ts")).click();
  await screen.findByTestId("ask-thread");

  forFileMock.mockResolvedValueOnce([]);
  screen.getByText("解決").click();

  await vi.waitFor(() => expect(resolveMock).toHaveBeenCalledWith("anchored-1"));
  await vi.waitFor(() => expect(screen.queryByTestId("ask-thread")).not.toBeInTheDocument());
});

test("再送 on a thread with an agent_blocked prompt calls askApi.resend", async () => {
  forFileMock.mockResolvedValue([
    {
      ask: makeAsk({ id: "anchored-1", lastPrompt: { state: "agent_blocked", at: "t" } }),
      startLine: 2,
      endLine: 2,
    },
  ] satisfies ForFileMatch[]);
  render(renderPanel());
  (await screen.findByText("a.ts")).click();
  await screen.findByTestId("ask-thread");

  screen.getByText("再送").click();
  await vi.waitFor(() => expect(resendMock).toHaveBeenCalledWith("anchored-1"));
});

test("shows the ask-limit message when askApi.create rejects with AskLimitError", async () => {
  createMock.mockRejectedValue(new AskLimitError(3));
  render(renderPanel());
  await selectFileAndDragLines23();

  fireEvent.change(await screen.findByPlaceholderText("質問を入力"), {
    target: { value: "why?" },
  });
  fireEvent.click(screen.getByText("送信"));

  expect(
    await screen.findByText("質問セッションの上限 (3) に達しています。解決して閉じてください"),
  ).toBeInTheDocument();
});

test("shows the herdr-unavailable message when askApi.create rejects with AskUnavailableError", async () => {
  createMock.mockRejectedValue(new AskUnavailableError());
  render(renderPanel());
  await selectFileAndDragLines23();

  fireEvent.change(await screen.findByPlaceholderText("質問を入力"), {
    target: { value: "why?" },
  });
  fireEvent.click(screen.getByText("送信"));

  expect(await screen.findByText("herdr 未接続")).toBeInTheDocument();
});

test("selecting a different file clears the composer", async () => {
  lsMock.mockResolvedValue(ls(["a.ts", "b.ts"]));
  fileMock.mockImplementation(async () => ({
    kind: "text",
    path: "a.ts",
    contents: "line1\nline2\nline3",
    size: 20,
  }));
  render(renderPanel());
  await selectFileAndDragLines23();
  expect(await screen.findByPlaceholderText("質問を入力")).toBeInTheDocument();

  (await screen.findByText("b.ts")).click();
  await vi.waitFor(() =>
    expect(screen.queryByPlaceholderText("質問を入力")).not.toBeInTheDocument(),
  );
});
