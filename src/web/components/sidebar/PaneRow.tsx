import { Bot, CircleCheck, CircleDashed, CircleHelp, Loader2, OctagonAlert } from "lucide-react";
import type { PaneRow as PaneRowType } from "@contract/events";
import type { AgentStatus } from "@contract/herdr";
import { cn } from "@/lib/utils";

type StatusMeta = { icon: typeof CircleDashed; label: string; className: string; spin?: boolean };

const STATUS_META: Record<AgentStatus, StatusMeta> = {
  idle: { icon: CircleDashed, label: "idle", className: "text-muted-foreground" },
  working: { icon: Loader2, label: "working", className: "text-blue-500", spin: true },
  blocked: { icon: OctagonAlert, label: "blocked", className: "text-red-500" },
  done: { icon: CircleCheck, label: "done", className: "text-green-500" },
  unknown: { icon: CircleHelp, label: "unknown", className: "text-yellow-500" },
};

export type PaneRowProps = {
  pane: PaneRowType;
  onSelect: (paneId: string) => void;
};

/** plan.md F8-2: agent 名/アイコン、状態（色+アイコン）、label/terminal_title_stripped、
 * 所属 workspace / tab（PaneRow に label は無いので id を薄字で表示する）を出す 1 行。 */
export function PaneRow({ pane, onSelect }: PaneRowProps) {
  const meta = STATUS_META[pane.agentStatus]!;
  const StatusIcon = meta.icon;
  const title = pane.label ?? pane.terminalTitleStripped ?? pane.paneId;

  return (
    <button
      type="button"
      onClick={() => onSelect(pane.paneId)}
      aria-current={pane.focused ? "true" : undefined}
      data-testid={`pane-row-${pane.paneId}`}
      className={cn(
        "flex w-full items-start gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-muted",
        pane.focused && "bg-muted font-medium",
      )}
    >
      <StatusIcon
        className={cn("mt-0.5 size-3.5 shrink-0", meta.className, meta.spin && "animate-spin")}
        aria-label={`状態: ${meta.label}`}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          {pane.agent && (
            <Bot className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="truncate">{pane.agent ? `${pane.agent}: ${title}` : title}</span>
        </span>
        <span className="block truncate text-[10px] text-muted-foreground">
          {pane.workspaceId} / {pane.tabId}
        </span>
      </span>
    </button>
  );
}
