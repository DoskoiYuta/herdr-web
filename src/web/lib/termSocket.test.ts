import { describe, expect, test } from "vitest";
import {
  buildTermSocketUrl,
  decodeServerFrame,
  encodeInput,
  encodeResizeMessage,
} from "./termSocket";

describe("buildTermSocketUrl", () => {
  test("builds a ws: url from http location with session/cols/rows", () => {
    const url = buildTermSocketUrl(
      { protocol: "http:", host: "localhost:8080" },
      { session: "default", cols: 80, rows: 24 },
    );
    expect(url).toBe("ws://localhost:8080/ws/term?session=default&cols=80&rows=24");
  });

  test("uses wss: for https location", () => {
    const url = buildTermSocketUrl({ protocol: "https:", host: "example.com" }, {});
    expect(url).toBe("wss://example.com/ws/term");
  });

  test("omits absent query params", () => {
    const url = buildTermSocketUrl({ protocol: "http:", host: "localhost:8080" }, { cols: 80 });
    expect(url).toBe("ws://localhost:8080/ws/term?cols=80");
  });
});

describe("encodeResizeMessage / encodeInput", () => {
  test("resize encodes as JSON text", () => {
    expect(encodeResizeMessage(100, 40)).toBe('{"type":"resize","cols":100,"rows":40}');
  });

  test("input encodes as UTF-8 bytes", () => {
    const bytes = encodeInput("hi");
    expect(Array.from(bytes)).toEqual([0x68, 0x69]);
  });
});

describe("decodeServerFrame", () => {
  test("binary data decodes to an output frame", () => {
    const data = new Uint8Array([0x68, 0x69]).buffer;
    const frame = decodeServerFrame(data);
    expect(frame).toEqual({ kind: "output", data: new Uint8Array([0x68, 0x69]) });
  });

  test("a valid exit text frame decodes to an exit frame", () => {
    const frame = decodeServerFrame(JSON.stringify({ type: "exit", code: 0 }));
    expect(frame).toEqual({ kind: "exit", code: 0 });
  });

  test("an invalid text frame is ignored", () => {
    expect(decodeServerFrame("not json")).toBeUndefined();
    expect(decodeServerFrame(JSON.stringify({ type: "nope" }))).toBeUndefined();
  });
});
