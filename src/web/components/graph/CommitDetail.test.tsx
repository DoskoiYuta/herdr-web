import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { CommitDetail as CommitDetailWire } from "@contract/git";

vi.mock("@/components/tree/PathTree", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/tree/PathTree")>()),
  PathTree: ({ paths }: { paths: string[] }) => (
    <div data-testid="path-tree-stub" role="tree">
      {paths.map((p) => (
        <div key={p}>{p}</div>
      ))}
    </div>
  ),
}));

const { default: CommitDetail } = await import("./CommitDetail");

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const detail: CommitDetailWire = {
  hash: "abc123".padEnd(40, "0"),
  parents: ["def456".padEnd(40, "0")],
  author: "yuta",
  authorEmail: "yuta@example.com",
  authorDate: Math.floor(Date.now() / 1000),
  committer: "yuta",
  commitDate: Math.floor(Date.now() / 1000),
  subject: "Fix foo",
  body: "longer description",
  files: [
    { status: "M", path: "src/a.ts", additions: 3, deletions: 1 },
    { status: "R", path: "src/c.ts", oldPath: "src/b.ts", additions: 0, deletions: 0 },
  ],
};

describe("CommitDetail", () => {
  test('shows "uncommitted changes" for UNCOMMITTED without calling the API', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<CommitDetail repo="/repo" hash="UNCOMMITTED" />, {
      wrapper: wrapper(),
    });
    expect(screen.getByText("未コミットの変更")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fetches and renders commit detail", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => detail,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CommitDetail repo="/repo" hash={detail.hash} />, {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(screen.getByText(/Fix foo/)).toBeInTheDocument());
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain(`/api/git/commit/${detail.hash}`);
    expect(screen.getByRole("tree")).toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("src/c.ts")).toBeInTheDocument();
  });

  test("renders an error message on failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    render(<CommitDetail repo="/repo" hash={detail.hash} />, {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(screen.getByText(/404/)).toBeInTheDocument());
  });

  // 無いと壊れる: エラー時の見出しに 40 文字のフルハッシュがそのまま出て、
  // 他行の 12 文字表記と揃わない。
  test("truncates the hash to 12 characters in the error-state heading", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    render(<CommitDetail repo="/repo" hash={detail.hash} />, {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(screen.getByText(/404/)).toBeInTheDocument());
    expect(screen.getByText(detail.hash.slice(0, 12))).toBeInTheDocument();
    expect(screen.queryByText(detail.hash)).not.toBeInTheDocument();
  });

  test("shows the inline root-commit note when passed", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => detail });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CommitDetail
        repo="/repo"
        hash={detail.hash}
        note="ルートコミットの diff は表示できません"
      />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText("ルートコミットの diff は表示できません")).toBeInTheDocument();
  });
});
