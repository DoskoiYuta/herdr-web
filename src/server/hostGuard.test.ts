import { describe, expect, test } from "bun:test";
import { buildAllowedHosts, isAllowedHost, isAllowedRequest } from "./hostGuard";

const allowed = new Set(["localhost", "127.0.0.1", "::1"]);

describe("isAllowedHost", () => {
  test.each([
    ["127.0.0.1:8080", true],
    ["127.0.0.1", true],
    ["localhost:8080", true],
    ["localhost", true],
    ["[::1]:8080", true],
    ["[::1]", true],
    ["evil.example", false],
    ["evil.example:8080", false],
    ["LOCALHOST:8080", true],
    [undefined, false],
    ["", false],
    ["[::1", false],
    [":::", false],
  ])("Host %p -> %p", (host, expected) => {
    expect(isAllowedHost(host, allowed)).toBe(expected);
  });
});

describe("isAllowedRequest", () => {
  test("Origin ホストが Host と別の許可されていない値なら拒否する", () => {
    expect(
      isAllowedRequest({ host: "127.0.0.1:8080", origin: "http://evil.example" }, allowed),
    ).toBe(false);
  });

  test("Origin ホストが許可集合に含まれれば通す", () => {
    expect(
      isAllowedRequest({ host: "127.0.0.1:8080", origin: "http://localhost:8080" }, allowed),
    ).toBe(true);
  });

  test("null オリジンは拒否する", () => {
    expect(isAllowedRequest({ host: "127.0.0.1:8080", origin: "null" }, allowed)).toBe(false);
  });

  test("Origin が無ければ Host だけで判定する", () => {
    expect(isAllowedRequest({ host: "127.0.0.1:8080" }, allowed)).toBe(true);
  });

  test("Host が許可されていなければ Origin の有無に関わらず拒否する", () => {
    expect(isAllowedRequest({ host: "evil.example" }, allowed)).toBe(false);
  });
});

describe("buildAllowedHosts", () => {
  test("既定の loopback 名に加え config.host と config.allowedHosts を含む", () => {
    const set = buildAllowedHosts({ host: "127.0.0.1", allowedHosts: ["my-mac.tailnet.ts.net"] });
    expect(set.has("localhost")).toBe(true);
    expect(set.has("127.0.0.1")).toBe(true);
    expect(set.has("::1")).toBe(true);
    expect(set.has("my-mac.tailnet.ts.net")).toBe(true);
  });

  test.each(["0.0.0.0", "::"])(
    "any アドレス %p は config.host として渡っても集合に加えない",
    (anyHost) => {
      const set = buildAllowedHosts({ host: anyHost, allowedHosts: [] });
      expect(set.has(anyHost)).toBe(false);
    },
  );
});
