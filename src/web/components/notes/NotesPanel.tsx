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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PanelState } from "@/components/ui/status/PanelState";
import { useToast } from "@/components/ui/toast/ToastProvider";
import { notesApi, type Note } from "@/lib/api";
import { cn } from "@/lib/utils";
import { noteDisplayTitle } from "@contract/notes";

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

/** `hw notes show <id>` の `<id>` — サーバーの短縮 id 解決（末尾一致 4 文字以上）に
 * 合わせて、行から一意に引ける長さの末尾 8 文字を使う（review/ask 一覧と同じ）。 */
function noteShowCommand(note: Note): string {
  return `hw notes show ${note.id.slice(-8)}`;
}

type NoteMenuItem = {
  key: string;
  label: string;
  onSelect: () => void;
  variant?: "destructive";
};

function noteMenuItems(handlers: {
  onCopyCommand: () => void;
  onRequestDelete: () => void;
}): NoteMenuItem[] {
  return [
    { key: "copy", label: "コマンドをコピー", onSelect: handlers.onCopyCommand },
    { key: "delete", label: "削除", onSelect: handlers.onRequestDelete, variant: "destructive" },
  ];
}

function NoteRow({
  note,
  selected,
  onSelect,
  onCopyCommand,
  onRequestDelete,
}: {
  note: Note;
  selected: boolean;
  onSelect: () => void;
  onCopyCommand: () => void;
  onRequestDelete: () => void;
}) {
  const items = noteMenuItems({ onCopyCommand, onRequestDelete });

  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
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
            className={cn(
              "flex w-full cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-left text-sm hover:bg-muted",
              selected && "bg-muted font-medium",
            )}
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                note.title.trim() === "" && "text-muted-foreground",
              )}
            >
              {noteDisplayTitle(note)}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`「${noteDisplayTitle(note)}」のメニュー`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {items.map((item) => (
                  <DropdownMenuItem key={item.key} variant={item.variant} onSelect={item.onSelect}>
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {items.map((item) => (
            <ContextMenuItem key={item.key} variant={item.variant} onSelect={item.onSelect}>
              {item.label}
            </ContextMenuItem>
          ))}
        </ContextMenuContent>
      </ContextMenu>
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
  // URL の `id` が一覧に無ければ（削除済み・別リポジトリの残骸）先頭ページに
  // 落ちる — 存在しない id をそのまま使うと selectedNote が null になり、
  // ページがあるのに空状態を出してしまう。
  const effectiveId =
    selectedId !== null && list.some((n) => n.id === selectedId)
      ? selectedId
      : (list[0]?.id ?? null);
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
  // サーバーから読み込んだ／直近で保存が確定した本文。wysimark の
  // `Editable` は `value` prop（`contents`）が自分の直近の markdown と
  // 食い違うと `editor.children` を差し替えて Slate の onChange を発火させる
  // ため（`ignoreNextChangeRef` は wysimark 側で参照されておらず効かない）、
  // ページ切替で `contents` が別ページの本文に変わっただけでも
  // `onChange(markdown)` が呼ばれうる。`key={draftId}` で毎回再マウントして
  // その経路自体を避けつつ、ここでも「直近の確定内容と同じなら保存しない」
  // という二重の防御を持つ。
  const lastKnownBodyRef = useRef("");
  // commit 同士の直列化。デバウンスの timeout と切替時の flush が競合すると、
  // サーバー側は 1 本の UPDATE でも、クライアント側で古い保存が新しい保存を
  // 追い越して上書きしうる。
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  if (selectedNote && draftId !== selectedNote.id) {
    setDraftId(selectedNote.id);
    setTitle(selectedNote.title);
    setBody(selectedNote.body);
    setSaveStatus({ kind: "idle" });
    lastKnownBodyRef.current = selectedNote.body;
  }

  const commitOnce = useCallback(async () => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    const { id, ...patch } = pending;
    setSaveStatus({ kind: "saving" });
    try {
      const updated = await notesApi.update(id, patch);
      // 保存が確定した頃にはユーザーが別ページへ切り替えているかもしれない
      // — その場合、今表示中のページとは無関係な確定値で
      // lastKnownBodyRef を書き換えてはいけない。
      if (patch.body !== undefined && id === draftId) {
        lastKnownBodyRef.current = updated.body;
      }
      queryClient.setQueryData<Note[]>(["notes-list", repoKey], (old) =>
        old?.map((n) => (n.id === id ? updated : n)),
      );
      setSaveStatus({ kind: "saved", at: Date.now() });
    } catch {
      setSaveStatus({ kind: "error" });
      toast({ kind: "error", message: "保存に失敗しました" });
    }
  }, [queryClient, repoKey, toast, draftId]);

  const commit = useCallback(() => {
    // 前の commit が成功/失敗どちらで終わっても、次の commit は必ず走る
    // （直列化するだけで、一度失敗したら以後 no-op になってはいけない）。
    saveChainRef.current = saveChainRef.current.then(commitOnce, commitOnce);
    return saveChainRef.current;
  }, [commitOnce]);

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
      // wysimark が parse→serialize の往復で呼ぶだけの無変化イベント
      // （ページ切替時の再マウント直後など）は保存をスケジュールしない。
      if (markdown === lastKnownBodyRef.current) return;
      scheduleSave(draftId, { body: markdown });
    },
    [draftId, scheduleSave],
  );

  const handleCreate = useCallback(async () => {
    if (!repoKey) return;
    const note = await notesApi.create({ repoKey, title: "" });
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

  const handleCopyCommand = useCallback(
    async (note: Note) => {
      try {
        await navigator.clipboard.writeText(noteShowCommand(note));
      } catch {
        toast({ kind: "error", message: "クリップボードにコピーできませんでした" });
      }
    },
    [toast],
  );

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
              onCopyCommand={() => void handleCopyCommand(note)}
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
                placeholder="無題"
                className="w-full min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <MarkdownView key={draftId} contents={body} onChange={handleBodyChange} />
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
            <DialogTitle>
              「{deleteTarget ? noteDisplayTitle(deleteTarget) : ""}」を削除しますか？
            </DialogTitle>
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
