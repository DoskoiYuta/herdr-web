import type { Repo } from "@contract/events";

/** repo.key is `git rev-parse --git-common-dir` (`<repo>/.git`), or the "other" sentinel. */
function parentDirName(commonDir: string): string | null {
  const withoutGit = commonDir.endsWith("/.git") ? commonDir.slice(0, -"/.git".length) : commonDir;
  const parts = withoutGit.split("/").filter(Boolean);
  return parts.length >= 2 ? (parts[parts.length - 2] ?? null) : null;
}

/**
 * `repo.name` is just a basename, so two unrelated repos checked out under
 * different parents (`~/work/foo` and `~/side/foo`) get the same name. Append
 * the parent directory to disambiguate whenever a basename repeats.
 */
export function repoDisplayNames(repos: Repo[]): Map<string, string> {
  const byName = new Map<string, Repo[]>();
  for (const repo of repos) {
    const list = byName.get(repo.name) ?? [];
    list.push(repo);
    byName.set(repo.name, list);
  }

  const result = new Map<string, string>();
  for (const [name, group] of byName) {
    if (group.length === 1) {
      result.set(group[0]!.key, name);
      continue;
    }
    for (const repo of group) {
      const parent = parentDirName(repo.key);
      result.set(repo.key, parent ? `${parent}/${name}` : name);
    }
  }
  return result;
}
