import { describe, expect, test } from "bun:test";
import { spawnDockerLogs } from "./logsSpawn";

describe("spawnDockerLogs", () => {
  test("streams stdout/stderr and reports the exit code", async () => {
    const proc = spawnDockerLogs({
      id: "unused",
      tail: 200,
      bin: "/bin/sh",
      argv: ["-c", "echo out-line; echo err-line 1>&2; exit 3"],
    });
    let out = "";
    let err = "";
    proc.onStdout((chunk) => {
      out += chunk.toString();
    });
    proc.onStderr((chunk) => {
      err += chunk.toString();
    });
    const exit = new Promise<{ code: number | null }>((resolve) => proc.onExit(resolve));

    const event = await exit;

    expect(out).toContain("out-line");
    expect(err).toContain("err-line");
    expect(event.code).toBe(3);
  });

  test("kill terminates the process", async () => {
    const proc = spawnDockerLogs({
      id: "unused",
      tail: 200,
      bin: "/bin/sh",
      argv: ["-c", "sleep 5"],
    });
    const exited = new Promise<void>((resolve) => proc.onExit(() => resolve()));

    proc.kill();

    await exited;
  });

  test("a missing binary reports onError rather than hanging", async () => {
    const proc = spawnDockerLogs({ id: "unused", tail: 200, bin: "/no/such/binary-xyz" });
    const errored = new Promise<NodeJS.ErrnoException>((resolve) => proc.onError(resolve));

    const err = await errored;

    expect(err.code).toBe("ENOENT");
  });
});
