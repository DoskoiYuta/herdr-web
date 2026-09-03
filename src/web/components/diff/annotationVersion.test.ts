import { describe, expect, test } from "vitest";
import { annotationSignature, withAnnotationRev, withCollapsedVersion } from "./annotationVersion";

describe("annotationVersion", () => {
  test("signature changes when a composer appears or a review updates", () => {
    const base = [
      {
        side: "additions" as const,
        lineNumber: 6,
        metadata: { kind: "composer" as const, side: "new" as const },
      },
    ];
    expect(annotationSignature([])).not.toBe(annotationSignature(base));
    expect(annotationSignature(base)).toBe(annotationSignature([...base]));
  });
  test("withAnnotationRev keeps content version dominant", () => {
    expect(withAnnotationRev(1, 0)).toBeLessThan(withAnnotationRev(2, 0));
    expect(withAnnotationRev(1, 1)).toBeGreaterThan(withAnnotationRev(1, 0));
  });
  test("withCollapsedVersion changes when only collapsed flips", () => {
    expect(withCollapsedVersion(5, false)).not.toBe(withCollapsedVersion(5, true));
  });
  test("withCollapsedVersion stays dominated by the underlying version", () => {
    expect(withCollapsedVersion(1, true)).toBeLessThan(withCollapsedVersion(2, false));
  });
  test("withCollapsedVersion composes on top of withAnnotationRev without collisions", () => {
    const a = withCollapsedVersion(withAnnotationRev(1, 0), false);
    const b = withCollapsedVersion(withAnnotationRev(1, 0), true);
    const c = withCollapsedVersion(withAnnotationRev(1, 1), false);
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
