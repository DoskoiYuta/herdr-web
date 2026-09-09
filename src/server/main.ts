#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { createApp } from "./app";
// TODO(ask-session): swap for createHerdrAskLauncher (src/server/herdr/ask-session.ts)
import { createAskRuntime } from "./ask/runtime";
import { createDecisionRuntime } from "./decision/runtime";
import { createHerdrAskLauncher } from "./herdr/ask-session";
import { createFetchRunner } from "./git/fetch";
import { listSubRepos } from "./git/subrepos";
import { listWorktrees } from "./git/worktrees";
import { serveEmbedded } from "./static";
import type { WebAssets } from "./web-assets";
import {
  attachReviewToRuntime,
  attachWorktreeMissingToReview,
  createRuntime,
  herdrSocketPath,
} from "./bootstrap";
import { applyEnvOverrides, configDir, loadConfig, resolveDbPath } from "./config";
import { createDockerCache } from "./docker/cache";
import { createDockerLogsWss } from "./docker/logsWs";
import { spawnDockerLogs } from "./docker/logsSpawn";
import { createDockerRunner } from "./docker/runner";
import { ensureHwShim } from "./hw-shim";
import { createInboxService } from "./inbox/service";
import { createNotesService } from "./notes/service";
import { createSqliteNotesRepository } from "./notes/sqlite-repository";
import { createReviewRuntime, openReviewDb } from "./review/runtime";
import { spawnHerdr } from "./terminal/pty";
import { createTermWss } from "./terminal/ws";
import { createUpgradeRouter } from "./ws/upgrade";

const isProd = process.env.NODE_ENV === "production";
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

const configArgIndex = process.argv.indexOf("--config");
const loaded = await loadConfig(configArgIndex >= 0 ? process.argv[configArgIndex + 1] : undefined);
if (loaded.problem) {
  console.warn(`config ${loaded.path}: ${loaded.problem} — 既定値で続行します`);
}
const config = applyEnvOverrides(loaded.config);
if (config.host !== "127.0.0.1" && config.host !== "localhost" && config.host !== "::1") {
  console.warn(
    `警告: ${config.host} にバインドします。ブラウザから到達できる者は実行ユーザーと同じ権限を持ちます（plan N1/N2）。`,
  );
}

// Open the DB (and run migrations) BEFORE createRuntime: a DB failure here must
// not leave sockets/pollers already running with no way to persist reviews.
const dbPath = resolveDbPath(config);
await mkdir(dirname(dbPath), { recursive: true });
const reviewDb = openReviewDb(dbPath);

// Structured startup log: one readable block covering everything needed to debug
// "why won't this instance talk to herdr / where's it reading from" without
// re-deriving paths by hand.
{
  let gitVersion = "missing";
  try {
    const proc = Bun.spawn(["git", "--version"], { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      gitVersion = (await new Response(proc.stdout).text()).trim();
    }
  } catch {
    gitVersion = "missing";
  }
  console.log(
    [
      "herdr-web: startup",
      `  config path:      ${loaded.path}`,
      `  db path:          ${dbPath}`,
      `  herdr socket:     ${herdrSocketPath(config)}`,
      `  herdr bin:        ${config.herdrBin}`,
      `  allowed roots:    ${JSON.stringify(config.allowedRoots)}`,
      `  git --version:    ${gitVersion}`,
    ].join("\n"),
  );
}

const runtime = createRuntime({ config, db: reviewDb });

const runtimeHerdrDeps = {
  state: runtime.state,
  gateway: runtime.gateway,
  resolver: runtime.resolver,
  listWorktrees,
  listSubRepos,
};

const review = createReviewRuntime({
  config,
  db: reviewDb,
  herdr: runtimeHerdrDeps,
  onEvent: (e) => runtime.hub.broadcast(e),
});
attachReviewToRuntime(runtime, review);
attachWorktreeMissingToReview(runtime, review);
// F5: pick back up any notification a debounce timer lost when the process last exited.
await review.notifyScheduler.drainPending();

const hwBinDir = await ensureHwShim({
  configDir: configDir(),
  mode: isProd ? "production" : "dev",
});

const ask = createAskRuntime({
  config,
  db: reviewDb,
  launcher: createHerdrAskLauncher({
    gateway: runtime.gateway,
    state: runtime.state,
    config: { maxSessions: config.ask.maxSessions },
    hwBinDir,
    hwUrl: `http://127.0.0.1:${config.port}`,
  }),
  onEvent: (e) => runtime.hub.broadcast(e),
});

const decision = createDecisionRuntime({
  db: reviewDb,
  herdr: runtimeHerdrDeps,
  onEvent: (e) => runtime.hub.broadcast(e),
});
// F13-9: pick back up any decision whose delivery was mid-backoff when the process last exited.
await decision.delivery.drainPending();

const notesRepository = createSqliteNotesRepository(reviewDb);
const notes = createNotesService({
  repository: notesRepository,
  clock: { now: () => new Date() },
});

const inbox = createInboxService({
  reviewRepository: review.repository,
  askRepository: ask.repository,
  decisionRepository: decision.repository,
  state: runtime.state,
  resolver: runtime.resolver,
  listWorktrees,
  listSubRepos,
});

const fetchRunner = createFetchRunner();

// Shared with `/ws/docker-logs` (main.ts's upgradeRouter.add below) so both
// the containers list and the per-connection root/id check reuse one
// TTL/single-flight `docker ps` instead of doubling the polling load.
const dockerCache = createDockerCache({ runner: createDockerRunner() });

const api = createApp({
  version: "0.1.0",
  herdrStatus: runtime.herdrStatus,
  git: { allowedRoots: config.allowedRoots, fetchRunner },
  clientConfig: () => ({
    terminal: config.terminal,
    graphInitialCommits: config.graphInitialCommits,
    ask: {
      agents: config.ask.agents,
      defaultAgent: config.ask.defaultAgent,
      maxSessions: config.ask.maxSessions,
    },
    paths: { config: loaded.path, db: dbPath },
  }),
  review: review.routes,
  repo: review.repoRoutes,
  hw: { state: runtime.state, resolver: runtime.resolver, listWorktrees, listSubRepos },
  herdr: {
    gateway: runtime.gateway,
    state: runtime.state,
    resolver: runtime.resolver,
    listWorktrees,
    listSubRepos,
    allowedRoots: config.allowedRoots,
  },
  ask: ask.routes,
  decision: {
    ...decision.routes,
    buildUrl: (id) => `http://${config.host}:${config.port}/decisions/${id}`,
  },
  notes: { service: notes, repository: notesRepository },
  docker: { allowedRoots: config.allowedRoots, cache: dockerCache },
  proc: { allowedRoots: config.allowedRoots },
  inbox: { service: inbox },
});

const app = new Hono().route("/", api);

if (isProd) {
  // dist/web は build:web が src/server/web-assets.generated.ts に埋め込む（単一バイナリ対応）
  const { webAssets } = (await import("./web-assets")) as { webAssets: WebAssets };
  app.get("*", serveEmbedded(webAssets));
}

const honoListener = getRequestListener(app.fetch);
const server = createServer();

if (isProd) {
  server.on("request", honoListener);
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    configFile: `${projectRoot}vite.config.ts`,
    server: { middlewareMode: true, hmr: { server } },
    appType: "spa",
  });
  server.on("request", (req, res) => {
    if (req.url?.startsWith("/api/")) {
      void honoListener(req, res);
      return;
    }
    vite.middlewares(req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
}

const upgradeRouter = createUpgradeRouter(server);
upgradeRouter.add(
  "/ws/term",
  createTermWss({
    spawn: (opts) =>
      spawnHerdr({
        ...opts,
        bin: config.herdrBin,
        session: opts.session ?? config.herdrSession ?? undefined,
        envPassthrough: config.herdrEnvPassthrough,
      }),
  }),
);
upgradeRouter.add("/ws/events", runtime.eventsWss);
upgradeRouter.add(
  "/ws/docker-logs",
  createDockerLogsWss({
    allowedRoots: config.allowedRoots,
    cache: dockerCache,
    spawn: spawnDockerLogs,
  }),
);

server.on("error", (err) => {
  if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
    console.error(
      `herdr-web: port ${config.port} is already in use on ${config.host} — is another instance running?`,
    );
  } else {
    console.error("herdr-web: server error", err);
  }
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  console.log(
    `herdr-web listening on http://${config.host}:${config.port} (${isProd ? "prod" : "dev"})`,
  );
});

// ブラウザの `localhost` は macOS では ::1 に解決されることが多い。127.0.0.1 だけに
// bind していると `localhost:<port>` は別プロセス（Docker 等）に届いたり拒否されたりする。
// 本番は ::1 にも同じハンドラで listen する。開発時は Vite HMR が 1 つの http.Server に
// しか付けられないので、警告だけ出して 127.0.0.1 を案内する。
if (config.host === "127.0.0.1") {
  const v6 = createServer();
  v6.on("request", (req, res) => server.emit("request", req, res));
  v6.on("upgrade", (req, socket, head) => server.emit("upgrade", req, socket, head));
  v6.on("error", (err) => {
    const code = (err as NodeJS.ErrnoException).code;
    console.warn(
      `herdr-web: ::1:${config.port} を使えません（${code ?? err.message}）。ブラウザでは http://127.0.0.1:${config.port} を開いてください（localhost は ::1 に解決されることがあります）`,
    );
  });
  if (isProd) {
    v6.listen(config.port, "::1", () => {
      console.log(`herdr-web also listening on http://[::1]:${config.port}`);
    });
  } else {
    console.warn(
      `herdr-web: 開発モードでは 127.0.0.1 のみ listen します。ブラウザでは http://127.0.0.1:${config.port} を開いてください（localhost:${config.port} は ::1 に向くことがあります）`,
    );
  }
}

function shutdown() {
  // Stop pollers/wiring before closing the DB, so nothing tries to write to a
  // closed handle mid-shutdown; a DB close failure shouldn't block exit either.
  runtime.stop();
  try {
    reviewDb.$client.close();
  } catch (err) {
    console.error("herdr-web: error closing db during shutdown", err);
  }
  server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
