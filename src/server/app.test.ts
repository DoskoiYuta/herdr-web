import { describe, expect, test } from "bun:test";
import { createTestApp } from "./testing/app-deps";

describe("host guard middleware", () => {
  test.each(["127.0.0.1:8080", "localhost", "[::1]:8080", "my-tailnet-host"])(
    "許可された Host %s は通す",
    async (host) => {
      const { app } = createTestApp({ allowedHosts: ["my-tailnet-host"] });
      const res = await app.request("/api/health", { headers: { host } });
      expect(res.status).toBe(200);
    },
  );

  test("許可されていない Host は 403 forbidden-host を返す", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/health", { headers: { host: "evil.example" } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden-host" });
  });

  test("Host は許可されていても Origin が許可されていなければ 403 になる", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/health", {
      headers: { host: "127.0.0.1:8080", origin: "http://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  test("Host と Origin がどちらも許可されていれば通す", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/health", {
      headers: { host: "127.0.0.1:8080", origin: "http://127.0.0.1:8080" },
    });
    expect(res.status).toBe(200);
  });
});
