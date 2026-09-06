import { describe, expect, test } from "vitest";
import { buildDockerLogsSocketUrl, decodeDockerLogsMessage } from "./dockerLogsSocket";

describe("buildDockerLogsSocketUrl", () => {
  test("builds a ws: url from http location with root/id", () => {
    const url = buildDockerLogsSocketUrl(
      { protocol: "http:", host: "localhost:8080" },
      { root: "/repo", id: "abc123" },
    );
    expect(url).toBe("ws://localhost:8080/ws/docker-logs?root=%2Frepo&id=abc123");
  });

  test("uses wss: for https location", () => {
    const url = buildDockerLogsSocketUrl(
      { protocol: "https:", host: "example.com" },
      { root: "/repo", id: "abc" },
    );
    expect(url).toBe("wss://example.com/ws/docker-logs?root=%2Frepo&id=abc");
  });

  test("includes tail only when given", () => {
    const url = buildDockerLogsSocketUrl(
      { protocol: "http:", host: "localhost:8080" },
      { root: "/repo", id: "abc", tail: 500 },
    );
    expect(url).toBe("ws://localhost:8080/ws/docker-logs?root=%2Frepo&id=abc&tail=500");
  });
});

describe("decodeDockerLogsMessage", () => {
  test("a valid line message decodes", () => {
    const msg = decodeDockerLogsMessage(
      JSON.stringify({ type: "line", stream: "stdout", text: "hello" }),
    );
    expect(msg).toEqual({ type: "line", stream: "stdout", text: "hello" });
  });

  test("a valid exit message decodes", () => {
    const msg = decodeDockerLogsMessage(JSON.stringify({ type: "exit", code: 0 }));
    expect(msg).toEqual({ type: "exit", code: 0 });
  });

  test("a valid error message decodes", () => {
    const msg = decodeDockerLogsMessage(
      JSON.stringify({ type: "error", code: "forbidden", message: "nope" }),
    );
    expect(msg).toEqual({ type: "error", code: "forbidden", message: "nope" });
  });

  test.each([["not json"], [JSON.stringify({ type: "nope" })], [JSON.stringify({ type: "line" })]])(
    "an invalid frame %s is ignored",
    (raw) => {
      expect(decodeDockerLogsMessage(raw)).toBeUndefined();
    },
  );
});
