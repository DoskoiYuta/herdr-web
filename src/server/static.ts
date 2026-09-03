import { extname } from "node:path";
import type { Context } from "hono";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * 埋め込み静的ファイルの配信。`assets` は URL パス → 実ファイルパス（`bun build --compile` では `/$bunfs/...`）。
 * SPA なので未知のパスは index.html を返す。
 */
export function serveEmbedded(assets: Record<string, string>) {
  return async (c: Context) => {
    const url = new URL(c.req.url);
    const key = assets[url.pathname] ? url.pathname : "/index.html";
    const path = assets[key];
    if (!path) return c.notFound();
    const file = Bun.file(path);
    if (!(await file.exists())) return c.notFound();
    const type = TYPES[extname(key)] ?? "application/octet-stream";
    const immutable = key.startsWith("/assets/");
    return new Response(file, {
      headers: {
        "content-type": type,
        "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      },
    });
  };
}
