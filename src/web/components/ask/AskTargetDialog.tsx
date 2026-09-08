// 送信先ダイアログ（質問, ui-redesign.md §5.4/§5.5）: 新規セッション（エージェント
// 種別を選ぶ）か、この worktree で動いている既存 pane かを選び、選択と同時に
// 質問を作成・送信する（下書きにはならない）。pane カードは M10 の
// SendTargetCard（レビュー送信先ダイアログ）を共用する。
import { useState } from "react";
import type { AskTarget, CreateAskRequest } from "@contract/ask";
import type { PaneRow } from "@contract/events";
import { SendTargetCard } from "@/components/review/SendDraftsButton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast/ToastProvider";
import { AskLimitError, AskUnavailableError, AskUnknownAgentError, askApi } from "@/lib/api";
import { cn } from "@/lib/utils";

const LAST_AGENT_KEY = "herdr-web:ask-agent";

function readLastAgent(): string | null {
  try {
    return localStorage.getItem(LAST_AGENT_KEY);
  } catch {
    return null;
  }
}

function writeLastAgent(agent: string): void {
  try {
    localStorage.setItem(LAST_AGENT_KEY, agent);
  } catch {
    // localStorage 不可（プライベートブラウジング等）: 次回の既定値に戻るだけ。
  }
}

export type AskTargetDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 見出し下の説明に出す `path:L<start>–<end>`。 */
  location: string;
  body: string;
  createParams: Omit<CreateAskRequest, "target" | "body">;
  agents: string[];
  defaultAgent: string;
  /** 専用ワークスペースの同時起動上限。 */
  maxSessions: number;
  /** 現在稼働中の質問セッション数（`liveAskSessionCount`）。 */
  activeSessions: number;
  /** この worktree のエージェント pane（ask セッションは呼び出し側で除外済み）。 */
  panes: PaneRow[];
  onCreated: (ask: Awaited<ReturnType<typeof askApi.create>>) => void;
};

function paneLabel(pane: PaneRow): string {
  return pane.label ?? pane.tabLabel ?? pane.paneId;
}

function errorMessage(err: unknown): string {
  if (
    err instanceof AskLimitError ||
    err instanceof AskUnavailableError ||
    err instanceof AskUnknownAgentError
  ) {
    return err.message;
  }
  return "質問の送信に失敗しました";
}

export function AskTargetDialog({
  open,
  onOpenChange,
  location,
  body,
  createParams,
  agents,
  defaultAgent,
  maxSessions,
  activeSessions,
  panes,
  onCreated,
}: AskTargetDialogProps) {
  const toast = useToast();
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState(() => {
    const last = readLastAgent();
    return last && agents.includes(last) ? last : defaultAgent;
  });
  const [busy, setBusy] = useState(false);

  const selectedPane = panes.find((p) => p.paneId === selectedPaneId) ?? null;

  function chooseAgent(agent: string) {
    setSelectedAgent(agent);
    setSelectedPaneId(null);
    writeLastAgent(agent);
  }

  const submitLabel = selectedPane
    ? `${selectedPane.agent ?? "?"} · ${paneLabel(selectedPane)} に質問する`
    : "新規セッションで質問する";

  async function submit() {
    if (busy) return;
    setBusy(true);
    const target: AskTarget = selectedPane
      ? { kind: "pane", paneId: selectedPane.paneId }
      : { kind: "new", agent: selectedAgent };
    try {
      const created = await askApi.create({ ...createParams, body, target });
      onCreated(created);
      onOpenChange(false);
    } catch (err) {
      toast({ kind: "error", message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>質問の送信先</DialogTitle>
          <DialogDescription>{location}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div
            className={cn(
              "rounded-md border p-2",
              !selectedPane ? "border-primary" : "border-border",
            )}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left text-sm font-medium"
              onClick={() => setSelectedPaneId(null)}
              aria-pressed={!selectedPane}
            >
              <span
                role="radio"
                aria-checked={!selectedPane}
                className="inline-block size-3 rounded-full border border-primary"
              />
              新規セッション
              <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                既定
              </span>
            </button>
            <div className="mt-2 flex flex-wrap gap-1.5 pl-5">
              {agents.map((agent) => (
                <Button
                  key={agent}
                  type="button"
                  size="sm"
                  variant={!selectedPane && selectedAgent === agent ? "default" : "outline"}
                  aria-pressed={!selectedPane && selectedAgent === agent}
                  onClick={() => chooseAgent(agent)}
                >
                  {agent}
                </Button>
              ))}
            </div>
            <p className="mt-1 pl-5 text-xs text-muted-foreground">
              同時 {activeSessions}/{maxSessions}
            </p>
          </div>

          {panes.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground">
                または、この worktree で動いている pane に送る
              </p>
              {panes.map((pane) => (
                <div
                  key={pane.paneId}
                  className={cn(
                    "rounded-md",
                    selectedPaneId === pane.paneId && "ring-2 ring-primary",
                  )}
                >
                  <SendTargetCard
                    pane={pane}
                    fetchPreview={open}
                    onSelect={(paneId) => setSelectedPaneId(paneId)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            戻る
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AskTargetDialog;
