import { describe, expect, test } from "bun:test";
import { buildProcessList, parseEtime, parseListenAddr, parsePsOutput } from "./parse";

const ROOT = "/home/u/herdr-web";

describe("parseEtime", () => {
  test.each([
    ["mm:ss", "05:30", 5 * 60 + 30],
    ["hh:mm:ss", "01:02:03", 1 * 3600 + 2 * 60 + 3],
    ["dd-hh:mm:ss", "2-01:02:03", 2 * 86400 + 1 * 3600 + 2 * 60 + 3],
  ])("%s -> seconds", (_label, raw, expected) => {
    expect(parseEtime(raw)).toBe(expected);
  });
});

describe("parseListenAddr", () => {
  test.each([
    ["wildcard IPv4", "*:8080", { port: 8080, addr: "*" }],
    ["bound IPv4", "127.0.0.1:8090", { port: 8090, addr: "127.0.0.1" }],
    ["bracketed IPv6", "[::1]:8090", { port: 8090, addr: "::1" }],
  ])("%s", (_label, raw, expected) => {
    expect(parseListenAddr(raw)).toEqual(expected);
  });

  test("a name with no port suffix is not a listen address", () => {
    expect(parseListenAddr("no-port-here")).toBeNull();
  });
});

describe("parsePsOutput", () => {
  test("splits fixed columns and keeps a multi-word command intact as the last field", () => {
    const stdout = "  123    1  0.5  4096 01:02:03 node dist/server.js --port 3000\n";
    expect(parsePsOutput(stdout)).toEqual([
      {
        pid: 123,
        ppid: 1,
        cpu: 0.5,
        rss: 4096,
        elapsedSec: 3723,
        command: "node dist/server.js --port 3000",
        argv0: "node",
      },
    ]);
  });

  test("strips a login-shell leading '-' from argv0", () => {
    const stdout = "  1    0  0.0  1024 10:00 -zsh\n";
    expect(parsePsOutput(stdout)[0]?.argv0).toBe("zsh");
  });
});

describe("buildProcessList", () => {
  test("joins ps/lsof-cwd/lsof-listen by pid, keeping only processes whose cwd is under root", () => {
    const psStdout = [
      "  100    1  1.0  2048 00:01:00 node server.js",
      "  200    1  0.0  1024 00:02:00 sleep 100",
    ].join("\n");
    const lsofCwd = [`p100`, `n${ROOT}`, `p200`, `n/home/u/other-repo`].join("\n");
    const lsofListen = [`p100`, `n*:3000`, `n127.0.0.1:9229`].join("\n");

    const result = buildProcessList(psStdout, lsofCwd, lsofListen, [ROOT]);

    expect(result).toEqual([
      {
        pid: 100,
        ppid: 1,
        command: "node server.js",
        argv0: "node",
        cpu: 1.0,
        rss: 2048,
        elapsedSec: 60,
        cwd: ROOT,
        listen: [
          { port: 3000, addr: "*" },
          { port: 9229, addr: "127.0.0.1" },
        ],
      },
    ]);
  });

  test("a process with no cwd lsof entry (e.g. gone by the time lsof ran) is dropped, not guessed at", () => {
    const psStdout = "  300    1  0.0  512 00:00:10 orphan\n";
    expect(buildProcessList(psStdout, "", "", [ROOT])).toEqual([]);
  });

  test("a dual-stack listener reported twice by lsof (IPv4 + IPv6, same addr:port) collapses to one entry", () => {
    const psStdout = "  100    1  0.0  1024 00:00:10 bun dev\n";
    const lsofCwd = `p100\nn${ROOT}`;
    const lsofListen = "p100\nn*:5173\nn*:5173";

    expect(buildProcessList(psStdout, lsofCwd, lsofListen, [ROOT])[0]?.listen).toEqual([
      { port: 5173, addr: "*" },
    ]);
  });
});
