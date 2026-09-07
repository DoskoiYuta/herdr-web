// レビュー下書きの一括送信ボタン（Diff タブでしか使わないため、ui-redesign.md
// §5.4 に従い ToolPane のヘッダーではなく Diff の Toolbar 右端に置く）。
// 送信先候補が複数のときのピッカーダイアログ、候補カードのプレビュー取得
// （usePanePreview）もここに閉じる。

import { useCallback, useState } from "react";
import type { PaneRow } from "@contract/events";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { reviewApi, SendTargetError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { STATUS_META } from "@/components/sidebar/PaneRow";
import { PaneLayoutMiniMap } from "@/components/tool/PaneLayoutMiniMap";
import { usePanePreview } from "@/components/tool/hooks/usePanePreview";

/** 送信先が確定できなかったときの `POST /api/review/send` 409 レスポンスの表示文言。 */
const SEND_TARGET_ERROR_MESSAGE: Record<SendTargetError["type"], string> = {
  no_agent: "この worktree にエージェントがいません",
  ambiguous_target: "送信先を選んでください",
  invalid_target: "選んだセッションはこの worktree にいません",
};

/** 送信先の選択（レビュー）— pane カード（レイアウトミニマップ・状態・
 * workspace/tab・出力末尾）。候補は `pane` から即描画し、workspace/tab/title・
 * レイアウト・出力末尾は `usePanePreview` が解決してから埋める — 取得に失敗/
 * 遅延しても、カード自体は最初からクリックできる。 */
function SendTargetCard({
  pane,
  fetchPreview,
  onSelect,
}: {
  pane: PaneRow;
  fetchPreview: boolean;
  onSelect: (paneId: string) => void;
}) {
  const { data: preview } = usePanePreview(pane.paneId, fetchPreview);
  const meta = STATUS_META[preview?.agentStatus ?? pane.agentStatus];
  const StatusIcon = meta.icon;
  const workspaceLabel = preview?.workspaceLabel ?? pane.workspaceLabel;
  const tabLabel = preview?.tabLabel ?? pane.tabLabel;
  const title = preview?.title ?? pane.label ?? pane.tabLabel ?? pane.paneId;
  const sessionId = preview?.agentSession?.slice(0, 8) ?? null;
  const tail = preview?.tail ?? [];

  return (
    <Button
      type="button"
      variant="outline"
      className="h-auto flex-col items-stretch gap-1.5 p-2 text-left whitespace-normal"
      onClick={() => onSelect(pane.paneId)}
    >
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">
          {workspaceLabel ?? "?"} › {tabLabel ?? "?"}
        </span>
        {sessionId && <span className="shrink-0 font-mono">{sessionId}</span>}
      </div>
      <div className="flex items-center gap-2">
        {preview?.layout && (
          <PaneLayoutMiniMap layout={preview.layout} candidatePaneId={pane.paneId} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <StatusIcon
              className={cn("size-3 shrink-0", meta.className, meta.spin && "animate-spin")}
            />
            <span className="truncate text-sm font-medium">{title}</span>
          </div>
          {tail.length > 0 && (
            <pre className="mt-1 max-h-24 overflow-hidden rounded bg-muted/50 p-1 font-mono text-[10px] whitespace-pre-wrap break-all text-muted-foreground">
              {tail.slice(-6).join("\n")}
            </pre>
          )}
        </div>
      </div>
    </Button>
  );
}

export type SendDraftsButtonProps = {
  /** リポジトリキー。null ならまだ解決できていない（送信不可）。 */
  repoKey: string | null;
  /** 送信対象の worktree（サブリポジトリではなく実際の git worktree のルート）。 */
  worktreeRoot: string;
  /** `GET /api/review/counts` の `pendingDrafts`。0 ならボタン自体を描画しない。 */
  pendingDrafts: number;
  /** この worktree のエージェント pane（送信先候補）。 */
  agentPanes: PaneRow[];
  /** 送信成功後に呼ぶ（呼び出し側が `pendingDrafts` の再取得をトリガーする）。 */
  onSent: () => void;
};

/** 「送信 (N)」ボタン。0 件なら非表示（disabled ではなく非表示 — ui-redesign.md
 * §5.4）。候補が 1 件ならそのまま送信、2 件以上ならピッカーダイアログを開く。 */
export function SendDraftsButton({
  repoKey,
  worktreeRoot,
  pendingDrafts,
  agentPanes,
  onSent,
}: SendDraftsButtonProps) {
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const sendTo = useCallback(
    async (pane?: string) => {
      if (!repoKey || sendBusy) return;
      setSendBusy(true);
      setSendError(null);
      try {
        await reviewApi.send({ repo: repoKey, worktreeRoot, pane });
        onSent();
        setPickerOpen(false);
      } catch (err) {
        setSendError(
          err instanceof SendTargetError
            ? SEND_TARGET_ERROR_MESSAGE[err.type]
            : "送信に失敗しました",
        );
      } finally {
        setSendBusy(false);
      }
    },
    [repoKey, worktreeRoot, sendBusy, onSent],
  );

  const handleSend = useCallback(() => {
    if (sendBusy || agentPanes.length === 0) return;
    if (agentPanes.length === 1) {
      void sendTo(agentPanes[0]!.paneId);
      return;
    }
    setPickerOpen(true);
  }, [sendBusy, agentPanes, sendTo]);

  if (pendingDrafts === 0) return null;

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={sendBusy || agentPanes.length === 0}
        title={agentPanes.length === 0 ? SEND_TARGET_ERROR_MESSAGE.no_agent : undefined}
        onClick={handleSend}
      >
        送信 ({pendingDrafts})
      </Button>
      {sendError && <span className="text-xs text-destructive">{sendError}</span>}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>送信先を選択</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            {agentPanes.map((pane) => (
              <SendTargetCard
                key={pane.paneId}
                pane={pane}
                fetchPreview={pickerOpen}
                onSelect={(paneId) => void sendTo(paneId)}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
