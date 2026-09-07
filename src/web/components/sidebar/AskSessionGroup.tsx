import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, MessageCircleQuestion } from "lucide-react";
import { useCallback, useState } from "react";
import type { WorkspaceGroup } from "@/lib/repoWorkspaces";
import { cn } from "@/lib/utils";
import { askApi } from "@/lib/api";
import { useAskEvents } from "@/lib/HerdrStoreContext";
import { askEventMatchesRepo } from "@/lib/askEvent";
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
import { STATUS_META } from "./PaneRow";

const ASK_STATUS_QUERY = "open,replied,outdated";
const ASK_LIST_REFETCH_MS = 30_000;

export type AskFileLocation = { worktreeRoot: string; path: string; line: number };

export type AskSessionGroupProps = {
  workspaces: WorkspaceGroup[];
  /** リポジトリキー（git-common-dir 絶対パス）。`GET /api/ask` の `repo`。 */
  repoKey: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectPane: (paneId: string) => void;
  /** 「対象ファイルを開く」: ツールペインの Files タブへ該当ファイル/行を開く。 */
  onOpenAskFile: (location: AskFileLocation) => void;
};

/**
 * plan.md F10: 「質問」(ask) 用に herdr-web が作った専用ワークスペースは、通常の
 * `repository > workspace` 一覧（`RepoWorkspaceRow`）ではなく、リポジトリ配下の
 * 別の折りたたみグループにまとめる。1 行 = 1 ask ワークスペース（先頭 pane が
 * claude を起動した pane）で、クリックで他行と同様にフォーカスする。ここに出す
 * pane は `sendTargets.agentPanesAt` の送信先候補からは除外されている
 * （質問セッションはレビュー送信の対象ではない）。
 *
 * 右クリックで「対象ファイルを開く」（ask.worktreeRoot/path/anchor.lineHint を
 * ツールペインの Files タブへ）と「解決」（確認ダイアログの上で askApi.resolve）
 * を出す。行 ↔ ask の対応は `ask.session.label`（ワークスペースラベル）で引く —
 * herdr のワークスペース id は詰められて変わるため label 照合しか使えない。
 */
export function AskSessionGroup({
  workspaces,
  repoKey,
  collapsed,
  onToggleCollapse,
  onSelectPane,
  onOpenAskFile,
}: AskSessionGroupProps) {
  const queryClient = useQueryClient();
  const askListQuery = useQuery({
    queryKey: ["ask-list", repoKey],
    queryFn: () => askApi.list({ repo: repoKey, status: ASK_STATUS_QUERY }),
    staleTime: Infinity,
    refetchInterval: ASK_LIST_REFETCH_MS,
  });

  useAskEvents(
    useCallback(
      (event) => {
        if (askEventMatchesRepo(event, repoKey)) {
          void queryClient.invalidateQueries({ queryKey: ["ask-list", repoKey] });
        }
      },
      [repoKey, queryClient],
    ),
  );

  const asks = askListQuery.data ?? [];

  const [resolveTarget, setResolveTarget] = useState<{ id: string; path: string } | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolveSubmitting, setResolveSubmitting] = useState(false);

  async function handleResolveConfirm() {
    if (!resolveTarget) return;
    setResolveSubmitting(true);
    setResolveError(null);
    try {
      await askApi.resolve(resolveTarget.id);
      void queryClient.invalidateQueries({ queryKey: ["ask-list", repoKey] });
      setResolveTarget(null);
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : "解決に失敗しました");
    } finally {
      setResolveSubmitting(false);
    }
  }

  if (workspaces.length === 0) return null;

  return (
    <div>
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        data-testid="ask-session-group-header"
        className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-xs font-semibold text-muted-foreground hover:bg-muted"
      >
        <ChevronRight
          className={cn("size-3.5 shrink-0 transition-transform", !collapsed && "rotate-90")}
        />
        <MessageCircleQuestion className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">質問セッション</span>
      </button>
      {!collapsed && (
        <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-2">
          {workspaces.map((workspace) => {
            const pane = workspace.panes[0];
            const meta = STATUS_META[pane?.agentStatus ?? "unknown"];
            const StatusIcon = meta.icon;
            const ask = asks.find(
              (a) => a.session?.kind === "herdr" && a.session.label === workspace.workspaceLabel,
            );

            return (
              <ContextMenu key={workspace.workspaceId}>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={() => pane && onSelectPane(pane.paneId)}
                    disabled={!pane}
                    aria-current={pane?.focused ? "true" : undefined}
                    data-testid={`ask-session-row-${workspace.workspaceId}`}
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-muted",
                      pane?.focused && "bg-muted font-medium",
                    )}
                  >
                    <StatusIcon
                      className={cn(
                        "size-3.5 shrink-0",
                        meta.className,
                        meta.spin && "animate-spin",
                      )}
                      aria-label={`状態: ${meta.label}`}
                    />
                    <span className="min-w-0 flex-1 truncate">{workspace.workspaceLabel}</span>
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
                      <ContextMenuItem
                        onSelect={() => setResolveTarget({ id: ask.id, path: ask.path })}
                      >
                        解決
                      </ContextMenuItem>
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
            );
          })}
        </div>
      )}

      <Dialog
        open={resolveTarget !== null}
        onOpenChange={(open) => !open && setResolveTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>質問を解決してセッションを閉じます</DialogTitle>
            <DialogDescription>{resolveTarget?.path}</DialogDescription>
          </DialogHeader>
          {resolveError && <p className="text-xs text-destructive">{resolveError}</p>}
          <DialogFooter>
            <Button type="button" onClick={handleResolveConfirm} disabled={resolveSubmitting}>
              解決
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
