import { describe, expect, test, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GraphRow from "./GraphRow";
import { layoutGraph } from "./layout/layout";
import { MAX_GUTTER_PX } from "./layout/path";
import type { Commit, Ref } from "@contract/git";

function queryWrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function makeCommit(overrides: Partial<Commit> = {}): Commit {
  return {
    hash: "a".repeat(40),
    parents: [],
    author: "yuta",
    authorEmail: "yuta@example.com",
    authorDate: Math.floor(Date.now() / 1000) - 3600,
    committer: "yuta",
    commitDate: Math.floor(Date.now() / 1000) - 3600,
    subject: "Fix foo",
    body: "",
    ...overrides,
  };
}

describe("GraphRow", () => {
  test("renders one <path> per layout segment", () => {
    const commits = [
      { hash: "c1", parents: ["c2"] },
      { hash: "c2", parents: [] },
    ];
    const { rows } = layoutGraph({ commits });
    const row = rows[0]!;
    const { container } = render(
      <GraphRow
        row={row!}
        laneCount={1}
        commit={makeCommit({ hash: "c1", parents: ["c2"] })}
        refs={[]}
        isHead={false}
        selected={false}
        onSelect={() => {}}
      />,
    );
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBe(row.segments.length);
  });

  test("a merge commit renders two circles (double-ring node)", () => {
    // Diamond: c1 has two parents both merging at base.
    const commits = [
      { hash: "c1", parents: ["p1", "p2"] },
      { hash: "p1", parents: ["base"] },
      { hash: "p2", parents: ["base"] },
      { hash: "base", parents: [] },
    ];
    const { rows } = layoutGraph({ commits });
    const row = rows[0]!;
    const { container } = render(
      <GraphRow
        row={row!}
        laneCount={2}
        commit={makeCommit({ hash: "c1", parents: ["p1", "p2"] })}
        refs={[]}
        isHead={false}
        selected={false}
        onSelect={() => {}}
      />,
    );
    expect(container.querySelectorAll("circle").length).toBe(2);
  });

  test("a non-merge commit renders one circle", () => {
    const commits = [{ hash: "c1", parents: [] }];
    const { rows } = layoutGraph({ commits });
    const { container } = render(
      <GraphRow
        row={rows[0]!}
        laneCount={1}
        commit={makeCommit({ hash: "c1", parents: [] })}
        refs={[]}
        isHead={false}
        selected={false}
        onSelect={() => {}}
      />,
    );
    expect(container.querySelectorAll("circle").length).toBe(1);
  });

  test("selected row gets the highlight class", () => {
    const commits = [{ hash: "c1", parents: [] }];
    const { rows } = layoutGraph({ commits });
    const { container } = render(
      <GraphRow
        row={rows[0]!}
        laneCount={1}
        commit={makeCommit({ hash: "c1" })}
        refs={[]}
        isHead={false}
        selected={true}
        onSelect={() => {}}
      />,
    );
    expect(container.querySelector(".graph-row")).toHaveClass("graph-row-selected");
  });

  test("unselected row does not get the highlight class", () => {
    const commits = [{ hash: "c1", parents: [] }];
    const { rows } = layoutGraph({ commits });
    const { container } = render(
      <GraphRow
        row={rows[0]!}
        laneCount={1}
        commit={makeCommit({ hash: "c1" })}
        refs={[]}
        isHead={false}
        selected={false}
        onSelect={() => {}}
      />,
    );
    expect(container.querySelector(".graph-row")).not.toHaveClass("graph-row-selected");
  });

  test("clicking the row calls onSelect with the hash", () => {
    const commits = [{ hash: "c1", parents: [] }];
    const { rows } = layoutGraph({ commits });
    const onSelect = vi.fn();
    const { container } = render(
      <GraphRow
        row={rows[0]!}
        laneCount={1}
        commit={makeCommit({ hash: "c1" })}
        refs={[]}
        isHead={false}
        selected={false}
        onSelect={onSelect}
      />,
    );
    (container.querySelector(".graph-row") as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith("c1", { shiftKey: false });
  });

  test("the expanded detail block's left padding matches the row's, so the gutter's lane lines land under the row's lane lines", () => {
    // Regression test for the 縦線がずれる bug: `.graph-row` uses `px-2`
    // (8px left padding) before its lane SVG, but the sibling
    // `.graph-row-detail` block used to have no left padding at all, so its
    // gutter SVG's lane lines (numerically the same x as the row's — see
    // GraphView.test.tsx) rendered 8px further left on screen than the
    // row's own lines, breaking the visual continuity between rows. The fix
    // is `pl-2` on `.graph-row-detail`, matching `px-2`'s left component.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ hash: "c1", files: [] }) })),
    );
    const commits = [{ hash: "c1", parents: [] }];
    const { rows } = layoutGraph({ commits });
    const { container } = render(
      <GraphRow
        row={rows[0]!}
        laneCount={1}
        commit={makeCommit({ hash: "c1" })}
        refs={[]}
        isHead={false}
        selected={false}
        expanded={true}
        onSelect={() => {}}
      />,
      { wrapper: queryWrapper },
    );
    const row = container.querySelector(".graph-row")!;
    const detail = container.querySelector(".graph-row-detail")!;
    expect(row).toHaveClass("px-2");
    expect(detail).toHaveClass("pl-2");
  });

  test("renders no review badge when unresolved and drafts are both 0", () => {
    const commits = [{ hash: "c1", parents: [] }];
    const { rows } = layoutGraph({ commits });
    const { queryByLabelText } = render(
      <GraphRow
        row={rows[0]!}
        laneCount={1}
        commit={makeCommit({ hash: "c1" })}
        refs={[]}
        isHead={false}
        selected={false}
        reviewCount={{ unresolved: 0, drafts: 0 }}
        onSelect={() => {}}
      />,
    );
    expect(queryByLabelText(/未解決レビュー/)).not.toBeInTheDocument();
    expect(queryByLabelText(/下書きレビュー/)).not.toBeInTheDocument();
  });

  test("renders an unresolved-count badge and a drafts badge when both are >0", () => {
    const commits = [{ hash: "c1", parents: ["p1"] }];
    const { rows } = layoutGraph({ commits });
    const { getByLabelText } = render(
      <GraphRow
        row={rows[0]!}
        laneCount={1}
        commit={makeCommit({ hash: "c1", parents: ["p1"] })}
        refs={[]}
        isHead={false}
        selected={false}
        reviewCount={{ unresolved: 2, drafts: 3 }}
        onSelect={() => {}}
      />,
    );
    expect(getByLabelText("未解決レビュー 2 件")).toHaveTextContent("2");
    expect(getByLabelText("下書きレビュー 3 件")).toHaveTextContent("下書き 3");
  });

  test("clicking the review badge opens the diff (same as double-clicking the row) without also selecting it", () => {
    const commits = [{ hash: "c1", parents: ["p1"] }];
    const { rows } = layoutGraph({ commits });
    const onSelect = vi.fn();
    const onOpenDiff = vi.fn();
    const { getByLabelText } = render(
      <GraphRow
        row={rows[0]!}
        laneCount={1}
        commit={makeCommit({ hash: "c1", parents: ["p1"] })}
        refs={[]}
        isHead={false}
        selected={false}
        reviewCount={{ unresolved: 1, drafts: 0 }}
        onSelect={onSelect}
        onOpenDiff={onOpenDiff}
      />,
    );
    fireEvent.click(getByLabelText("未解決レビュー 1 件"));
    expect(onOpenDiff).toHaveBeenCalledWith("c1");
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("renders ref badges for refs pointing at this commit", () => {
    const commits = [{ hash: "c1", parents: [] }];
    const { rows } = layoutGraph({ commits });
    const refs: Ref[] = [
      { name: "main", fullName: "refs/heads/main", type: "head", hash: "c1", isHead: true },
    ];
    const { getByText } = render(
      <GraphRow
        row={rows[0]!}
        laneCount={1}
        commit={makeCommit({ hash: "c1" })}
        refs={refs}
        isHead={true}
        selected={false}
        onSelect={() => {}}
      />,
    );
    expect(getByText("main")).toBeInTheDocument();
  });

  // 無いと壊れる: ブランチが多いリポジトリで gutter が無制限に広がり、subject
  // 列が潰れて見えなくなる。
  test("with many lanes, the gutter width stays capped and the subject still renders", () => {
    const commits = Array.from({ length: 60 }, (_, i) => ({
      hash: `c${i}`,
      parents: i === 0 ? [] : [`c${i - 1}`],
    }));
    const { rows } = layoutGraph({ commits });
    const row = rows[0]!;
    const { container, getByText } = render(
      <GraphRow
        row={row}
        laneCount={60}
        commit={makeCommit({ hash: row.hash, parents: [], subject: "Deep in the lanes" })}
        refs={[]}
        isHead={false}
        selected={false}
        onSelect={() => {}}
      />,
    );
    const svg = container.querySelector("svg")!;
    expect(Number(svg.getAttribute("width"))).toBeLessThanOrEqual(MAX_GUTTER_PX);
    expect(getByText("Deep in the lanes")).toBeInTheDocument();
  });

  // 無いと壊れる: uncommitted 行に変更件数と相対時刻が出ず、コミット済み行と
  // 見分けが付きにくくなる（design.pen P5: 「(uncommitted changes) 4 files」「いま」）。
  test("the uncommitted row shows the file count and 'いま' instead of a relative time/hash", () => {
    const commits = [
      { hash: "UNCOMMITTED", parents: ["c1"] },
      { hash: "c1", parents: [] },
    ];
    const { rows } = layoutGraph({ commits });
    const { getByText, queryByText } = render(
      <GraphRow
        row={rows[0]!}
        laneCount={1}
        commit={makeCommit({ hash: "UNCOMMITTED", parents: ["c1"], subject: "" })}
        refs={[]}
        isHead={false}
        selected={false}
        uncommittedFileCount={4}
        onSelect={() => {}}
      />,
    );
    expect(getByText("4 files")).toBeInTheDocument();
    expect(getByText("いま")).toBeInTheDocument();
    expect(queryByText(/^[0-9a-f]{7}$/)).not.toBeInTheDocument();
  });
});
