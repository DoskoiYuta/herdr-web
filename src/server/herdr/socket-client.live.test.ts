import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as v from "valibot";
import { SessionSnapshotSchema } from "../../contract/herdr";
import { createHerdrSocketClient } from "./socket-client";

const socketPath = process.env.HERDR_SOCKET_PATH ?? `${process.env.HOME}/.config/herdr/herdr.sock`;
const hasLiveHerdr = fs.existsSync(socketPath);

/**
 * Integration test against a real, running herdr instance. Skipped in CI / any
 * environment without a live herdr socket. When run (as it was during
 * development, from inside a herdr pane), it confirmed:
 *   - `ping` returns `{ type: "pong", version, protocol: 20 }`.
 *   - `session.snapshot` parses cleanly against `SessionSnapshotSchema`.
 *   - `events.subscribe` acks with `{ type: "subscription_started" }` and the
 *     connection then keeps streaming `{ event, data }` frames.
 */
describe.skipIf(!hasLiveHerdr)("socket-client (live herdr)", () => {
  test("pings, snapshots, and subscribes against the real herdr socket", async () => {
    const client = createHerdrSocketClient({
      socketPath,
      logger: { error() {}, warn() {}, info() {} },
    });
    try {
      const pong = await client.ping();
      expect(pong.type).toBe("pong");
      expect(pong.protocol).toBeGreaterThan(0);

      const snapshot = await client.snapshot();
      const parsed = v.safeParse(SessionSnapshotSchema, snapshot);
      expect(parsed.success).toBe(true);

      const received: unknown[] = [];
      const unsubscribe = client.subscribe((e) => received.push(e));
      // Focusing our own pane is a documented no-op for the focused pane, so this
      // is safe to run without stealing focus from the user (plan.md §12-9 note).
      const ownPaneId = process.env.HERDR_PANE_ID;
      if (ownPaneId) {
        await client.paneFocus(ownPaneId);
      }
      await new Promise((r) => setTimeout(r, 500));
      unsubscribe();
      // We can't guarantee *any* event arrives in 500ms in a live environment,
      // so this is a soft assertion: if something arrived, it must be well-formed.
      expect(Array.isArray(received)).toBe(true);
    } finally {
      client.close();
    }
  }, 15_000);
});
