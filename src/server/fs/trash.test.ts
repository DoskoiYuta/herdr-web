import { describe, expect, test } from "bun:test";
import { createTrasher, type TrashCandidate } from "./trash";

function candidate(name: string, available: boolean): TrashCandidate {
  return {
    name,
    available: () => Promise.resolve(available),
    argv: (real) => [name, real],
  };
}

describe("createTrasher", () => {
  test("runs the first available candidate with its argv", async () => {
    const calls: string[][] = [];
    const trasher = createTrasher({
      candidates: [
        candidate("unavailable", false),
        candidate("chosen", true),
        candidate("later", true),
      ],
      run: (argv) => {
        calls.push(argv);
        return Promise.resolve({ code: 0, stderr: "" });
      },
    });

    const result = await trasher.moveToTrash("/some/path");
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([["chosen", "/some/path"]]);
  });

  test("no available candidate -> no-backend", async () => {
    const trasher = createTrasher({
      candidates: [candidate("a", false), candidate("b", false)],
      run: () => Promise.resolve({ code: 0, stderr: "" }),
    });

    const result = await trasher.moveToTrash("/some/path");
    expect(result).toEqual({ ok: false, reason: "no-backend" });
  });

  test("a non-zero exit -> failed with the first stderr line", async () => {
    const trasher = createTrasher({
      candidates: [candidate("chosen", true)],
      run: () => Promise.resolve({ code: 1, stderr: "boom\nmore detail\n" }),
    });

    const result = await trasher.moveToTrash("/some/path");
    expect(result).toEqual({ ok: false, reason: "failed", message: "boom" });
  });

  test("probes candidates only once across repeated calls", async () => {
    let probes = 0;
    const trasher = createTrasher({
      candidates: [
        {
          name: "chosen",
          available: () => {
            probes += 1;
            return Promise.resolve(true);
          },
          argv: (real) => ["chosen", real],
        },
      ],
      run: () => Promise.resolve({ code: 0, stderr: "" }),
    });

    await trasher.moveToTrash("/a");
    await trasher.moveToTrash("/b");
    expect(probes).toBe(1);
  });
});
