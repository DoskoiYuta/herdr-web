import { describe, expect, test } from "bun:test";
import type { ClientResult } from "../client";
import type { HwClient } from "../client";
import type { Review } from "../../contract/review";
import type { CommandDeps } from "./types";
import { EXIT_DOMAIN } from "./types";
import { reviewShowCommand } from "./show";

function fakeClient(getReview: HwClient["getReview"]): HwClient {
  const notImplemented = () => {
    throw new Error("not implemented in this fake");
  };
  return {
    health: notImplemented,
    whoami: notImplemented,
    listReviews: notImplemented,
    getReview,
    replyToReview: notImplemented,
    moveRepo: notImplemented,
  } as unknown as HwClient;
}

function fakeDeps(getReview: HwClient["getReview"]): CommandDeps {
  return {
    client: fakeClient(getReview),
    env: {},
    cwd: "/repo",
    readStdin: () => Promise.resolve(""),
  };
}

describe("reviewShowCommand", () => {
  test("maps a 409 ambiguous-id response to a clear message and exit code 3", async () => {
    const getReview = (): Promise<ClientResult<Review>> =>
      Promise.resolve({
        ok: false,
        error: { kind: "http", status: 409, message: "ambiguous id", type: "ambiguous" },
      });

    const result = await reviewShowCommand(["01ar"], fakeDeps(getReview));

    expect(result.exitCode).toBe(EXIT_DOMAIN);
    expect(result.stdout).toContain("ambiguous id");
  });
});
