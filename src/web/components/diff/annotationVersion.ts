import type { DiffLineAnnotation } from "@pierre/diffs";
import type { ReviewAnnotationMeta } from "./reviewAnnotations";

/** annotation 集合の同一性を表す文字列。位置・種類・レビューの更新時刻が変われば変わる。 */
export function annotationSignature(
  annotations: DiffLineAnnotation<ReviewAnnotationMeta>[],
): string {
  return annotations
    .map((a) => {
      const m = a.metadata;
      const tail =
        m?.kind === "reviews"
          ? m.matches
              .map(
                (r) =>
                  `${r.review.id}@${r.review.updatedAt}@${r.review.notify?.state ?? ""}@${r.confidence}`,
              )
              .join("|")
          : (m?.kind ?? "");
      return `${a.side}:${a.lineNumber}:${tail}`;
    })
    .join("\n");
}

/** 内容 version（reconcile 由来）と annotation rev を 1 つの数値に畳む。CodeView は id:version で再描画を決める。 */
export function withAnnotationRev(version: number, rev: number): number {
  return version * 1_000_000 + (rev % 1_000_000);
}

/**
 * Folds `collapsed` into a version number the same way `withAnnotationRev`
 * folds in the annotation rev — CodeView only re-renders an item's header
 * (and thus notices a `collapsed` flip) when `id:version` changes. Apply
 * this last, on top of `withAnnotationRev`'s result.
 */
export function withCollapsedVersion(version: number, collapsed: boolean): number {
  return version * 2 + (collapsed ? 1 : 0);
}
