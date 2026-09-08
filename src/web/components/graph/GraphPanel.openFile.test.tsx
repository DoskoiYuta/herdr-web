import { afterEach, describe, expect, test, vi } from "vitest";
import { render, waitFor, fireEvent, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/toast/ToastProvider";
import type { GraphResponse } from "@contract/git";

vi.mock("@/components/tree/PathTree", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/tree/PathTree")>()),
  PathTree: ({ paths, onSelectFile }: { paths: string[]; onSelectFile?(path: string): void }) => (
    <div role="tree">
      {paths.map((p) => (
        <button key={p} type="button" onClick={() => onSelectFile?.(p)}>
          {p}
        </button>
      ))}
    </div>
  ),
}));

const { GraphPanel } = await import("./GraphPanel");

afterEach(() => {
  vi.unstubAllGlobals();
});

function hash(n: number): string {
  return `h${n}`.padEnd(40, "0");
}

function makeGraph(): GraphResponse {
  const commits = [
    { hash: hash(0), parents: [hash(1)] },
    { hash: hash(1), parents: [] }, // root commit
  ].map((c, i) => ({
    ...c,
    author: "yuta",
    authorEmail: "yuta@example.com",
    authorDate: Math.floor(Date.now() / 1000) - i * 100,
    committer: "yuta",
    commitDate: Math.floor(Date.now() / 1000) - i * 100,
    subject: `commit ${i}`,
    body: "",
  }));
  return {
    repo: "/repo",
    commits,
    refs: [],
    head: { hash: commits[0]!.hash, detached: false, branch: "main" },
    stashes: [],
    hasUncommitted: false,
    truncated: false,
    generatedAt: new Date().toISOString(),
  };
}

function setupFetchMock(graph: GraphResponse) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/git/graph")) return { ok: true, json: async () => graph } as Response;
    if (url.includes("/api/git/commit/")) {
      const found = graph.commits.find((c) => url.includes(c.hash));
      return {
        ok: true,
        json: async () => ({
          ...found,
          files: [{ status: "M", path: "src/a.ts", additions: 1, deletions: 0 }],
        }),
      } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

const virtualizerOptions = {
  observeElementRect: (
    _instance: unknown,
    cb: (rect: { width: number; height: number }) => void,
  ) => {
    cb({ width: 800, height: 600 });
    return () => {};
  },
  measureElement: () => 24,
};

describe("GraphPanel file-row jump to Diff", () => {
  test("clicking a file under a non-root commit reports {from: parent, to: hash}", async () => {
    const graph = makeGraph();
    setupFetchMock(graph);
    const onOpenFile = vi.fn();
    const { container } = render(
      <GraphPanel
        repo="/repo"
        repoChangedTick={0}
        onSelectCommit={() => {}}
        onOpenFile={onOpenFile}
        virtualizerOptions={virtualizerOptions}
      />,
      { wrapper },
    );
    await waitFor(() => expect(container.querySelector(`[data-hash="${hash(0)}"]`)).toBeTruthy());
    fireEvent.click(container.querySelector(`[data-hash="${hash(0)}"].graph-row`)!);
    await screen.findByText("src/a.ts");

    fireEvent.click(screen.getByText("src/a.ts"));

    expect(onOpenFile).toHaveBeenCalledWith({ from: hash(1), to: hash(0) }, "src/a.ts");
  });

  // 無いと壊れる: from が無い range を許すと、Diff は WORKTREE vs HEAD に
  // すり替わって開く — ユーザーには別のコミット/ファイルを見せたように見える
  // (M16 レビュー指摘)。ルートコミットのファイル行はそもそもクリックできない
  // ようにする。
  test("clicking a file under a root commit does not jump (no valid `from` to diff against)", async () => {
    const graph = makeGraph();
    setupFetchMock(graph);
    const onOpenFile = vi.fn();
    const { container } = render(
      <GraphPanel
        repo="/repo"
        repoChangedTick={0}
        onSelectCommit={() => {}}
        onOpenFile={onOpenFile}
        virtualizerOptions={virtualizerOptions}
      />,
      { wrapper },
    );
    await waitFor(() => expect(container.querySelector(`[data-hash="${hash(1)}"]`)).toBeTruthy());
    fireEvent.click(container.querySelector(`[data-hash="${hash(1)}"].graph-row`)!);
    await screen.findByText("src/a.ts");

    fireEvent.click(screen.getByText("src/a.ts"));

    expect(onOpenFile).not.toHaveBeenCalled();
  });
});
