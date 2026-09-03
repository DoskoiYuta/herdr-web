import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { invalidateSubReposCache, listSubRepos } from "./subrepos";

const exec = promisify(execFile);
const dirs: string[] = [];
afterEach(async () => {
  invalidateSubReposCache();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function gitInit(dir: string) {
  await mkdir(dir, { recursive: true });
  await exec("git", ["init", "-q"], { cwd: dir });
}

describe("listSubRepos with a vcstool manifest", () => {
  test("lists repositories from *.repos that exist as git worktrees", async () => {
    const root = await mkdtemp(join(tmpdir(), "hw-vcs-"));
    dirs.push(root);
    await gitInit(root);
    await gitInit(join(root, "mozer_classroom"));
    await gitInit(join(root, "libs", "mozer-components"));
    await writeFile(
      join(root, "workspace.repos"),
      [
        "repositories:",
        "  mozer_classroom:",
        "    type: git",
        "    url: git@example.com:x/mozer_classroom.git",
        "    version: develop",
        "  libs/mozer-components:",
        "    type: git",
        "    url: git@example.com:x/mozer-components.git",
        "    version: main",
        "  not_cloned_yet:",
        "    type: git",
        "    url: git@example.com:x/nope.git",
        "    version: main",
        "",
      ].join("\n"),
    );
    const repos = await listSubRepos(root);
    const vcs = repos.filter((r) => r.kind === "vcs").map((r) => r.id);
    expect(vcs).toEqual(["libs/mozer-components", "mozer_classroom"]);
    expect(repos[0]?.kind).toBe("root");
  });
});
