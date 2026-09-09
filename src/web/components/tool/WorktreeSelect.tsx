// worktree/サブリポジトリの選択 UI（docs/ui-redesign.md §10.5, design.pen P16）。
// 実際の選択は `PUT /api/herdr/workspace/:id/selection` がサーバーに保存し、
// 描き替えは次の `focus` メッセージで行う（楽観更新はしない）。
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import type { SubRepo, WorktreeEntry } from "@contract/git";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast/ToastProvider";
import { gitApi, herdrApi } from "@/lib/api";

const REPO_KIND_LABEL: Record<SubRepo["kind"], string> = {
  root: "root",
  submodule: "submodule",
  vcs: "vcstool",
};

/** `path` の親ディレクトリ（末尾 `/` は無視）。ルート自身は `"/"`。 */
function dirname(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx <= 0 ? "/" : trimmed.slice(0, idx);
}

/**
 * worktree サブメニューに出すパス表示（design.pen P16）。リポジトリの main
 * worktree root からの相対パスが読みやすいので優先し、それも無理なら
 * 兄弟ディレクトリ（`git worktree add ../foo` の既定レイアウト）を
 * `../<basename>` で示す。どちらでもなければフルパス（呼び出し側で `title`
 * に全文を残し、表示だけ truncate する）。
 */
export function displayWorktreePath(root: string, mainRoot: string): string {
  if (root === mainRoot) return ".";
  const prefix = mainRoot.endsWith("/") ? mainRoot : `${mainRoot}/`;
  if (root.startsWith(prefix)) return root.slice(prefix.length);
  const parentPrefix = (() => {
    const parent = dirname(mainRoot);
    return parent.endsWith("/") ? parent : `${parent}/`;
  })();
  if (root.startsWith(parentPrefix)) return `../${root.slice(parentPrefix.length)}`;
  return root;
}

/** `SubRepo.worktrees` の中の main worktree の root。見つからなければ
 * （キャッシュの読み違い等）そのリポジトリのクエリ root にフォールバックする。 */
function mainWorktreeRootOf(entry: SubRepo): string {
  return entry.worktrees.find((w) => w.isMain)?.root ?? entry.root;
}

export type WorktreeSelectProps = {
  workspaceId: string;
  repoKey: string;
  /** トップリポジトリの選択済み worktree（focus.worktreeRoot）。 */
  worktreeRoot: string;
  /** 現在選択中のサブリポジトリ（focus.subRepo）。 */
  subRepo: { id: string; name: string; root: string } | null;
  repoChangedTick: number;
};

export function WorktreeSelect({
  workspaceId,
  repoKey,
  worktreeRoot,
  subRepo,
  repoChangedTick,
}: WorktreeSelectProps) {
  const toast = useToast();
  const subReposQuery = useQuery({
    queryKey: ["subrepos", worktreeRoot, repoChangedTick],
    queryFn: () => gitApi.subrepos(worktreeRoot),
    // `git worktree add`/`remove` run in a terminal doesn't bump
    // `repoChangedTick` (the poller only watches the *focused* worktree's
    // status/refs/HEAD, not its worktree list) and this query has no other
    // event to react to, so a short staleTime plus a refetch on open
    // (`handleOpenChange` below) is how a newly added worktree shows up
    // without a full page reload.
    staleTime: 5000,
    retry: false,
  });
  // Radix doesn't refetch on its own when the trigger opens (staleTime keeps
  // the cached list until it's actually stale) — force it so a worktree
  // added since the last open shows up immediately.
  const handleOpenChange = (open: boolean) => {
    if (open) void subReposQuery.refetch();
  };
  const entries = subReposQuery.data?.repos ?? [];
  const root = entries.find((r) => r.kind === "root") ?? null;
  const subs = entries.filter((r) => r.kind !== "root");

  async function pickTopWorktree(target: WorktreeEntry) {
    try {
      await herdrApi.setSelection(workspaceId, {
        repoKey,
        worktreeRoot: target.root,
        subRepoId: null,
        subWorktreeRoot: null,
      });
    } catch {
      toast({ kind: "error", message: "worktree の切り替えに失敗しました" });
    }
  }

  async function pickSubRepoWorktree(entry: SubRepo, target: WorktreeEntry) {
    try {
      await herdrApi.setSelection(workspaceId, {
        repoKey,
        worktreeRoot,
        subRepoId: entry.id,
        subWorktreeRoot: target.root === entry.root ? null : target.root,
      });
    } catch {
      toast({ kind: "error", message: "worktree の切り替えに失敗しました" });
    }
  }

  if (!root) return null;

  if (subs.length === 0) {
    const currentBranch = root.worktrees.find((w) => w.root === worktreeRoot)?.branch ?? null;
    if (root.worktrees.length <= 1) {
      return currentBranch ? (
        <Badge variant="secondary" className="shrink-0 rounded-md">
          {currentBranch}
        </Badge>
      ) : null;
    }
    const mainRoot = mainWorktreeRootOf(root);
    return (
      <DropdownMenu onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="worktree を選択"
            className="shrink-0 rounded-md border border-border px-1.5 py-0.5 font-mono text-xs text-foreground hover:bg-muted"
          >
            {currentBranch ?? "(detached)"}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[320px]">
          {root.worktrees.map((w) => (
            <DropdownMenuItem key={w.root} onSelect={() => void pickTopWorktree(w)}>
              <WorktreeRow entry={w} mainRoot={mainRoot} selected={w.root === worktreeRoot} />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const selectedRepoName = subRepo?.name ?? root.name;
  const selectedRepoBranch = subRepo
    ? (subs.find((s) => s.id === subRepo.id)?.worktrees.find((w) => w.root === subRepo.root)
        ?.branch ?? null)
    : (root.worktrees.find((w) => w.root === worktreeRoot)?.branch ?? null);

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="リポジトリ・worktree を選択"
          className="flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-foreground hover:bg-muted"
        >
          <span className="truncate">{selectedRepoName}</span>
          <span className="text-muted-foreground">›</span>
          <span className="font-mono">{selectedRepoBranch ?? "(detached)"}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[280px]">
        <RepoRow
          entry={root}
          selected={subRepo === null}
          currentRoot={worktreeRoot}
          onPickSingle={(w) => void pickTopWorktree(w)}
          onPickWorktree={(w) => void pickTopWorktree(w)}
        />
        {subs.map((entry) => (
          <RepoRow
            key={entry.id}
            entry={entry}
            selected={subRepo?.id === entry.id}
            currentRoot={subRepo?.id === entry.id ? subRepo.root : null}
            onPickSingle={(w) => void pickSubRepoWorktree(entry, w)}
            onPickWorktree={(w) => void pickSubRepoWorktree(entry, w)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** worktree サブメニューの 1 行（design.pen P16）。1 行目にブランチ・main
 * チップ・選択中チェック、2 行目に相対パス（フルパスは `title`）。 */
function WorktreeRow({
  entry,
  mainRoot,
  selected,
}: {
  entry: WorktreeEntry;
  mainRoot: string;
  selected: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 font-mono font-medium">{entry.branch ?? "(detached)"}</span>
        {entry.isMain && (
          <Badge variant="outline" className="shrink-0 rounded-md text-[10px]">
            main
          </Badge>
        )}
        {selected && <Check className="ml-auto size-3.5 shrink-0" />}
      </div>
      <span
        className="min-w-0 truncate font-mono text-[10px] text-muted-foreground"
        title={entry.root}
      >
        {displayWorktreePath(entry.root, mainRoot)}
      </span>
    </div>
  );
}

/** リポジトリ一覧の 1 行。worktree が 1 件なら行クリックで確定、2 件以上なら
 * ホバーで worktree のサブメニューを開く（§10.5）。1 行目に名前（+ サブ
 * メニューを開く行はトリガー自身のシェブロン）、2 行目に種別・worktree 数・
 * （このリポジトリが選択中なら）選択中ブランチ。 */
function RepoRow({
  entry,
  selected,
  currentRoot,
  onPickSingle,
  onPickWorktree,
}: {
  entry: SubRepo;
  selected: boolean;
  /** このリポジトリで現在選択中の worktree root。選択中でなければ null。 */
  currentRoot: string | null;
  onPickSingle: (w: WorktreeEntry) => void;
  onPickWorktree: (w: WorktreeEntry) => void;
}) {
  const selectedBranch = currentRoot
    ? (entry.worktrees.find((w) => w.root === currentRoot)?.branch ?? null)
    : null;
  const detail = [
    REPO_KIND_LABEL[entry.kind],
    `worktree ${entry.worktrees.length}`,
    selectedBranch ? `選択中: ${selectedBranch}` : null,
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");

  const label = (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex min-w-0 items-center gap-1.5">
        {selected ? (
          <Check className="size-3.5 shrink-0" />
        ) : (
          <span className="inline-block size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
      </div>
      <span className="truncate pl-5 text-[10px] text-muted-foreground">{detail}</span>
    </div>
  );

  if (entry.worktrees.length <= 1) {
    const only = entry.worktrees[0];
    return <DropdownMenuItem onSelect={() => only && onPickSingle(only)}>{label}</DropdownMenuItem>;
  }

  const mainRoot = mainWorktreeRootOf(entry);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-[320px]">
        {entry.worktrees.map((w) => (
          <DropdownMenuItem key={w.root} onSelect={() => onPickWorktree(w)}>
            <WorktreeRow entry={w} mainRoot={mainRoot} selected={w.root === currentRoot} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
