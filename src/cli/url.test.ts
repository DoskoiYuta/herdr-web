import { describe, expect, test } from "bun:test";
import { resolveHwUrl } from "./url";

const neverRead = () => Promise.reject(new Error("readFile should not be called"));

describe("resolveHwUrl", () => {
  test("HW_URL set → returns it verbatim, config is never consulted", async () => {
    const url = await resolveHwUrl({ HW_URL: "http://example.com:1234" }, neverRead);
    expect(url).toBe("http://example.com:1234");
  });

  test("HW_URL unset, config has custom port/host → returns that URL", async () => {
    const url = await resolveHwUrl({}, async () => JSON.stringify({ port: 9999, host: "0.0.0.0" }));
    expect(url).toBe("http://0.0.0.0:9999");
  });

  test("HW_URL unset, config file missing (readFile throws) → returns default URL", async () => {
    const url = await resolveHwUrl({}, () => Promise.reject(new Error("ENOENT")));
    expect(url).toBe("http://127.0.0.1:8080");
  });

  test("HW_URL unset, config file has invalid JSON → returns default URL", async () => {
    const url = await resolveHwUrl({}, async () => "not json{{{");
    expect(url).toBe("http://127.0.0.1:8080");
  });

  test("HW_URL unset, config fails schema validation (port not a number) → returns default URL", async () => {
    const url = await resolveHwUrl({}, async () => JSON.stringify({ port: "not-a-number" }));
    expect(url).toBe("http://127.0.0.1:8080");
  });

  test("HERDR_WEB_CONFIG_DIR set → readFile is called with a path under that dir", async () => {
    let capturedPath: string | undefined;
    const url = await resolveHwUrl({ HERDR_WEB_CONFIG_DIR: "/custom/dir" }, async (path) => {
      capturedPath = path;
      return JSON.stringify({});
    });
    expect(capturedPath).toBe("/custom/dir/config.json");
    expect(url).toBe("http://127.0.0.1:8080");
  });
});
