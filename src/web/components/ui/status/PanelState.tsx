// Shared failure/empty-state layout (ui-redesign.md §6, design.pen P10b).
// Used for Compose/Process's 4 failure states, Diff's empty state, Files'
// unselected/binary/too-large states, the Tool pane's unresolved-worktree
// notice, and Terminal's disconnected overlay — anywhere a panel has
// nothing to show and needs to say why.
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PanelStateAction {
  label: string;
  onClick: () => void;
}

export type PanelStateTone = "muted" | "warning" | "error";

export interface PanelStateProps {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  title: ReactNode;
  description?: ReactNode;
  action?: PanelStateAction;
  tone?: PanelStateTone;
  /** 枠線付きカードで囲む（design.pen P10b: Compose/Process の失敗・0 件状態）。 */
  card?: boolean;
}

const TONE_CLASS: Record<PanelStateTone, string> = {
  muted: "text-muted-foreground",
  warning: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
};

export function PanelState({
  icon: Icon,
  title,
  description,
  action,
  tone = "muted",
  card = false,
}: PanelStateProps) {
  const role = tone === "error" || tone === "warning" ? "alert" : "status";
  return (
    <div role={role} className="flex h-full w-full items-center justify-center p-4">
      <div
        className={cn(
          "flex flex-col items-center gap-2 text-center",
          card && "max-w-sm rounded-lg border border-border p-6",
        )}
      >
        <Icon className={`size-6 ${TONE_CLASS[tone]}`} aria-hidden="true" />
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        {action && (
          <button
            type="button"
            className="mt-1 rounded-sm border border-border px-2 py-1 text-xs hover:bg-muted"
            onClick={action.onClick}
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

export default PanelState;
