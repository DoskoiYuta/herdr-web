import { describe, expect, test } from "bun:test";
import { lookupContainer } from "./containerLookup";
import type { DockerCache } from "./cache";
import type { DockerRunResult } from "./runner";
import { DockerNotFoundError } from "./runner";

function fakeCache(result: DockerRunResult | Error): DockerCache {
  return {
    get: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
  };
}

// Tab-separated fields expected by parseDockerPsOutput: id, name, state,
// status, image, ports, createdAt, composeProject, composeService,
// composeWorkingDir, devcontainerLocalFolder.
function psLineFor(id: string, workingDir: string): string {
  return [id, "app-1", "running", "Up", "image", "", "c", "proj", "svc", workingDir, ""].join("\t");
}

describe("lookupContainer", () => {
  test("found:true when id is among the containers tied to one of roots", async () => {
    const cache = fakeCache({
      code: 0,
      stdout: psLineFor("abc", "/repo"),
      stderr: "",
      timedOut: false,
    });

    const result = await lookupContainer({ cache, roots: ["/repo"], id: "abc" });

    expect(result).toEqual({ ok: true, found: true });
  });

  test("found:false when id is not among the containers tied to roots", async () => {
    const cache = fakeCache({
      code: 0,
      stdout: psLineFor("abc", "/repo"),
      stderr: "",
      timedOut: false,
    });

    const result = await lookupContainer({ cache, roots: ["/repo"], id: "other" });

    expect(result).toEqual({ ok: true, found: false });
  });

  test.each([
    ["docker missing", new DockerNotFoundError()],
    ["daemon unreachable (non-zero exit)", { code: 1, stdout: "", stderr: "", timedOut: false }],
    ["docker ps timed out", { code: -1, stdout: "", stderr: "", timedOut: true }],
  ])("%s is reported as docker-unavailable rather than found:false", async (_label, result) => {
    const cache = fakeCache(result as DockerRunResult | Error);

    const outcome = await lookupContainer({ cache, roots: ["/repo"], id: "abc" });

    expect(outcome).toEqual({ ok: false, reason: "docker-unavailable" });
  });
});
