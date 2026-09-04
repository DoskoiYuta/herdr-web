// Paints the lines a review range covers, so a multi-line thread shows which
// lines it is about, not just its end line. @pierre/diffs has no public
// per-line decoration API (LineDecoration is a protected renderer hook), so
// this marks the rendered rows directly: the annotation row lives in the
// `[data-content]` column, its `[data-line]` predecessors are the lines above
// it, and `[data-gutter]` holds one cell per row in the same order.
import type { Side } from "@contract/review";

export type ReviewLineRange = { side: Side; start: number; end: number };

const MARK = "data-review-range";

function lineMatchesSide(el: Element, side: Side): boolean {
  const type = el.getAttribute("data-line-type") ?? "";
  if (side === "new") return type !== "change-deletion";
  return type !== "change-addition";
}

/** The React thread is slotted into the diff's shadow root from the light
 * DOM (`div[slot=annotation-…]` under `diffs-container`), so `closest` alone
 * cannot reach the annotation row; follow the slot name into the shadow tree. */
function annotationRow(annotationInner: Element): Element | null {
  const direct = annotationInner.closest("[data-line-annotation]");
  if (direct) return direct;
  const wrapper = annotationInner.closest("[slot]");
  const shadow = wrapper?.parentElement?.shadowRoot;
  if (!wrapper || !shadow) return null;
  const slot = shadow.querySelector(`slot[name="${CSS.escape(wrapper.getAttribute("slot")!)}"]`);
  return slot?.closest("[data-line-annotation]") ?? null;
}

function columns(annotationInner: Element): {
  annotation: Element;
  content: Element;
  gutter: Element | null;
} | null {
  const annotation = annotationRow(annotationInner);
  const content = annotation?.parentElement;
  if (!annotation || !content) return null;
  const gutter = content.parentElement?.querySelector(":scope > [data-gutter]") ?? null;
  return { annotation, content, gutter };
}

/** Removes the marks a previous `markReviewRange` on this annotation placed. */
export function clearReviewRangeMarks(annotationInner: Element): void {
  const cols = columns(annotationInner);
  if (!cols) return;
  for (const el of cols.content.parentElement?.querySelectorAll(`[${MARK}]`) ?? []) {
    el.removeAttribute(MARK);
  }
}

/**
 * Marks the rows above the annotation whose line number falls inside any of
 * `ranges` (on that range's side). Idempotent; re-run after the diff
 * re-renders rows (virtualization recreates them).
 */
export function markReviewRange(annotationInner: Element, ranges: ReviewLineRange[]): void {
  const cols = columns(annotationInner);
  if (!cols) return;
  const rows = [...cols.content.children];
  const gutterRows = cols.gutter ? [...cols.gutter.children] : [];
  const annotationIndex = rows.indexOf(cols.annotation);
  const lowest = Math.min(...ranges.map((r) => r.start));
  for (let i = annotationIndex - 1; i >= 0; i--) {
    const row = rows[i]!;
    const lineAttr = row.getAttribute("data-line");
    if (lineAttr === null) continue;
    const line = Number(lineAttr);
    if (line < lowest) break;
    const hit = ranges.some(
      (r) => line >= r.start && line <= r.end && lineMatchesSide(row, r.side),
    );
    if (!hit) continue;
    row.setAttribute(MARK, "");
    gutterRows[i]?.setAttribute(MARK, "");
  }
}

/**
 * Marks now and again whenever the diff re-renders its rows (virtualization
 * recreates them, and the annotation row itself may appear after the React
 * thread mounts). Returns the cleanup that stops observing and clears marks.
 */
export function observeReviewRange(
  annotationInner: Element,
  ranges: ReviewLineRange[],
): () => void {
  let frame: number | null = null;
  const apply = () => {
    frame = null;
    markReviewRange(annotationInner, ranges);
  };
  apply();
  const wrapper = annotationInner.closest("[slot]");
  const scope: Node | null =
    wrapper?.parentElement?.shadowRoot ?? annotationRow(annotationInner)?.parentElement ?? null;
  const observer = new MutationObserver(() => {
    if (frame === null) frame = requestAnimationFrame(apply);
  });
  if (scope) observer.observe(scope, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
    clearReviewRangeMarks(annotationInner);
  };
}

/** CSS injected into the diff's shadow root (CodeView `unsafeCSS`). */
export const REVIEW_RANGE_CSS = `
[${MARK}] {
  background-color: color-mix(in srgb, #f59e0b 22%, transparent) !important;
}
[data-content] > [${MARK}] {
  box-shadow: inset 3px 0 0 #f59e0b;
}
`;
