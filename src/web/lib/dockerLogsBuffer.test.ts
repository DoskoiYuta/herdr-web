import { describe, expect, test } from "vitest";
import { appendLines, type DockerLogLine } from "./dockerLogsBuffer";

function line(text: string): DockerLogLine {
  return { stream: "stdout", text };
}

describe("appendLines", () => {
  test("appends within the limit without dropping anything", () => {
    const buf = appendLines([line("a")], [line("b")], 10);
    expect(buf).toEqual([line("a"), line("b")]);
  });

  test("drops the oldest lines once the total exceeds max", () => {
    const buf = appendLines([line("a"), line("b")], [line("c")], 2);
    expect(buf).toEqual([line("b"), line("c")]);
  });
});
