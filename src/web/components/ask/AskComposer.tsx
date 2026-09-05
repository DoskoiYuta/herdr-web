// 「質問」composer — opened after a line selection ends in a text file
// (F10). Modeled on review/ReviewAnnotation.tsx's ComposerAnnotation but adds
// the send-target picker (新規セッション vs. an existing agent pane at this
// worktree), which review's composer doesn't need since review targets are
// resolved server-side at send time.
import { useState } from "react";
import type { AskTarget } from "@contract/ask";
import type { PaneRow } from "@contract/events";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const NEW_SESSION_VALUE = "__new__";

function paneLabel(pane: PaneRow): string {
  return pane.label ?? pane.terminalTitleStripped ?? pane.agent ?? pane.paneId;
}

export interface AskComposerProps {
  onCancel: () => void;
  onSubmit: (body: string, target: AskTarget) => void | Promise<void>;
  /** Agent panes at the current worktree (`agentPanesAt(repos, worktreeRoot)`),
   * offered as additional send targets alongside the default 新規セッション. */
  panes: PaneRow[];
  /** `createdAtHead`/repo not yet resolved — disable submit (same pattern as
   * review's ComposerAnnotation `disabled`). */
  disabled?: boolean;
}

export function AskComposer({ onCancel, onSubmit, panes, disabled = false }: AskComposerProps) {
  const [body, setBody] = useState("");
  const [targetValue, setTargetValue] = useState(NEW_SESSION_VALUE);
  const [busy, setBusy] = useState(false);

  const target: AskTarget =
    targetValue === NEW_SESSION_VALUE ? { kind: "new" } : { kind: "pane", paneId: targetValue };

  const submit = async () => {
    if (!body.trim() || busy || disabled) return;
    setBusy(true);
    try {
      await onSubmit(body.trim(), target);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="my-1 flex flex-col gap-2 rounded-md border border-border bg-popover p-2 shadow-sm"
      data-testid="ask-composer"
    >
      <Textarea
        autoFocus
        placeholder="質問を入力"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
        }}
        className="min-h-12 text-sm"
      />
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">送信先</span>
        <Select value={targetValue} onValueChange={setTargetValue}>
          <SelectTrigger size="sm" className="h-7 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NEW_SESSION_VALUE}>新規セッションで質問</SelectItem>
            {panes.map((pane) => (
              <SelectItem key={pane.paneId} value={pane.paneId}>
                {paneLabel(pane)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {disabled && (
        <p className="text-xs text-muted-foreground">
          リポジトリを解決できていません（少し待ってから再度お試しください）
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          キャンセル
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void submit()}
          disabled={busy || disabled || !body.trim()}
        >
          送信
        </Button>
      </div>
    </div>
  );
}

export default AskComposer;
