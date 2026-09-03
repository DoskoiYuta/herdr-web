import { describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";
import GraphRow from "./GraphRow";
import { layoutGraph } from "./layout/layout";
import type { Commit, Ref } from "@contract/git";

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
});
