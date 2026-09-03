import { Hono } from "hono";
import type { Health } from "../contract/health";

export type AppDeps = {
  version: string;
  herdrStatus: () => { connected: boolean; protocol: number | null };
};

export function createApp(deps: AppDeps) {
  const app = new Hono().get("/api/health", (c) => {
    const body: Health = { ok: true, version: deps.version, herdr: deps.herdrStatus() };
    return c.json(body);
  });
  return app;
}

export type AppType = ReturnType<typeof createApp>;
