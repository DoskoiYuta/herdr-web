import { expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { CSSProperties } from "react";
import type { CommitDetail as CommitDetailWire } from "@contract/git";

vi.mock("@/components/tree/PathTree", () => ({
  PathTree: ({ paths, style }: { paths: string[]; style?: CSSProperties }) => (
    <div data-testid="path-tree-stub" role="tree" data-style={JSON.stringify(style ?? null)}>
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

function detailWithFiles(fileCount: number): CommitDetailWire {
  return {
    hash: "abc123".padEnd(40, "0"),
    parents: ["def456".padEnd(40, "0")],
    author: "yuta",
    authorEmail: "yuta@example.com",
    authorDate: Math.floor(Date.now() / 1000),
    committer: "yuta",
    commitDate: Math.floor(Date.now() / 1000),
    subject: "Big commit",
    body: "",
    files: Array.from({ length: fileCount }, (_, i) => ({
      status: "M" as const,
      path: `src/file-${i}.ts`,
      additions: 1,
      deletions: 0,
    })),
  };
}

// 無いと壊れる: 400 件のような大きな commit を展開したとき、ツリーが枠内
// スクロールに戻ってしまい、Graph 全体の 1 本のスクロールに乗らなくなる。
test("does not cap the file tree's container height even for a large commit", async () => {
  const detail = detailWithFiles(400);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => detail })),
  );

  render(<CommitDetail repo="/repo" hash={detail.hash} />, { wrapper: wrapper() });

  const tree = await screen.findByRole("tree");
  await waitFor(() => expect(screen.getAllByText(/src\/file-/).length).toBe(400));

  // The wrapping element around the tree carries no fixed pixel height and
  // no border/scroll styling — only `aria-disabled` semantics remain.
  const container = tree.parentElement!;
  expect(container.style.height).toBe("");
  expect(container.className).not.toContain("border");
  expect(container.className).not.toContain("overflow");

  // PathTree itself is told to size to its content, not to a fixed box.
  const style = JSON.parse(tree.getAttribute("data-style")!);
  expect(style?.height).toBe("auto");
});
