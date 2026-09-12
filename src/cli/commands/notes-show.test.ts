import { describe, expect, test } from "bun:test";
import type { ClientResult } from "../client";
import type { HwClient } from "../client";
import type { Note } from "../../contract/notes";
import type { CommandDeps } from "./types";
import { EXIT_DOMAIN, EXIT_OK, EXIT_USAGE } from "./types";
import { notesShowCommand } from "./notes-show";

function fakeClient(getNote: HwClient["getNote"]): HwClient {
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
    listNotes: notImplemented,
    getNote,
  } as unknown as HwClient;
}

function fakeDeps(getNote: HwClient["getNote"]): CommandDeps {
  return {
    client: fakeClient(getNote),
    env: {},
    cwd: "/repo",
    readStdin: () => Promise.resolve(""),
  };
}

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    repoKey: "/repo/.git",
    title: "TODO",
    body: "- a",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

describe("notesShowCommand", () => {
  // 無いと壊れる: エージェントがユーザーの書いたノートの本文を読めない
  // （Notes はエージェントからの書き込みが無く、この読み出しだけが窓口）。
  test("prints the note body on success", async () => {
    const getNote = (): Promise<ClientResult<Note>> =>
      Promise.resolve({ ok: true, value: note({ body: "line1\nline2" }) });

    const result = await notesShowCommand(["01ar"], fakeDeps(getNote));

    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.stdout).toContain("line1\nline2");
  });

  // 無いと壊れる: エージェントが本文だけをパイプ等で取り出したいときに、
  // id: / title: / updatedAt: の見出しを自分で剥がす必要が生じる。
  test("prints only the body with --no-metadata", async () => {
    const getNote = (): Promise<ClientResult<Note>> =>
      Promise.resolve({ ok: true, value: note({ body: "line1\nline2" }) });

    const result = await notesShowCommand(["01ar", "--no-metadata"], fakeDeps(getNote));

    expect(result.exitCode).toBe(EXIT_OK);
    expect(result.stdout).toBe("line1\nline2\n");
    expect(result.stdout).not.toContain("id:");
  });

  // 無いと壊れる: --json と --no-metadata を両方渡すと、どちらの出力形式にするか
  // 決まらないまま実装依存の挙動になる。
  test("rejects --no-metadata combined with --json as a usage error", async () => {
    const getNote = (): Promise<ClientResult<Note>> => Promise.resolve({ ok: true, value: note() });

    const result = await notesShowCommand(["01ar", "--no-metadata", "--json"], fakeDeps(getNote));

    expect(result.exitCode).toBe(EXIT_USAGE);
  });

  test("maps a 409 ambiguous-id response to a clear message and exit code 3", async () => {
    const getNote = (): Promise<ClientResult<Note>> =>
      Promise.resolve({
        ok: false,
        error: { kind: "http", status: 409, message: "ambiguous id", type: "ambiguous" },
      });

    const result = await notesShowCommand(["01ar"], fakeDeps(getNote));

    expect(result.exitCode).toBe(EXIT_DOMAIN);
    expect(result.stdout).toContain("ambiguous id");
  });
});
