// Sub-repository discovery for the tool pane's repo switcher (plan.md: "Add
// a sub-repository switcher"). Two sources under a worktree `root`:
//
//  - initialized git submodules (`git submodule status --recursive`,
//    excluding the `-` prefix = uninitialized ones) — parsing ported from
//    terminal-git-graph's src/server/submodules.ts.
//  - vcstool のマニフェスト（`<root>/*.repos`）に列挙された clone 済みリポジトリ
//
// Everything is realpath'd and checked to stay within `root` so a symlink
// (in either source) can't be used to smuggle an arbitrary path past the
// route's allowed-roots check.

import { readdir, realpath as realpathAsync } from "node:fs/promises";
import { join, sep } from "node:path";
import { runGit } from "./run";
import { listWorktrees, type WorktreeEntry } from "./worktrees";

export type SubRepoKind = "root" | "submodule" | "vcs";

export interface SubRepo {
  /** Path relative to `root`, using `/` separators; `""` for the root itself. */
  id: string;
  name: string;
  /** Absolute, realpath'd. */
  root: string;
  kind: SubRepoKind;
  /** All worktrees of this (sub-)repository; for the root entry, the top repository's. */
  worktrees: WorktreeEntry[];
}

const STATUS_LINE_RE = /^([ +\-U])([0-9a-f]{40,64}) (\S+)(?: \((.+)\))?$/;

async function listInitializedSubmodulePaths(root: string): Promise<string[]> {
  const { stdout } = await runGit(["submodule", "status", "--recursive"], { cwd: root });
  const paths: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.length === 0) continue;
    const match = STATUS_LINE_RE.exec(line);
    if (!match) continue;
    const [, marker, , path] = match;
    if (marker === "-") continue; // uninitialized — nothing checked out to read
    if (path) paths.push(path);
  }
  return paths;
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

async function isWorktreeRoot(dir: string): Promise<boolean> {
  try {
    const { stdout } = await runGit(["rev-parse", "--show-toplevel"], { cwd: dir, okCodes: [0] });
    const toplevel = await realpathAsync(stdout.trim());
    const real = await realpathAsync(dir);
    return toplevel === real;
  } catch {
    return false;
  }
}

/**
 * vcstool のマニフェスト（`<root>/*.repos`, YAML: `repositories: { <path>: { type, url, version } }`）に
 * 列挙されたパスのうち、実際に git worktree として存在するものを返す。
 */
async function listVcstoolRepoPaths(root: string): Promise<string[]> {
  let files: string[];
  try {
    files = (await readdir(root)).filter((f) => f.endsWith(".repos")).sort();
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const file of files) {
    let doc: unknown;
    try {
      doc = Bun.YAML.parse(await Bun.file(join(root, file)).text());
    } catch {
      continue;
    }
    const repos = (doc as { repositories?: unknown } | null)?.repositories;
    if (!repos || typeof repos !== "object") continue;
    for (const rel of Object.keys(repos as Record<string, unknown>).sort()) {
      if (rel.includes("\0") || rel.startsWith("/") || rel.split("/").includes("..")) continue;
      if (await isWorktreeRoot(join(root, rel))) out.push(rel);
    }
  }
  return out;
}

interface CacheEntry {
  at: number;
  promise: Promise<SubRepo[]>;
}

const TTL_MS = 5000;
const cache = new Map<string, CacheEntry>();

async function worktreesOf(root: string): Promise<WorktreeEntry[]> {
  return listWorktrees(root).catch(() => []);
}

async function computeSubRepos(root: string): Promise<SubRepo[]> {
  const rootReal = await realpathAsync(root);
  const result: SubRepo[] = [
    {
      id: "",
      name: basename(rootReal),
      root: rootReal,
      kind: "root",
      worktrees: await worktreesOf(rootReal),
    },
  ];

  const [submodulePaths, vcsPaths] = await Promise.all([
    listInitializedSubmodulePaths(root).catch(() => []),
    listVcstoolRepoPaths(root),
  ]);

  const seen = new Set<string>([""]);

  const withinRoot = (real: string): boolean =>
    real === rootReal || real.startsWith(rootReal + sep);

  for (const path of submodulePaths) {
    if (seen.has(path)) continue;
    let real: string;
    try {
      real = await realpathAsync(join(root, path));
    } catch {
      continue; // index entry present but nothing checked out on disk
    }
    if (!withinRoot(real)) continue; // symlink escaped root
    seen.add(path);
    result.push({
      id: path,
      name: basename(path),
      root: real,
      kind: "submodule",
      worktrees: await worktreesOf(real),
    });
  }

  for (const path of vcsPaths) {
    if (seen.has(path)) continue;
    let real: string;
    try {
      real = await realpathAsync(join(root, path));
    } catch {
      continue;
    }
    if (!withinRoot(real)) continue;
    seen.add(path);
    result.push({
      id: path,
      name: path,
      root: real,
      kind: "vcs",
      worktrees: await worktreesOf(real),
    });
  }

  return result;
}

/** Lists `root` plus its initialized submodules and vcstool `*.repos` entries. Cached per `root` for `TTL_MS`. */
export function listSubRepos(root: string): Promise<SubRepo[]> {
  const cached = cache.get(root);
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.promise;

  const promise = computeSubRepos(root);
  cache.set(root, { at: now, promise });
  // Don't let a rejected result poison the cache for subsequent callers.
  promise.catch(() => cache.delete(root));
  return promise;
}

/** Drops every cached entry (test-only escape hatch). */
export function invalidateSubReposCache(): void {
  cache.clear();
}
