import { getRequestListener } from "@hono/node-server";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Review } from "../contract/review";
import { createHwClient } from "../cli/client";
import { runCli } from "../cli/cli";
import type { CommandDeps } from "../cli/commands/types";
import { createFakeHerdr } from "./herdr/fake";
import { createTestApp } from "./testing/app-deps";

/**
 * End-to-end coverage for the `hw` CLI against a real (in-process) server —
 * see plan §7 F6/F7, §9.4. `src/cli` can't import `createTestApp` (it's a
 * server import), so this test lives on the server side instead and drives
 * the CLI's client + command handlers over a real HTTP server.
 */

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  return stdout.trim();
}

async function initRepo(): Promise<{ root: string; repoKey: string; head: string }> {
  // realpath: macOS's $TMPDIR is a /tmp symlink into /private/tmp, and the
  // server always realpath's the paths it resolves (see git/resolve.ts).
  const root = await realpath(await mkdtemp(join(tmpdir(), "hw-cli-test-")));
  await runGit(["init", "-q"], root);
  await runGit(["config", "user.email", "test@example.com"], root);
  await runGit(["config", "user.name", "test"], root);
  await Bun.write(join(root, "foo.txt"), "line1\nline2\nline3\n");
  await runGit(["add", "foo.txt"], root);
  await runGit(["commit", "-q", "-m", "initial"], root);
  const head = await runGit(["rev-parse", "HEAD"], root);
  const repoKey = await runGit(["rev-parse", "--git-common-dir"], root);
  return { root, repoKey: repoKey.startsWith("/") ? repoKey : join(root, repoKey), head };
}

describe("hw CLI against a real server", () => {
  let repo: Awaited<ReturnType<typeof initRepo>>;
  let server: Server | null = null;
  let baseUrl = "";
  let deps: CommandDeps;
  let seededId = "";

  beforeEach(async () => {
    repo = await initRepo();

    const fake = createFakeHerdr({
      agents: [],
      panes: [
        {
          pane_id: "p1",
          terminal_id: "t1",
          workspace_id: "w1",
          tab_id: "tab1",
          focused: true,
          agent_status: "idle",
          revision: 1,
          foreground_cwd: repo.root,
          cwd: repo.root,
          // POST /api/review/send only sends when there's an agent pane at the
          // worktree root (see herdr-notifier's targetsAt) — this fixture is the
          // agent this whole suite's flows notify.
          agent: "claude",
        },
      ],
      tabs: [],
      workspaces: [],
      layouts: [],
      focused_pane_id: "p1",
      focused_tab_id: null,
      focused_workspace_id: null,
      protocol: 20,
      version: "test",
    });

    const testApp = createTestApp({ fake });
    // let the async session.snapshot load land before we issue requests
    await new Promise((r) => setTimeout(r, 0));

    server = createServer();
    server.on("request", getRequestListener(testApp.app.fetch));
    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;

    const client = createHwClient(baseUrl);
    deps = {
      client,
      env: { HERDR_PANE_ID: "p1" },
      cwd: repo.root,
      readStdin: () => Promise.resolve(""),
    };

    const res = await fetch(`${baseUrl}/api/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repo: repo.repoKey,
        worktreeRoot: repo.root,
        target: { kind: "worktree", root: repo.root },
        path: "foo.txt",
        anchor: {
          side: "new",
          lines: ["line2"],
          before: ["line1"],
          after: ["line3"],
          lineHint: 2,
          hash: "deadbeef",
        },
        createdAtHead: repo.head,
        viewedAs: { from: "WORKTREE", to: "HEAD" },
        body: "please double check this line",
      }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as Review;
    seededId = created.id;

    // Reviews are created as drafts and are invisible to the agent (and to `hw`)
    // until sent — send it now so the rest of this suite sees it as `hw` would.
    const sendRes = await fetch(`${baseUrl}/api/review/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: repo.repoKey, worktreeRoot: repo.root }),
    });
    expect(sendRes.status).toBe(200);
  });

  afterEach(async () => {
    server?.close();
    server = null;
    await rm(repo.root, { recursive: true, force: true });
  });

  describe("client.ts", () => {
    test("whoami resolves the pane's worktree via real git", async () => {
      const result = await deps.client.whoami("p1");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.worktreeRoot).toBe(repo.root);
      expect(result.value.repoKey).toBe(repo.repoKey);
      expect(result.value.agentSession).toBeNull();
    });

    test("whoami for an unknown pane is a domain (404) error", async () => {
      const result = await deps.client.whoami("nope");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("http");
    });

    test("listReviews returns the seeded review for the worktree", async () => {
      const result = await deps.client.listReviews({ repo: repo.repoKey, worktree: repo.root });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.map((r) => r.id)).toEqual([seededId]);
    });

    test("getReview / replyToReview round-trip and flip status to replied", async () => {
      const got = await deps.client.getReview(seededId);
      expect(got.ok).toBe(true);
      if (!got.ok) return;
      expect(got.value.status).toBe("open");

      const replied = await deps.client.replyToReview(seededId, "fixed", null);
      expect(replied.ok).toBe(true);
      if (!replied.ok) return;
      expect(replied.value.status).toBe("replied");
      expect(replied.value.thread.at(-1)?.body).toBe("fixed");
    });

    test("network error against an unreachable port", async () => {
      const client = createHwClient("http://127.0.0.1:1");
      const result = await client.health();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("network");
    });

    test("moveRepo rewrites the repo key prefix", async () => {
      const result = await deps.client.moveRepo(repo.repoKey, `${repo.repoKey}-moved`);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.repos).toBeGreaterThanOrEqual(1);
      expect(result.value.reviews).toBeGreaterThanOrEqual(1);
    });
  });

  describe("command handlers", () => {
    test("hw review list (human output)", async () => {
      const result = await runCli(["review", "list"], deps);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(seededId.slice(-8));
      expect(result.stdout).toContain("open");
      expect(result.stdout).toContain("foo.txt:2");
      expect(result.stdout).toContain("please double check this line");
      expect(result.stdout).toContain("1 件");
    });

    test("hw review list --json", async () => {
      const result = await runCli(["review", "list", "--json"], deps);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout) as Review[];
      expect(parsed).toHaveLength(1);
      expect(parsed[0]?.id).toBe(seededId);
    });

    test("hw review show <id>", async () => {
      const result = await runCli(["review", "show", seededId], deps);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`id: ${seededId}`);
      expect(result.stdout).toContain("line2");
      expect(result.stdout).toContain("please double check this line");
    });

    test("hw review show <unknown-id> exits 3 with the server's message", async () => {
      const result = await runCli(["review", "show", "does-not-exist"], deps);
      expect(result.exitCode).toBe(3);
      expect(result.stdout).toContain("not found");
    });

    test("hw review reply <id> <text...> flips status to replied", async () => {
      const result = await runCli(["review", "reply", seededId, "looks", "good"], deps);
      expect(result.exitCode).toBe(0);

      const show = await runCli(["review", "show", seededId], deps);
      expect(show.stdout).toContain("status: replied");
      expect(show.stdout).toContain("looks good");
    });

    test("hw review reply <id> - reads the body from stdin", async () => {
      const stdinDeps: CommandDeps = { ...deps, readStdin: () => Promise.resolve("from stdin\n") };
      const result = await runCli(["review", "reply", seededId, "-"], stdinDeps);
      expect(result.exitCode).toBe(0);

      const show = await runCli(["review", "show", seededId], deps);
      expect(show.stdout).toContain("from stdin");
    });

    test("hw status reports server, worktree, repo and session", async () => {
      const result = await runCli(["status"], deps);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("server: ok");
      expect(result.stdout).toContain(`worktree: ${repo.root}`);
      expect(result.stdout).toContain(`repo: ${repo.repoKey}`);
      expect(result.stdout).toContain("session: (none)");
    });

    test("hw status against an unreachable server exits 2", async () => {
      const unreachableDeps: CommandDeps = {
        ...deps,
        client: createHwClient("http://127.0.0.1:1"),
      };
      const result = await runCli(["status"], unreachableDeps);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toContain("unreachable");
    });

    test("hw repo move <old> <new>", async () => {
      const result = await runCli(["repo", "move", repo.repoKey, `${repo.repoKey}-moved2`], deps);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("moved");
    });

    test("unknown flag is a usage error (exit 1)", async () => {
      const result = await runCli(["review", "list", "--bogus"], deps);
      expect(result.exitCode).toBe(1);
    });

    test("hw --help exits 0 and prints usage", async () => {
      const result = await runCli(["--help"], deps);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hw review list");
    });
  });
});
