import { describe, expect, test } from "bun:test";
import { createSingleFlightCache } from "./singleFlight";

function fakeFn(fail = false) {
  let calls = 0;
  const fn = () => {
    calls++;
    return fail ? Promise.reject(new Error("boom")) : Promise.resolve(calls);
  };
  return { fn, calls: () => calls };
}

describe("createSingleFlightCache", () => {
  test("a second get() within the TTL reuses the first run instead of calling fn again", async () => {
    const { fn, calls } = fakeFn();
    let now = 1000;
    const cache = createSingleFlightCache(fn, { now: () => now, ttlMs: 2000 });

    await cache.get();
    now += 1000;
    await cache.get();

    expect(calls()).toBe(1);
  });

  test("get() after the TTL has elapsed runs again", async () => {
    const { fn, calls } = fakeFn();
    let now = 1000;
    const cache = createSingleFlightCache(fn, { now: () => now, ttlMs: 2000 });

    await cache.get();
    now += 2001;
    await cache.get();

    expect(calls()).toBe(2);
  });

  test("two concurrent get() calls share one in-flight run", async () => {
    const { fn, calls } = fakeFn();
    const cache = createSingleFlightCache(fn, { now: () => 1000 });

    await Promise.all([cache.get(), cache.get()]);

    expect(calls()).toBe(1);
  });

  test("a failed run is not cached — the next call retries immediately", async () => {
    const { fn, calls } = fakeFn(true);
    const cache = createSingleFlightCache(fn, { now: () => 1000 });

    await cache.get().catch(() => {});
    await cache.get().catch(() => {});

    expect(calls()).toBe(2);
  });
});
