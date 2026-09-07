import { Bot, Terminal } from "lucide-react";
import { useState } from "react";
import type { PaneRow as PaneRowType } from "@contract/events";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { AgentStatusDot } from "@/components/ui/status/AgentStatusDot";
import { cn } from "@/lib/utils";

export type PaneRowProps = {
  pane: PaneRowType;
  /** herdr の現在フォーカス（`state.focus.pane`）と一致するか。`pane.focused` は
   * workspace 内のアクティブ pane を指すだけで herdr 全体のフォーカスとは
   * 別物なので使わない。 */
  focused: boolean;
  /** フォーカス中の pane の `agentSession.value`。この pane がフォーカス中で
   * なければ null — 「session id をコピー」はフォーカス中の pane にしか出せる
   * API が無い（右クリックした pane 自身の session を herdr から引けない）。 */
  sessionId: string | null;
  onSelect: (paneId: string) => void;
};

/** ui-redesign.md §5.2: エージェント種別アイコン（shell は Terminal、それ以外は
 * Bot）、状態ドット、label/terminal title、tab label を出す 1 行。 */
export function PaneRow({ pane, focused, sessionId, onSelect }: PaneRowProps) {
  const [copied, setCopied] = useState(false);
  const title = pane.label ?? pane.terminalTitleStripped ?? pane.paneId;
  const KindIcon = pane.agent === "shell" ? Terminal : Bot;

  async function copySessionId() {
    if (!sessionId) return;
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボード API が使えない環境では何もしない
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={() => onSelect(pane.paneId)}
          aria-current={focused ? "true" : undefined}
          title="フォーカスを移す（ターミナルも切り替わります）"
          data-testid={`pane-row-${pane.paneId}`}
          className={cn(
            "flex w-full items-start gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-muted",
            focused && "bg-sidebar-accent font-medium",
          )}
        >
          <AgentStatusDot status={pane.agentStatus} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1">
              {pane.agent && (
                <KindIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="truncate">{pane.agent ? `${pane.agent}: ${title}` : title}</span>
            </span>
            {pane.tabLabel && (
              <span className="block truncate text-[10px] text-muted-foreground">
                {pane.tabLabel}
              </span>
            )}
          </span>
          {focused && (
            <span
              data-testid="focus-dot"
              aria-hidden="true"
              className="mt-1 size-1.5 shrink-0 rounded-full bg-focus"
            />
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onSelect(pane.paneId)}>フォーカスを移す</ContextMenuItem>
        <ContextMenuItem disabled={!sessionId} onSelect={copySessionId}>
          {copied ? "コピーしました" : "session id をコピー"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
