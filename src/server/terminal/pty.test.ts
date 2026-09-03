import { describe, expect, test } from "bun:test";
import { spawnHerdr } from "./pty";

function collectUntilExit(term: ReturnType<typeof spawnHerdr>) {
  let output = "";
  const done = new Promise<{ exitCode: number }>((resolve) => {
    term.onData((data) => {
      output += new TextDecoder().decode(data);
    });
    term.onExit((event) => resolve({ exitCode: event.exitCode }));
  });
  return { getOutput: () => output, done };
}

describe("spawnHerdr", () => {
  test("runs the given bin/argv and streams output", async () => {
    const term = spawnHerdr({
      bin: "/bin/sh",
      argv: ["-c", "echo hi-from-pty"],
      cols: 80,
      rows: 24,
    });
    const { getOutput, done } = collectUntilExit(term);
    await done;
    expect(getOutput()).toContain("hi-from-pty");
  });

  test("resize is reflected in the pty size", async () => {
    const term = spawnHerdr({
      bin: "/bin/sh",
      argv: ["-c", "read -r _line; stty size"],
      cols: 80,
      rows: 24,
    });
    const { getOutput, done } = collectUntilExit(term);
    term.resize(100, 40);
    term.write("go\n");
    await done;
    expect(getOutput()).toContain("40 100");
  });

  test("strips HERDR_ env vars while keeping others and forcing TERM", async () => {
    process.env.HERDR_PANE_ID = "should-be-stripped";
    process.env.HERDR_TEST_MARKER = "also-stripped";
    try {
      const term = spawnHerdr({ bin: "/bin/sh", argv: ["-c", "env"], cols: 80, rows: 24 });
      const { getOutput, done } = collectUntilExit(term);
      await done;
      const out = getOutput();
      expect(out).not.toContain("HERDR_PANE_ID");
      expect(out).not.toContain("HERDR_TEST_MARKER");
      expect(out).toContain("TERM=xterm-256color");
    } finally {
      delete process.env.HERDR_PANE_ID;
      delete process.env.HERDR_TEST_MARKER;
    }
  });

  test("does not pass through non-allowlisted env vars", async () => {
    process.env.SOME_RANDOM_SECRET = "x";
    try {
      const term = spawnHerdr({ bin: "/bin/sh", argv: ["-c", "env"], cols: 80, rows: 24 });
      const { getOutput, done } = collectUntilExit(term);
      await done;
      expect(getOutput()).not.toContain("SOME_RANDOM_SECRET");
    } finally {
      delete process.env.SOME_RANDOM_SECRET;
    }
  });

  test("passes through PATH", async () => {
    const term = spawnHerdr({ bin: "/bin/sh", argv: ["-c", "env"], cols: 80, rows: 24 });
    const { getOutput, done } = collectUntilExit(term);
    await done;
    expect(getOutput()).toContain("PATH=");
  });

  test("passes through vars listed in envPassthrough option even if not in the base allowlist", async () => {
    process.env.SOME_RANDOM_SECRET = "should-pass-via-option";
    try {
      const term = spawnHerdr({
        bin: "/bin/sh",
        argv: ["-c", "env"],
        cols: 80,
        rows: 24,
        envPassthrough: ["SOME_RANDOM_SECRET"],
      });
      const { getOutput, done } = collectUntilExit(term);
      await done;
      expect(getOutput()).toContain("SOME_RANDOM_SECRET=should-pass-via-option");
    } finally {
      delete process.env.SOME_RANDOM_SECRET;
    }
  });

  test("kill terminates the process", async () => {
    const term = spawnHerdr({ bin: "/bin/sh", argv: ["-c", "sleep 5"], cols: 80, rows: 24 });
    const exited = new Promise<void>((resolve) => term.onExit(() => resolve()));
    term.kill();
    await exited;
  });
});
