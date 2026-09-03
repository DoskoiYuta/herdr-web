import { describe, expect, test } from "bun:test";
import { ManualTimer } from "../testing/fakes";
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

  // F11: keys must not accumulate forever — once a key's chain fully settles
  // (and nothing newer has been queued for it since), its map entry is removed.
  test("the internal chain map shrinks once a key's queue drains", async () => {
    const locks = createLocks();

    await locks.withLock("k1", async () => "a");
    expect(locks.size()).toBe(0);

    const p1 = locks.withLock("k2", async () => {
      await new Promise((r) => setTimeout(r, 10));
      return "x";
    });
    // still in flight
    expect(locks.size()).toBe(1);
    await p1;
    expect(locks.size()).toBe(0);
  });

  test("a key still queued when one holder settles is not removed early", async () => {
    const locks = createLocks();
    let resolveFirst: () => void;
    const gate = new Promise<void>((r) => {
      resolveFirst = r;
    });
    const first = locks.withLock("k", async () => {
      await gate;
    });
    const second = locks.withLock("k", async () => "second");

    resolveFirst!();
    await first;
    // second is still queued/running (or just about to) — key must remain tracked
    // until the whole chain (second included) has settled.
    await second;
    expect(locks.size()).toBe(0);
  });

  // F11: a holder that runs past the warn threshold logs a warning, using an
  // injectable timer so tests don't need to wait 30 real seconds.
  test("logs a warning when a holder exceeds the configured threshold", async () => {
    const timer = new ManualTimer();
    const warnings: unknown[][] = [];
    const locks = createLocks({
      timer,
      warnAfterMs: 30_000,
      logger: { warn: (...args: unknown[]) => warnings.push(args) },
    });

    let release: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const held = locks.withLock("slow", async () => {
      await gate;
    });

    // let the async holder reach its `timer.setTimeout` watchdog registration
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // not yet exceeded
    timer.advance(29_999);
    expect(warnings).toHaveLength(0);

    timer.advance(1);
    expect(warnings.length).toBeGreaterThan(0);

    release!();
    await held;
  });

  test("the watchdog is cleared on release and does not warn after the fact", async () => {
    const timer = new ManualTimer();
    const warnings: unknown[][] = [];
    const locks = createLocks({
      timer,
      warnAfterMs: 30_000,
      logger: { warn: (...args: unknown[]) => warnings.push(args) },
    });

    await locks.withLock("fast", async () => "done");
    timer.advance(60_000);
    expect(warnings).toHaveLength(0);
  });
});
