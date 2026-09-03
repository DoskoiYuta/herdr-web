import { describe, expect, test } from "bun:test";
import { createLocks } from "./locks";

describe("createLocks", () => {
  test("withLock serializes concurrent calls on the same key (FIFO)", async () => {
    const locks = createLocks();
    const order: string[] = [];

    function slow(tag: string, ms: number): Promise<void> {
      return locks.withLock("k", async () => {
        order.push(`start:${tag}`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`end:${tag}`);
      });
    }

    const a = slow("a", 20);
    const b = slow("b", 0);
    await Promise.all([a, b]);

    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });

  test("different keys run independently (do not serialize)", async () => {
    const locks = createLocks();
    const order: string[] = [];

    const a = locks.withLock("a", async () => {
      order.push("a-start");
      await new Promise((r) => setTimeout(r, 20));
      order.push("a-end");
    });
    const b = locks.withLock("b", async () => {
      order.push("b-start");
      order.push("b-end");
    });

    await Promise.all([a, b]);
    // b (no delay) finishes before a even though a started first
    expect(order.indexOf("b-end")).toBeLessThan(order.indexOf("a-end"));
  });

  test("a rejection in one holder does not wedge later callers on the same key", async () => {
    const locks = createLocks();
    const first = locks.withLock("k", async () => {
      throw new Error("boom");
    });
    await expect(first).rejects.toThrow("boom");

    const second = await locks.withLock("k", async () => "ok");
    expect(second).toBe("ok");
  });
});
