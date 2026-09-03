import { describe, expect, test } from "vitest";
import { annotationSignature, withAnnotationRev } from "./annotationVersion";

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
});
