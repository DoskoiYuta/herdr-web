import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ProcListResponse } from "@contract/proc";

const listMock = vi.fn<(root: string) => Promise<ProcListResponse>>();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  procApi: { list: (...args: [string]) => listMock(...args) },
}));

const { CommandUnavailableError, CommandFailedError, CommandTimeoutError } =
  await import("@/lib/api");
const { ProcessPanel } = await import("./ProcessPanel");

function renderPanel(root = "/repo"): ReactElement {
  const client = new QueryClient();
  return (
    <QueryClientProvider client={client}>
      <ProcessPanel root={root} />
    </QueryClientProvider>
  );
}

function proc(
  overrides: Partial<ProcListResponse["processes"][number]>,
): ProcListResponse["processes"][number] {
  return {
    pid: 1,
    ppid: 0,
    command: "node app.js",
    argv0: "node",
    cpu: 0,
    rss: 0,
    elapsedSec: 0,
    cwd: "/repo",
    listen: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

test("no matching processes shows the empty-state message", async () => {
  listMock.mockResolvedValue({ processes: [] });
  render(renderPanel());

  expect(
    await screen.findByText("この worktree を cwd とするプロセスはありません"),
  ).toBeInTheDocument();
});

test("a child process (ppid within the set) renders nested under its parent", async () => {
  listMock.mockResolvedValue({
    processes: [
      proc({ pid: 10, ppid: 1, command: "zsh" }),
      proc({ pid: 20, ppid: 10, command: "bun dev", listen: [{ port: 5173, addr: "*" }] }),
    ],
  });
  render(renderPanel());

  expect(await screen.findByText("zsh")).toBeInTheDocument();
  expect(screen.getByText(/bun dev/)).toBeInTheDocument();
  expect(screen.getByText(":5173")).toBeInTheDocument();
});

// 無いと壊れる: 階層が罫線文字やインデント無しで潰れると、どのプロセスが
// どの子かテーブルの見た目から分からなくなる (design.pen P10)。
test("nesting depth is shown as one indent guide per ancestor, root rows have none", async () => {
  listMock.mockResolvedValue({
    processes: [
      proc({ pid: 10, ppid: 0, command: "zsh" }),
      proc({ pid: 20, ppid: 10, command: "bun dev" }),
      proc({ pid: 30, ppid: 20, command: "node build.js" }),
    ],
  });
  render(renderPanel());

  const zshRow = (await screen.findByText("zsh")).closest("tr")!;
  const bunRow = screen.getByText("bun dev").closest("tr")!;
  const nodeRow = screen.getByText("node build.js").closest("tr")!;

  expect(zshRow.querySelectorAll('[data-testid="indent-guide"]')).toHaveLength(0);
  expect(bunRow.querySelectorAll('[data-testid="indent-guide"]')).toHaveLength(1);
  expect(nodeRow.querySelectorAll('[data-testid="indent-guide"]')).toHaveLength(2);
});

// 無いと壊れる: プロセス数や LISTEN 中のポート数がテーブルを数えないと分からない。
test("shows a summary of process count and listening port count", async () => {
  listMock.mockResolvedValue({
    processes: [
      proc({ pid: 10, ppid: 0, command: "zsh" }),
      proc({ pid: 20, ppid: 10, command: "bun dev", listen: [{ port: 5173, addr: "*" }] }),
      proc({ pid: 30, ppid: 0, command: "vite", listen: [{ port: 8080, addr: "*" }] }),
    ],
  });
  render(renderPanel());

  expect(
    await screen.findByText("3 プロセス · LISTEN 2 ポート · cwd がこの worktree 配下"),
  ).toBeInTheDocument();
});

test("ps/lsof missing (CommandUnavailableError) shows a header error", async () => {
  listMock.mockRejectedValue(new CommandUnavailableError("lsof が見つかりません"));
  render(renderPanel());

  expect(await screen.findByText(/lsof が見つかりません/)).toBeInTheDocument();
});

// 無いと壊れる: サーバーの stderr が空のとき「（503）。」だけが表示され、
// 何が起きたのか一切分からなくなる。
test("a 503 with no stderr detail still shows a meaningful description", async () => {
  listMock.mockRejectedValue(new CommandFailedError("プロセス一覧の取得に失敗しました", ""));
  render(renderPanel());

  const description = await screen.findByText(/503/);
  expect(description.textContent).not.toBe("（503）。");
});

test("an empty root does not call the API and shows a placeholder instead", () => {
  render(renderPanel(""));

  expect(screen.getByText("worktree を選択してください")).toBeInTheDocument();
  expect(listMock).not.toHaveBeenCalled();
});

// 無いと壊れる: タイムアウト時に前回値まで消えると、動いているプロセスが
// 一時的に「無い」ように見えてしまう。
test("a later poll timeout keeps the previous process list visible while showing a warning", async () => {
  listMock
    .mockResolvedValueOnce({ processes: [proc({ pid: 10, command: "zsh" })] })
    .mockRejectedValueOnce(new CommandTimeoutError("プロセス一覧の取得がタイムアウトしました"));

  const client = new QueryClient();
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <ProcessPanel root="/repo" />
    </QueryClientProvider>,
  );
  await screen.findByText("zsh");

  await client.refetchQueries({ queryKey: ["proc-list", "/repo"] }).catch(() => {});
  rerender(
    <QueryClientProvider client={client}>
      <ProcessPanel root="/repo" />
    </QueryClientProvider>,
  );

  expect(await screen.findByText(/タイムアウト/)).toBeInTheDocument();
  expect(screen.getByText("zsh")).toBeInTheDocument();
});
