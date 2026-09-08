import type { Repo } from "@contract/events";
import { repoDisplayNames } from "./repoDisplay";

export type InboxLocation = {
  repoName: string;
  /** main worktree は常に "main"（実ブランチ名ではなく）。 */
  branchLabel: string;
  isMain: boolean;
};

export type WorktreeOption = InboxLocation & { root: string };

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

function branchLabelFor(worktree: {
  branch: string | null;
  isMain: boolean;
  root: string;
}): string {
  if (worktree.isMain) return "main";
  return worktree.branch ?? basename(worktree.root);
}

/**
 * `repoKey` があればそのリポジトリだけを、無ければ（blocked セクションの行）
 * 全リポジトリを `worktreeRoot` で探す。tree に無い worktree（閉じた worktree
 * 等）は null — 呼び出し側が basename(worktreeRoot) にフォールバックする。
 */
export function inboxLocationFor(
  repos: Repo[],
  repoKey: string | null,
  worktreeRoot: string | null,
): InboxLocation | null {
  if (!worktreeRoot) return null;
  const candidates = repoKey ? repos.filter((r) => r.key === repoKey) : repos;
  const names = repoDisplayNames(repos);
  for (const repo of candidates) {
    const worktree = repo.worktrees.find((w) => w.root === worktreeRoot);
    if (worktree) {
      return {
        repoName: names.get(repo.key) ?? repo.name,
        branchLabel: branchLabelFor(worktree),
        isMain: worktree.isMain,
      };
    }
  }
  return null;
}

/** Inbox ヘッダーの worktree 絞り込み Select 用。並びはリポジトリ名 → main を
 * 先頭 → ブランチ名（`repoDisplayNames` と同じ衝突回避を使う）。 */
export function worktreeOptions(repos: Repo[]): WorktreeOption[] {
  const names = repoDisplayNames(repos);
  const sortedRepos = [...repos].sort((a, b) =>
    (names.get(a.key) ?? a.name).localeCompare(names.get(b.key) ?? b.name),
  );

  const seenRoots = new Set<string>();
  const options: WorktreeOption[] = [];
  for (const repo of sortedRepos) {
    const repoName = names.get(repo.key) ?? repo.name;
    const worktrees = [...repo.worktrees].sort((a, b) => {
      if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
      return (a.branch ?? "").localeCompare(b.branch ?? "");
    });
    for (const worktree of worktrees) {
      // 同じ worktree root が一時的に複数 repo に現れうる（repo の再割り当て中
      // 等）— Select の key/value は root 単位で一意でなければならない。
      if (seenRoots.has(worktree.root)) continue;
      seenRoots.add(worktree.root);
      options.push({
        root: worktree.root,
        repoName,
        branchLabel: branchLabelFor(worktree),
        isMain: worktree.isMain,
      });
    }
  }
  return options;
}
