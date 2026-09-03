import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { createApp } from "./app";
import { createFetchRunner } from "./git/fetch";
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

const fetchRunner = createFetchRunner();

const api = createApp({
  version: "0.1.0",
  herdrStatus: runtime.herdrStatus,
  git: { allowedRoots: config.allowedRoots, fetchRunner },
  clientConfig: () => ({
    terminal: config.terminal,
    graphInitialCommits: config.graphInitialCommits,
  }),
  review: review.routes,
  repo: review.repoRoutes,
  hw: { state: runtime.state, resolver: runtime.resolver },
  herdr: { gateway: runtime.gateway, allowedRoots: config.allowedRoots },
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
