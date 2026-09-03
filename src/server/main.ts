import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { createApp } from "./app";
import { serveEmbedded } from "./static";
import type { WebAssets } from "./web-assets";
import { attachReviewToRuntime, createRuntime } from "./bootstrap";
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

const runtime = createRuntime({ config });

const dbPath = resolveDbPath(config);
await mkdir(dirname(dbPath), { recursive: true });
const review = createReviewRuntime({
  config,
  db: openReviewDb(dbPath),
  herdr: { state: runtime.state, gateway: runtime.gateway, resolver: runtime.resolver },
  onEvent: (e) => runtime.hub.broadcast(e),
});
attachReviewToRuntime(runtime, review);

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
      }),
  }),
);
upgradeRouter.add("/ws/events", runtime.eventsWss);

server.listen(config.port, config.host, () => {
  console.log(
    `herdr-web listening on http://${config.host}:${config.port} (${isProd ? "prod" : "dev"})`,
  );
});

function shutdown() {
  runtime.stop();
  server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
