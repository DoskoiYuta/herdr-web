import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { CommitDetail as CommitDetailWire } from "@contract/git";

vi.mock("@/components/tree/PathTree", () => ({
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

const { default: CommitDetail } = await import("./CommitDetail");

const detail: CommitDetailWire = {
  hash: "abc123".padEnd(40, "0"),
  parents: ["def456".padEnd(40, "0")],
  author: "yuta",
  authorEmail: "yuta@example.com",
  authorDate: Math.floor(Date.now() / 1000),
  committer: "yuta",
  commitDate: Math.floor(Date.now() / 1000),
  subject: "Fix foo",
  body: "",
  files: [{ status: "M", path: "src/a.ts", additions: 1, deletions: 0 }],
};

function renderDetail(onOpenFile?: (path: string) => void) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => detail })),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CommitDetail repo="/repo" hash={detail.hash} onOpenFile={onOpenFile} />
    </QueryClientProvider>,
  );
}

describe("CommitDetail file row", () => {
  test("clicking a changed file calls onOpenFile with its path (Graph → Diff jump)", async () => {
    const onOpenFile = vi.fn();
    renderDetail(onOpenFile);
    await waitFor(() => expect(screen.getByRole("tree")).toBeInTheDocument());

    screen.getByText("src/a.ts").click();

    expect(onOpenFile).toHaveBeenCalledWith("src/a.ts");
  });

  test("has no 'diff を見る' button (removed in favor of the file-row jump)", async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByRole("tree")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "diff を見る" })).toBeNull();
  });
});
