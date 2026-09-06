import { describe, expect, test } from "bun:test";
import type { CommandDeps } from "./types";
import { EXIT_OK } from "./types";
import { decisionSchemaCommand } from "./decision-schema";

describe("decisionSchemaCommand", () => {
  // 無いと壊れる: `hw decision schema` がサーバーに接続できない環境
  // （事前検証のためにこそ必要な場面）で使えなくなる。
  test("prints the spec JSON Schema without needing the server", async () => {
    const deps = {
      client: undefined,
      env: {},
      cwd: "/repo",
      readStdin: () => Promise.resolve(""),
    } as unknown as CommandDeps;
    const result = await decisionSchemaCommand([], deps);
    expect(result.exitCode).toBe(EXIT_OK);
    expect(JSON.parse(result.stdout).type).toBe("object");
  });
});
