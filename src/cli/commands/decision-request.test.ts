import { describe, expect, test } from "bun:test";
import type { CreateDecisionRequest } from "../../contract/decision";
import type { ClientResult, HwClient } from "../client";
import { decisionRequestCommand } from "./decision-request";
import type { CommandDeps } from "./types";
import { EXIT_OK, EXIT_USAGE } from "./types";

function fakeClient(createDecision: HwClient["createDecision"]): HwClient {
  const notImplemented = () => {
    throw new Error("not implemented in this fake");
  };
  return {
    health: notImplemented,
    whoami: notImplemented,
    listReviews: notImplemented,
    getReview: notImplemented,
    replyToReview: notImplemented,
    moveRepo: notImplemented,
    listAsks: notImplemented,
    getAsk: notImplemented,
    replyToAsk: notImplemented,
    createDecision,
  } as unknown as HwClient;
}

const validSpec = {
  items: [{ id: "q1", header: "h", question: "q?", kind: "single" }],
};

describe("decisionRequestCommand", () => {
  // 無いと壊れる: サーバーに送る前に弾くべき壊れた spec が素通りし、DB に
  // 不正な依頼が作られてしまう。
  test("rejects an invalid spec before calling the server, reporting the JSON path on stderr", async () => {
    const calls: CreateDecisionRequest[] = [];
    const deps: CommandDeps = {
      client: fakeClient((req) => {
        calls.push(req);
        return Promise.resolve({
          ok: true,
          value: { id: "x", url: "http://x", paneResolved: true },
        });
      }),
      env: {},
      cwd: "/repo",
      readStdin: () => Promise.resolve(JSON.stringify({ items: [] })),
    };

    const result = await decisionRequestCommand([], deps);

    expect(result.exitCode).toBe(EXIT_USAGE);
    expect(result.stderr).toContain("items");
    expect(calls).toEqual([]);
  });

  // 無いと壊れる: 呼び出し元の pane が `--pane`/`HERDR_PANE_ID` のどちらからも
  // 拾えず、サーバー側で呼び出し元 worktree を解決できない。
  test("passes --pane, or HERDR_PANE_ID as a fallback, to the server", async () => {
    const calls: CreateDecisionRequest[] = [];
    const createDecision = (
      req: CreateDecisionRequest,
    ): Promise<ClientResult<{ id: string; url: string; paneResolved: boolean }>> => {
      calls.push(req);
      return Promise.resolve({
        ok: true,
        value: { id: "abc", url: "http://x/#decision/abc", paneResolved: true },
      });
    };

    const viaFlag: CommandDeps = {
      client: fakeClient(createDecision),
      env: { HERDR_PANE_ID: "pane-env" },
      cwd: "/repo",
      readStdin: () => Promise.resolve(JSON.stringify(validSpec)),
    };
    const result = await decisionRequestCommand(["--pane", "pane-flag"], viaFlag);
    expect(result.exitCode).toBe(EXIT_OK);
    expect(JSON.parse(result.stdout)).toEqual({
      id: "abc",
      url: "http://x/#decision/abc",
      paneResolved: true,
    });
    expect(result.stderr).toBeUndefined();
    expect(calls[0]?.paneId).toBe("pane-flag");

    const viaEnv: CommandDeps = {
      client: fakeClient(createDecision),
      env: { HERDR_PANE_ID: "pane-env" },
      cwd: "/repo",
      readStdin: () => Promise.resolve(JSON.stringify(validSpec)),
    };
    await decisionRequestCommand([], viaEnv);
    expect(calls[1]?.paneId).toBe("pane-env");
  });

  // 無いと壊れる (F13-3): pane が特定できない依頼が、stdout の JSON だけ見て
  // 「自動で届く」と誤解される — 呼び出し元がフォールバックを知る手段が無い。
  test("warns on stderr (without failing) when the caller pane cannot be resolved", async () => {
    const deps: CommandDeps = {
      client: fakeClient(() =>
        Promise.resolve({
          ok: true,
          value: { id: "abc", url: "http://x/#decision/abc", paneResolved: false },
        }),
      ),
      env: {},
      cwd: "/repo",
      readStdin: () => Promise.resolve(JSON.stringify(validSpec)),
    };

    const result = await decisionRequestCommand([], deps);

    expect(result.exitCode).toBe(EXIT_OK);
    expect(JSON.parse(result.stdout).id).toBe("abc");
    expect(result.stderr).toContain("hw decision show abc");
  });
});
