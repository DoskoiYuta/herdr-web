// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { clearReviewRangeMarks, markReviewRange, observeReviewRange } from "./rangeHighlight";

/** Builds the slice of @pierre/diffs' rendered column pair that surrounds an
 * annotation: `code > (div[data-gutter], div[data-content])`, both columns
 * holding one child per row in the same order. */
function column(rows: { line?: number; type?: string; annotation?: boolean }[]) {
  const code = document.createElement("code");
  const gutter = document.createElement("div");
  gutter.setAttribute("data-gutter", "");
  const content = document.createElement("div");
  content.setAttribute("data-content", "");
  let annotation: HTMLElement | null = null;
  for (const row of rows) {
    const g = document.createElement("div");
    const c = document.createElement("div");
    if (row.annotation) {
      c.setAttribute("data-line-annotation", "0,0");
      annotation = c;
    } else if (row.line !== undefined) {
      c.setAttribute("data-line", String(row.line));
      c.setAttribute("data-line-type", row.type ?? "context");
      g.setAttribute("data-line-type", row.type ?? "context");
    } else {
      c.setAttribute("data-content-buffer", "");
    }
    gutter.appendChild(g);
    content.appendChild(c);
  }
  code.append(gutter, content);
  const inner = document.createElement("div");
  annotation!.appendChild(inner);
  return { code, inner, marked: () => [...code.querySelectorAll("[data-review-range]")] };
}

describe("markReviewRange", () => {
  test("marks the content rows and their gutter cells for every line of the range, nothing outside it", () => {
    const { code, inner, marked } = column([
      { line: 16 },
      { line: 17 },
      { line: 18, type: "change-addition" },
      { line: 19, type: "change-addition" },
      {},
      { line: 20, type: "change-addition" },
      { annotation: true },
      { line: 21 },
    ]);
    markReviewRange(inner, [{ side: "new", start: 18, end: 20 }]);
    const lines = marked().map((el) => el.getAttribute("data-line") ?? "gutter");
    expect(lines.filter((l) => l !== "gutter")).toEqual(["18", "19", "20"]);
    expect(lines.filter((l) => l === "gutter")).toHaveLength(3);
    expect(code.querySelector('[data-line="17"]')?.hasAttribute("data-review-range")).toBe(false);
  });

  test("a range on the old side skips addition rows that share the same line numbers in unified layout", () => {
    const { inner, marked } = column([
      { line: 5, type: "change-deletion" },
      { line: 5, type: "change-addition" },
      { annotation: true },
    ]);
    markReviewRange(inner, [{ side: "old", start: 5, end: 5 }]);
    expect(marked().map((el) => el.getAttribute("data-line-type"))).toEqual([
      "change-deletion",
      "change-deletion",
    ]);
  });

  test("clearReviewRangeMarks removes every mark placed for that annotation", () => {
    const { inner, marked } = column([{ line: 1 }, { line: 2 }, { annotation: true }]);
    markReviewRange(inner, [{ side: "new", start: 1, end: 2 }]);
    expect(marked()).toHaveLength(4);
    clearReviewRangeMarks(inner);
    expect(marked()).toHaveLength(0);
  });
});

describe("observeReviewRange", () => {
  test("reaches the rows through the host's shadow root when the thread is slotted, and re-marks rows that are re-rendered later", async () => {
    // @pierre/diffs renders the rows inside `diffs-container`'s shadow root and
    // slots the React thread in from the light DOM.
    const host = document.createElement("diffs-container");
    const shadow = host.attachShadow({ mode: "open" });
    const { code } = column([{ line: 3 }, { line: 4 }, { annotation: true }]);
    const annotation = code.querySelector("[data-line-annotation]")!;
    const slot = document.createElement("slot");
    slot.setAttribute("name", "annotation-additions-4");
    annotation.replaceChildren(slot);
    shadow.appendChild(code);
    const wrapper = document.createElement("div");
    wrapper.setAttribute("slot", "annotation-additions-4");
    const inner = document.createElement("div");
    wrapper.appendChild(inner);
    host.appendChild(wrapper);
    document.body.appendChild(host);

    const stop = observeReviewRange(inner, [{ side: "new", start: 3, end: 4 }]);
    expect(code.querySelectorAll("[data-review-range]")).toHaveLength(4);

    // virtualization replaces the row elements
    const content = code.querySelector("[data-content]")!;
    const fresh = document.createElement("div");
    fresh.setAttribute("data-line", "3");
    fresh.setAttribute("data-line-type", "context");
    content.replaceChild(fresh, content.children[0]!);
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    expect(fresh.hasAttribute("data-review-range")).toBe(true);

    stop();
    expect(code.querySelectorAll("[data-review-range]")).toHaveLength(0);
    host.remove();
  });
});
