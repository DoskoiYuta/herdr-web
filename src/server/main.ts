import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { createApp } from "./app";
import { serveEmbedded } from "./static";
import type { WebAssets } from "./web-assets";
import {
  attachReviewToRuntime,
  attachWorktreeMissingToReview,
  createRuntime,
  herdrSocketPath,
} from "./bootstrap";
import { applyEnvOverrides, loadConfig, resolveDbPath } from "./config";
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

const runtime = createRuntime({ config });

const review = createReviewRuntime({
  config,
  db: reviewDb,
  herdr: { state: runtime.state, gateway: runtime.gateway, resolver: runtime.resolver },
  onEvent: (e) => runtime.hub.broadcast(e),
});
attachReviewToRuntime(runtime, review);
attachWorktreeMissingToReview(runtime, review);
// F5: pick back up any notification a debounce timer lost when the process last exited.
await review.notifyScheduler.drainPending();

const api = createApp({
  version: "0.1.0",
  herdrStatus: runtime.herdrStatus,
  git: { allowedRoots: config.allowedRoots },
  review: review.routes,
  repo: review.repoRoutes,
  hw: { state: runtime.state, resolver: runtime.resolver },
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
