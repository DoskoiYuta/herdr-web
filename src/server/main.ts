import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApp } from "./app";

const isProd = process.env.NODE_ENV === "production";
const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 8080);
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

const api = createApp({
  version: "0.1.0",
  herdrStatus: () => ({ connected: false, protocol: null }),
});

const app = new Hono().route("/", api);

if (isProd) {
  app.use("/*", serveStatic({ root: "dist/web" }));
  app.get("*", serveStatic({ path: "dist/web/index.html" }));
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

server.listen(port, host, () => {
  console.log(`herdr-web listening on http://${host}:${port} (${isProd ? "prod" : "dev"})`);
});
