// Shared failure/empty-state layout (ui-redesign.md §6, design.pen P10b).
// Used for Compose/Process's 4 failure states, Diff's empty state, Files'
// unselected/binary/too-large states, the Tool pane's unresolved-worktree
// notice, and Terminal's disconnected overlay — anywhere a panel has
// nothing to show and needs to say why.
import type { ComponentType, ReactNode } from "react";

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
}

const TONE_CLASS: Record<PanelStateTone, string> = {
  muted: "text-muted-foreground",
  warning: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
};

export function PanelState({ icon: Icon, title, description, action, tone = "muted" }: PanelStateProps) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
      <Icon className={`size-6 ${TONE_CLASS[tone]}`} aria-hidden="true" />
      <p className={`text-sm font-medium ${TONE_CLASS[tone]}`}>{title}</p>
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
  );
}

export default PanelState;
