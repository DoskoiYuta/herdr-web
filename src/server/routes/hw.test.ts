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
  });

  test("404 for unknown pane", async () => {
    const { app } = await withState(createFakeHerdr(snapshot), { resolve: async () => null });
    const res = await app.request("/api/hw/whoami?pane=nope");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/hw/worktree", () => {
  test("declares the pane's worktree override, resolved through the given resolver", async () => {
    const pane = snapshot.panes[0] as PaneInfo;
    const { app, state } = await withState(createFakeHerdr(snapshot), {
      async resolve(path) {
        return {
          root: `${path}/resolved`,
          commonDir: `${path}/.git`,
          branch: "main",
          isMain: true,
        };
      },
    });
    const res = await app.request("/api/hw/worktree", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pane: pane.pane_id, root: "/some/path" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pane: pane.pane_id, root: "/some/path/resolved" });
    expect(state.get().panes.get(pane.pane_id)).toBeDefined();
  });

  // 無いと壊れる: hook が誤って本体の cwd（= 実際の worktree と同じ場所）を
  // 宣言してしまったとき、無害な no-op ではなく無意味な上書きが残ってしまう。
  test("no-ops (and clears any stale override) when root resolves to the pane's own raw worktree", async () => {
    const pane = snapshot.panes[0] as PaneInfo;
    const rawCwd = pane.foreground_cwd ?? pane.cwd ?? "";
    const { app, state } = await withState(createFakeHerdr(snapshot), {
      async resolve(path) {
        return { root: path, commonDir: `${path}/.git`, branch: "main", isMain: true };
      },
    });
    state.setWorktreeOverride(pane.pane_id, "/declared/wt");

    const res = await app.request("/api/hw/worktree", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pane: pane.pane_id, root: rawCwd }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pane: pane.pane_id, root: rawCwd });
    expect(state.get().paneWorktreeOverrides.has(pane.pane_id)).toBe(false);
  });

  // 無いと壊れる: git worktree として解決できない root がそのまま宣言され、
  // 以降そのペインの実効 cwd が存在しないパスに固定されてしまう。
  test("400 when root does not resolve to a git worktree", async () => {
    const pane = snapshot.panes[0] as PaneInfo;
    const { app } = await withState(createFakeHerdr(snapshot), { resolve: async () => null });
    const res = await app.request("/api/hw/worktree", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pane: pane.pane_id, root: "/not/a/worktree" }),
    });
    expect(res.status).toBe(400);
  });

  // 無いと壊れる: herdr 側に存在しない pane 宛の宣言が黙って受理され、孤児の
  // 上書きが残り続ける。
  test("404 for an unknown pane", async () => {
    const { app } = await withState(createFakeHerdr(snapshot), {
      async resolve(path) {
        return { root: path, commonDir: `${path}/.git`, branch: "main", isMain: true };
      },
    });
    const res = await app.request("/api/hw/worktree", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pane: "no-such-pane", root: "/some/path" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/hw/worktree", () => {
  test("clears the pane's worktree override, falling back to its raw effective cwd", async () => {
    const pane = snapshot.panes[0] as PaneInfo;
    const { app, state } = await withState(createFakeHerdr(snapshot), {
      async resolve(path) {
        return { root: path, commonDir: `${path}/.git`, branch: "main", isMain: true };
      },
    });
    state.setWorktreeOverride(pane.pane_id, "/declared/wt");

    const res = await app.request(`/api/hw/worktree?pane=${encodeURIComponent(pane.pane_id)}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      pane: pane.pane_id,
      root: pane.foreground_cwd ?? pane.cwd ?? null,
    });
  });

  test("404 for an unknown pane", async () => {
    const { app } = await withState(createFakeHerdr(snapshot), { resolve: async () => null });
    const res = await app.request("/api/hw/worktree?pane=no-such-pane", { method: "DELETE" });
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
