// 「質問」composer — opened after a line selection ends in a text file
// (F10). Body only: the send-target picker (新規セッション / 既存 pane) lives
// in AskTargetDialog (ui-redesign.md §5.4/§5.5), opened from here rather than
// picked inline, so the composer itself never knows about agents or panes.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export interface AskComposerProps {
  onCancel: () => void;
  /** 「送信先を選ぶ…」（または ⌘Enter）で AskTargetDialog を開く。 */
  onOpenTargetDialog: (body: string) => void;
  /** `createdAtHead`/repo not yet resolved — disable submit (same pattern as
   * review's ComposerAnnotation `disabled`). */
  disabled?: boolean;
}

export function AskComposer({ onCancel, onOpenTargetDialog, disabled = false }: AskComposerProps) {
  const [body, setBody] = useState("");

  const openDialog = () => {
    if (!body.trim() || disabled) return;
    onOpenTargetDialog(body.trim());
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
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) openDialog();
        }}
        className="min-h-12 text-sm"
      />
      {disabled && (
        <p className="text-xs text-muted-foreground">
          リポジトリを解決できていません（少し待ってから再度お試しください）
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="button" size="sm" onClick={openDialog} disabled={disabled || !body.trim()}>
          送信先を選ぶ…
        </Button>
      </div>
    </div>
  );
}

export default AskComposer;
