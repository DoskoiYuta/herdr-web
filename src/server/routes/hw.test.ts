import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import snapshotJson from "../../contract/__fixtures__/snapshot.json";
import { SessionSnapshotSchema, type PaneInfo } from "../../contract/herdr";
import { WhoamiResponseSchema } from "../../contract/hw";
import { createFakeHerdr } from "../herdr/fake";
import { createTestApp } from "../testing/app-deps";

const snapshot = v.parse(SessionSnapshotSchema, snapshotJson);

describe("GET /api/hw/whoami", () => {
  test("resolves pane → worktree", async () => {
    const fake = createFakeHerdr(snapshot);
    const pane = snapshot.panes[0] as PaneInfo;
    const { app } = await withState(fake, {
      async resolve(path) {
        return { root: path, commonDir: `${path}/.git`, branch: "main", isMain: true };
      },
    });
    const res = await app.request(`/api/hw/whoami?pane=${encodeURIComponent(pane.pane_id)}`);
    expect(res.status).toBe(200);
    const body = v.parse(WhoamiResponseSchema, await res.json());
    expect(body.pane).toBe(pane.pane_id);
    expect(body.worktreeRoot).toBe(pane.foreground_cwd ?? pane.cwd ?? null);
    expect(body.repoKey).toBe(`${body.worktreeRoot}/.git`);
    expect(body.selectionIsDefault).toBe(true);
  });

  test("404 for unknown pane", async () => {
    const { app } = await withState(createFakeHerdr(snapshot), { resolve: async () => null });
    const res = await app.request("/api/hw/whoami?pane=nope");
    expect(res.status).toBe(404);
  });
});

async function withState(
  fake: ReturnType<typeof createFakeHerdr>,
  resolver: {
    resolve: (p: string) => Promise<{
      root: string;
      commonDir: string;
      branch: string | null;
      isMain: boolean;
    } | null>;
  },
) {
  const t = createTestApp({ fake, resolver });
  await new Promise((r) => setTimeout(r, 10));
  return t;
}
