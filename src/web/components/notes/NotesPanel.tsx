// Notes ツールタブ (docs/ui-redesign.md §5.4): リポジトリ単位の複数ページ
// markdown ノート。左にページ一覧、右にタイトル入力 + WYSIWYG エディタ
// (MarkdownView の編集モード)。選択中ページは URL の search `id`（親の
// ToolPane が持つ）— 無ければ一覧の先頭を表示する。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus, StickyNote } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MarkdownView } from "@/components/files/MarkdownView";
import { EmptyWorktreeNotice } from "@/components/tool/EmptyWorktreeNotice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PanelState } from "@/components/ui/status/PanelState";
import { useToast } from "@/components/ui/toast/ToastProvider";
import { notesApi, type Note } from "@/lib/api";
import { cn } from "@/lib/utils";

const AUTOSAVE_DEBOUNCE_MS = 1000;

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error" };

type PendingPatch = { id: string; title?: string; body?: string };

function formatSavedAt(atMs: number): string {
  return new Date(atMs).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** `repoKey`（git-common-dir の realpath、`.../<name>/.git` の形）からリポジトリ
 * 名を出す — worktree ではなくリポジトリ単位の共有先だと分かるようにする。 */
function repoDisplayName(repoKey: string): string {
  const trimmed = repoKey.replace(/\/+$/, "");
  const withoutGitDir = trimmed.endsWith("/.git") ? trimmed.slice(0, -"/.git".length) : trimmed;
  const idx = withoutGitDir.lastIndexOf("/");
  return idx === -1 ? withoutGitDir : withoutGitDir.slice(idx + 1);
}

function NoteRow({
  note,
  selected,
  onSelect,
  onRequestDelete,
}: {
  note: Note;
  selected: boolean;
  onSelect: () => void;
  onRequestDelete: () => void;
}) {
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        data-testid={`note-row-${note.id}`}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onRequestDelete();
        }}
        className={cn(
          "flex w-full cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-left text-sm hover:bg-muted",
          selected && "bg-muted font-medium",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{note.title}</span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={`「${note.title}」を削除`}
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete();
          }}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}

export type NotesPanelProps = {
  /** git-common-dir の realpath。null は herdr 未接続/worktree 未解決。 */
  repoKey: string | null;
  /** 選択中ページの id（URL の search `id`）。無ければ一覧の先頭を使う。 */
  selectedId: string | null;
  onSelectId: (id: string) => void;
};

export function NotesPanel({ repoKey, selectedId, onSelectId }: NotesPanelProps) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const listQuery = useQuery({
    queryKey: ["notes-list", repoKey],
    queryFn: () => notesApi.list(repoKey as string),
    enabled: repoKey !== null,
  });
  const list = listQuery.data ?? [];
  const effectiveId = selectedId ?? list[0]?.id ?? null;
  const selectedNote = list.find((n) => n.id === effectiveId) ?? null;

  // 選択中ページのローカル下書き。`draftId` が selectedNote.id と食い違う
  // レンダーで同期する（FilesPanel の selectedPath 切替と同じ、レンダー中に
  // state を揃えるパターン）。
  const [draftId, setDraftId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });
  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const pendingRef = useRef<PendingPatch | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const focusTitleRef = useRef(false);

  if (selectedNote && draftId !== selectedNote.id) {
    setDraftId(selectedNote.id);
    setTitle(selectedNote.title);
    setBody(selectedNote.body);
    setSaveStatus({ kind: "idle" });
  }

  const commit = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    const { id, ...patch } = pending;
    setSaveStatus({ kind: "saving" });
    try {
      const updated = await notesApi.update(id, patch);
      queryClient.setQueryData<Note[]>(["notes-list", repoKey], (old) =>
        old?.map((n) => (n.id === id ? updated : n)),
      );
      setSaveStatus({ kind: "saved", at: Date.now() });
    } catch {
      setSaveStatus({ kind: "error" });
      toast({ kind: "error", message: "保存に失敗しました" });
    }
  }, [queryClient, repoKey, toast]);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void commit();
  }, [commit]);

  const scheduleSave = useCallback(
    (id: string, patch: { title?: string; body?: string }) => {
      pendingRef.current = { ...pendingRef.current, ...patch, id };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void commit();
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [commit],
  );

  // ページ切替（draftId 変化）・アンマウント時に未保存分を即 flush する。
  // draftId が変わるレンダーでは上の同期が先に走っているが、pendingRef は
  // ローカル state と無関係なので、ここで読む内容は依然として「切替前の
  // ページ」の下書きのままになる。
  useEffect(() => {
    return () => flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  useEffect(() => {
    if (focusTitleRef.current && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
      focusTitleRef.current = false;
    }
  }, [draftId]);

  const handleTitleChange = useCallback(
    (value: string) => {
      if (!draftId) return;
      setTitle(value);
      scheduleSave(draftId, { title: value });
    },
    [draftId, scheduleSave],
  );

  const handleBodyChange = useCallback(
    (markdown: string) => {
      if (!draftId) return;
      setBody(markdown);
      scheduleSave(draftId, { body: markdown });
    },
    [draftId, scheduleSave],
  );

  const handleCreate = useCallback(async () => {
    if (!repoKey) return;
    const note = await notesApi.create({ repoKey, title: "無題" });
    queryClient.setQueryData<Note[]>(["notes-list", repoKey], (old) => [...(old ?? []), note]);
    focusTitleRef.current = true;
    onSelectId(note.id);
  }, [repoKey, queryClient, onSelectId]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteSubmitting(true);
    try {
      await notesApi.delete(deleteTarget.id);
      queryClient.setQueryData<Note[]>(["notes-list", repoKey], (old) =>
        old?.filter((n) => n.id !== deleteTarget.id),
      );
      if (deleteTarget.id === draftId) {
        pendingRef.current = null;
        setDraftId(null);
      }
      setDeleteTarget(null);
    } catch {
      toast({ kind: "error", message: "削除に失敗しました" });
    } finally {
      setDeleteSubmitting(false);
    }
  }, [deleteTarget, queryClient, repoKey, draftId, toast]);

  if (!repoKey) return <EmptyWorktreeNotice />;

  return (
    <div className="flex h-full w-full">
      <div className="flex w-[200px] shrink-0 flex-col border-r border-border">
        <div className="flex shrink-0 items-center justify-between px-2 py-1.5">
          <span className="text-xs text-muted-foreground">ページ</span>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="ページを追加"
            onClick={() => void handleCreate()}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
        <ul data-testid="notes-list" className="min-h-0 flex-1 overflow-y-auto px-1">
          {list.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              selected={note.id === effectiveId}
              onSelect={() => onSelectId(note.id)}
              onRequestDelete={() => setDeleteTarget(note)}
            />
          ))}
        </ul>
        <p className="shrink-0 px-2 py-1.5 text-[10px] text-muted-foreground">
          {list.length} ページ · {repoDisplayName(repoKey)} 全体で共有
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {selectedNote ? (
          <>
            <div className="flex shrink-0 items-center border-b border-border px-2 py-1.5">
              <input
                ref={titleInputRef}
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                aria-label="タイトル"
                className="w-full min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <MarkdownView contents={body} onChange={handleBodyChange} />
            </div>
            <div className="shrink-0 border-t border-border px-2 py-1 text-right text-[11px] text-muted-foreground">
              {saveStatus.kind === "saving" && "保存中…"}
              {saveStatus.kind === "saved" && `保存済み ${formatSavedAt(saveStatus.at)}`}
              {saveStatus.kind === "error" && (
                <button type="button" className="text-destructive underline" onClick={flush}>
                  保存に失敗（再試行）
                </button>
              )}
            </div>
          </>
        ) : (
          <PanelState
            icon={StickyNote}
            title="ページがありません"
            action={{ label: "＋ ページを作成", onClick: () => void handleCreate() }}
          />
        )}
      </div>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>「{deleteTarget?.title}」を削除しますか？</DialogTitle>
            <DialogDescription>この操作は元に戻せません。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteSubmitting}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDeleteConfirm()}
              disabled={deleteSubmitting}
            >
              削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default NotesPanel;
