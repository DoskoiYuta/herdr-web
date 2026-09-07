import { useState } from "react";
import type { Ask } from "@contract/ask";
import type { WorkspaceGroup } from "@/lib/repoWorkspaces";
import { cn } from "@/lib/utils";
import { askApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AgentStatusDot } from "@/components/ui/status/AgentStatusDot";
import { KindIcon } from "@/components/ui/status/KindIcon";

export type AskFileLocation = { worktreeRoot: string; path: string; line: number };

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/** 「質問 · <agent> · <path 末尾>」。対応する ask が見つからなければ
 * workspace のラベル（`ask:<短縮 id>`）のまま出す。 */
function askRowLabel(ask: Ask | undefined): string | null {
  if (!ask) return null;
  const agent = ask.session?.kind === "herdr" ? (ask.session.agent ?? "不明") : "不明";
  return `質問 · ${agent} · ${basename(ask.path)}`;
}

export type AskSessionRowProps = {
  workspace: WorkspaceGroup;
  /** この行のラベルに一致する ask（見つからなければ undefined — 右クリック
   * メニューは無効化してその旨を出す）。マッチングは呼び出し側の責務。 */
  ask: Ask | undefined;
  focusedPaneId: string | null;
  onSelectPane: (paneId: string) => void;
  /** 「対象ファイルを開く」: ツールペインの Files タブへ該当ファイル/行を開く。 */
  onOpenAskFile: (location: AskFileLocation) => void;
  /** 解決に成功した後、呼び出し側が ask 一覧を再取得できるようにする。 */
  onResolved: () => void;
};

/**
 * ui-redesign.md §5.2: 質問セッション行。Workspace 行と同じ段に、質問アイコン
 * 付きで並べる（別グループの折りたたみ枠は持たない）。右クリックで「対象
 * ファイルを開く」と「解決」を出す。
 */
export function AskSessionRow({
  workspace,
  ask,
  focusedPaneId,
  onSelectPane,
  onOpenAskFile,
  onResolved,
}: AskSessionRowProps) {
  const pane = workspace.panes[0];
  const focused = pane !== undefined && pane.paneId === focusedPaneId;

  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolveSubmitting, setResolveSubmitting] = useState(false);

  async function handleResolveConfirm() {
    if (!ask) return;
    setResolveSubmitting(true);
    setResolveError(null);
    try {
      await askApi.resolve(ask.id);
      onResolved();
      setResolveOpen(false);
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : "解決に失敗しました");
    } finally {
      setResolveSubmitting(false);
    }
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={() => pane && onSelectPane(pane.paneId)}
            disabled={!pane}
            aria-current={focused ? "true" : undefined}
            title="フォーカスを移す（ターミナルも切り替わります）"
            data-testid={`ask-session-row-${workspace.workspaceId}`}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-muted",
              focused && "bg-sidebar-accent font-medium",
            )}
          >
            <KindIcon kind="ask" />
            <span className="min-w-0 flex-1 truncate">
              {askRowLabel(ask) ?? workspace.workspaceLabel}
            </span>
            {pane && <AgentStatusDot status={pane.agentStatus} />}
            {focused && (
              <span
                data-testid="focus-dot"
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-focus"
              />
            )}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {ask ? (
            <>
              <ContextMenuItem
                onSelect={() =>
                  onOpenAskFile({
                    worktreeRoot: ask.worktreeRoot,
                    path: ask.path,
                    line: ask.anchor.lineHint,
                  })
                }
              >
                対象ファイルを開く
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => setResolveOpen(true)}>解決</ContextMenuItem>
            </>
          ) : (
            <>
              <ContextMenuItem disabled>対象ファイルを開く</ContextMenuItem>
              <ContextMenuItem disabled>解決</ContextMenuItem>
              <ContextMenuLabel className="font-normal text-muted-foreground">
                対応する質問が見つかりません
              </ContextMenuLabel>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>質問を解決してセッションを閉じます</DialogTitle>
            <DialogDescription>{ask?.path}</DialogDescription>
          </DialogHeader>
          {resolveError && <p className="text-xs text-destructive">{resolveError}</p>}
          <DialogFooter>
            <Button type="button" onClick={handleResolveConfirm} disabled={resolveSubmitting}>
              解決
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
