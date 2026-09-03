// Parity check: `src/web/lib/anchor.ts`'s browser-side `buildAnchor` (Web
// Crypto SHA-1, async) must produce byte-for-byte the same `Anchor` as this
// module's `buildAnchor` (Bun.CryptoHasher, sync) for the same inputs — see
// plan.md F5-2. This is the one file allowed to cross the review/domain ->
// web boundary (see the `anchor-parity.test.ts` exception in
// `.dependency-cruiser.cjs`'s `review-domain-pure` rule); it exists purely
// to assert that parity, not to exercise product behavior.
import { describe, expect, test } from "bun:test";
import { buildAnchor as buildAnchorWeb } from "../../../web/lib/anchor";
import { buildAnchor as buildAnchorServer } from "./anchor";

describe("anchor parity: web buildAnchor === server buildAnchor", () => {
  test("a line in the middle of a file, with full before/after context", async () => {
    const lines = ["one", "two", "three", "four", "five", "six", "seven"];
    const server = buildAnchorServer(lines, 3, "new");
    const web = await buildAnchorWeb(lines, 3, "new");
    expect(web).toEqual(server);
  });

  test("the first line (no before context)", async () => {
    const lines = ["only", "second", "third"];
    const server = buildAnchorServer(lines, 0, "old");
    const web = await buildAnchorWeb(lines, 0, "old");
    expect(web).toEqual(server);
  });

  test("the last line (no after context)", async () => {
    const lines = ["a", "b", "c"];
    const server = buildAnchorServer(lines, 2, "new");
    const web = await buildAnchorWeb(lines, 2, "new");
    expect(web).toEqual(server);
  });

  test("trailing whitespace and \\r are normalized identically", async () => {
    const lines = ["foo  \t", "bar\r", "baz   "];
    const server = buildAnchorServer(lines, 1, "old");
    const web = await buildAnchorWeb(lines, 1, "old");
    expect(web).toEqual(server);
  });

  test("a single-line file", async () => {
    const lines = ["lonely"];
    const server = buildAnchorServer(lines, 0, "new");
    const web = await buildAnchorWeb(lines, 0, "new");
    expect(web).toEqual(server);
  });
});
