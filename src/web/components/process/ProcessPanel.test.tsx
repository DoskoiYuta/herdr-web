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

const { CommandUnavailableError } = await import("@/lib/api");
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

test("ps/lsof missing (CommandUnavailableError) shows a header error", async () => {
  listMock.mockRejectedValue(new CommandUnavailableError("lsof が見つかりません"));
  render(renderPanel());

  expect(await screen.findByText(/lsof が見つかりません/)).toBeInTheDocument();
});

test("an empty root does not call the API and shows a placeholder instead", () => {
  render(renderPanel(""));

  expect(screen.getByText("worktree を選択してください")).toBeInTheDocument();
  expect(listMock).not.toHaveBeenCalled();
});
