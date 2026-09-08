import { expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode, CSSProperties } from "react";
import type { CommitDetail as CommitDetailWire } from "@contract/git";

// @pierre/trees' real FileTree only renders the rows that fit within its own
// container's measured height (see node_modules/@pierre/trees/dist/render/
// FileTreeView.js: viewportHeight -> paneHeight -> visible range) — a
// container with no real pixel height renders zero rows. This stub mirrors
// that cutoff, tied to the library's actual row height via PathTree's own
// re-export, so a caller that regresses to a non-pixel height (e.g. "auto")
// shows the same empty result here that it would for real.
vi.mock("@/components/tree/PathTree", async () => {
  const actual = await vi.importActual<typeof import("@/components/tree/PathTree")>(
    "@/components/tree/PathTree",
  );
  return {
    ...actual,
    PathTree: ({ paths, style }: { paths: string[]; style?: CSSProperties }) => {
      const px = typeof style?.height === "number" ? style.height : 0;
      const visibleRowCount = Math.max(0, Math.floor(px / actual.PATH_TREE_ROW_HEIGHT));
      return (
        <div role="tree">
          {paths.slice(0, visibleRowCount).map((p) => (
            <div key={p}>{p}</div>
          ))}
        </div>
      );
    },
  };
});

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

// 無いと壊れる: ツリーのコンテナに実測可能なピクセル高さを渡さないと（"auto"
// や 320px 上限など）、@pierre/trees は可視範囲を 0 と判断してファイル行を
// 1 つも描画しない — 枠を外しただけでは直らない退行。
test("renders every file row for a large commit, with no internal scroll cap", async () => {
  const fileCount = 56;
  const detail = detailWithFiles(fileCount);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => detail })),
  );

  render(<CommitDetail repo="/repo" hash={detail.hash} />, { wrapper: wrapper() });

  const tree = await screen.findByRole("tree");
  await waitFor(() => expect(screen.getAllByText(/src\/file-/).length).toBe(fileCount));

  // The wrapping element around the tree carries no fixed pixel cap, no
  // border, and no internal-scroll styling — only `aria-disabled` semantics.
  const container = tree.parentElement!;
  expect(container.className).not.toContain("border");
  expect(container.className).not.toContain("overflow");
});
