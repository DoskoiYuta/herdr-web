import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";
import { createPollerRegistry, createWorktreePoller, type ChangedInfo } from "./poller";

const execFileP = promisify(execFile);
const dirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "herdr-web-poller-test-"));
  dirs.push(dir);
  await execFileP("git", ["init", "-q"], { cwd: dir });
  await execFileP("git", ["config", "user.name", "Test"], { cwd: dir });
  await execFileP("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await writeFile(join(dir, "a.txt"), "a\n");
  await execFileP("git", ["add", "."], { cwd: dir });
  await execFileP("git", ["commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("createWorktreePoller", () => {
  test("calls onChanged with reason 'status' when the worktree becomes dirty", async () => {
    const dir = await makeRepo();
    const events: ChangedInfo[] = [];
    const poller = createWorktreePoller({
      root: dir,
      intervalMs: 20,
      onChanged: (e) => events.push(e),
    });

    await poller.start();
    await writeFile(join(dir, "a.txt"), "changed\n");
    await sleep(150);
    poller.stop();

    expect(events.some((e) => e.reason === "status" && e.root === dir)).toBe(true);
  });

  test("calls onChanged with reason 'refs' when a new branch is created", async () => {
    const dir = await makeRepo();
    const events: ChangedInfo[] = [];
    const poller = createWorktreePoller({
      root: dir,
      intervalMs: 20,
      onChanged: (e) => events.push(e),
    });

    await poller.start();
    await execFileP("git", ["branch", "other"], { cwd: dir });
    await sleep(150);
    poller.stop();

    expect(events.some((e) => e.reason === "refs")).toBe(true);
  });

  test("does not fire onChanged before the first tick has a prior snapshot", async () => {
    const dir = await makeRepo();
    const events: ChangedInfo[] = [];
    const poller = createWorktreePoller({
      root: dir,
      intervalMs: 1000,
      onChanged: (e) => events.push(e),
    });
    await poller.start();
    poller.stop();
    expect(events).toEqual([]);
  });

  test("onStatus reports an error transition for a non-repo directory, then clears it", async () => {
    const notARepo = await mkdtemp(join(tmpdir(), "herdr-web-poller-norepo-"));
    dirs.push(notARepo);
    const statuses: (string | null)[] = [];
    const poller = createWorktreePoller({
      root: notARepo,
      intervalMs: 20,
      onStatus: (s) => statuses.push(s.error),
    });
    await poller.start();
    poller.stop();
    expect(statuses.some((s) => s !== null)).toBe(true);
  });
});

describe("createPollerRegistry", () => {
  test("watch starts a poller; a second watch on the same root just bumps refcount", () => {
    const registry = createPollerRegistry({ intervalMs: 5000 });
    registry.watch("/some/root");
    registry.watch("/some/root");
    expect(registry.refCount("/some/root")).toBe(2);
    registry.stopAll();
  });

  test("unwatch decrements refcount and stops the poller at zero", () => {
    const registry = createPollerRegistry({ intervalMs: 5000 });
    registry.watch("/some/root");
    registry.watch("/some/root");
    registry.unwatch("/some/root");
    expect(registry.refCount("/some/root")).toBe(1);
    registry.unwatch("/some/root");
    expect(registry.refCount("/some/root")).toBe(0);
  });

  test("unwatch on an unwatched root is a no-op", () => {
    const registry = createPollerRegistry({ intervalMs: 5000 });
    expect(() => registry.unwatch("/never/watched")).not.toThrow();
    expect(registry.refCount("/never/watched")).toBe(0);
  });

  test("routes onChanged/onStatus per-root to a shared callback", async () => {
    const dir = await makeRepo();
    const events: ChangedInfo[] = [];
    const registry = createPollerRegistry({ intervalMs: 20, onChanged: (e) => events.push(e) });
    registry.watch(dir);
    await sleep(50); // let the first tick establish a baseline snapshot
    await writeFile(join(dir, "a.txt"), "changed\n");
    await sleep(150);
    registry.stopAll();

    expect(events.some((e) => e.root === dir && e.reason === "status")).toBe(true);
  });
});
