/**
 * ui-redesign.md §5.4 Inbox: 画面中央のフローティングダイアログ。開閉は
 * `/focus/$tab` の search `inbox`（router.tsx が state を持つ、この
 * コンポーネントは `open`/`onOpenChange` だけを受け取る）。状態タブは持たない
 * — 対応すると消えるものだけをセクションで並べる。
 */
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Inbox as InboxIcon, X } from "lucide-react";
import type { AskPromptState } from "@contract/ask";
import type { DecisionDeliveryState } from "@contract/decision";
import type { NotifyState } from "@contract/review";
import { askApi, decisionApi, reviewApi, type InboxItem, type InboxSection } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeliveryChip } from "@/components/ui/status/DeliveryChip";
import { KindIcon } from "@/components/ui/status/KindIcon";
import { deliveryOf, type DeliveryResult } from "@/lib/statusVocab";
import { useHerdrState, useHerdrStoreActions } from "@/lib/HerdrStoreContext";
import { useOpenWorktreeLocation } from "@/lib/openWorktreeLocation";
import { useInbox } from "./hooks/useInbox";

const SECTION_ORDER: InboxSection[] = ["undelivered", "replied", "unsent", "blocked"];

const SECTION_LABEL: Record<InboxSection, string> = {
  undelivered: "届いていない通知",
  replied: "返信が届いた",
  unsent: "送信待ち",
  blocked: "入力待ちのエージェント",
};

/** `Select` の「すべての worktree」は空文字を渡せない（Radix が空文字を予約している）ため専用の値にする。 */
const ALL_WORKTREES = "__all__";

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

type UndeliveredItem = Extract<InboxItem, { section: "undelivered" }>;

/** サーバーは各 contract の生の状態をそのまま載せる (`docs/ui-redesign.md` の
 * コメント参照) — 表示語 + canResend への写像は web 側の `statusVocab` に通す。 */
function deliveryResultFor(item: UndeliveredItem): DeliveryResult {
  if (item.kind === "review") {
    return deliveryOf("review", { state: item.delivery.state as NotifyState });
  }
  if (item.kind === "ask") {
    return deliveryOf("ask", {
      state: item.delivery.state as AskPromptState,
      at: item.at,
    });
  }
  return deliveryOf("decision", {
    state: item.delivery.state as DecisionDeliveryState,
    attempts: 0,
    pane: null,
    at: item.at,
  });
}

function inboxRowKey(item: InboxItem): string {
  if (item.section === "blocked") return `blocked:${item.paneId}`;
  if (item.section === "unsent") return `unsent:${item.worktreeRoot}`;
  return `${item.section}:${item.id}`;
}

function rowTitle(item: InboxItem): string {
  if (item.section === "unsent") return `送信待ち (${item.count})`;
  if (item.section === "blocked") return item.agent ?? item.label ?? "エージェント";
  return item.title;
}

function rowDetail(item: InboxItem): string {
  if (item.section === "undelivered") return item.detail;
  if (item.section === "replied") return item.excerpt;
  if (item.section === "unsent") return "";
  return [item.workspaceLabel, item.tabLabel].filter(Boolean).join(" · ");
}

function rowMeta(item: InboxItem): string {
  const agent = "agent" in item ? item.agent : null;
  return [item.kind, item.worktreeRoot ? basename(item.worktreeRoot) : null, agent]
    .filter(Boolean)
    .join(" · ");
}

/** 決定の undelivered 行だけがクリックで遷移する（docs/ui-redesign.md §5.4 の
 * 行操作表）。それ以外の undelivered（review/ask）は再送 chip だけを持つ。 */
function isRowClickable(item: InboxItem): boolean {
  if (item.section === "undelivered") return item.kind === "decision";
  return true;
}

export type InboxDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function InboxDialog({ open, onOpenChange }: InboxDialogProps) {
  const [worktreeFilter, setWorktreeFilter] = useState<string>(ALL_WORKTREES);
  const worktree = worktreeFilter === ALL_WORKTREES ? undefined : worktreeFilter;
  const { data } = useInbox(worktree);
  const state = useHerdrState();
  const { send } = useHerdrStoreActions();
  const navigate = useNavigate();
  const { openLocation } = useOpenWorktreeLocation();
  const queryClient = useQueryClient();
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());

  const worktreeRoots = useMemo(
    () => [...new Set(state.repos.flatMap((r) => r.worktrees.map((w) => w.root)))],
    [state.repos],
  );

  const bySection = useMemo(() => {
    const grouped = new Map<InboxSection, InboxItem[]>();
    for (const item of data?.items ?? []) {
      const list = grouped.get(item.section) ?? [];
      list.push(item);
      grouped.set(item.section, list);
    }
    return grouped;
  }, [data]);

  const nonEmptySections = SECTION_ORDER.filter((s) => (bySection.get(s)?.length ?? 0) > 0);

  function close() {
    onOpenChange(false);
  }

  async function resend(item: UndeliveredItem) {
    setBusyIds((prev) => new Set(prev).add(item.id));
    try {
      if (item.kind === "review") await reviewApi.notify(item.id);
      else if (item.kind === "ask") await askApi.resend(item.id);
      else await decisionApi.resend(item.id);
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  function handleRowClick(item: InboxItem) {
    if (item.section === "undelivered") {
      if (item.kind !== "decision") return;
      void navigate({
        to: "/focus/$tab",
        params: { tab: "decisions" },
        search: (prev) => ({ ...prev, id: item.id }),
      });
      close();
      return;
    }
    if (item.section === "replied") {
      openLocation({
        worktreeRoot: item.worktreeRoot,
        path: item.location.path,
        line: item.location.line,
        tab: item.kind === "review" ? "diff" : "files",
      });
      close();
      return;
    }
    if (item.section === "unsent") {
      openLocation({ worktreeRoot: item.worktreeRoot, tab: "diff" });
      close();
      return;
    }
    send({ type: "focus-pane", pane: item.paneId });
    close();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-[760px]"
        data-testid="inbox-dialog"
      >
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <InboxIcon className="size-4" aria-hidden="true" />
          <span className="font-semibold">Inbox</span>
          {data && <Badge variant="outline">{data.counts.total}</Badge>}
          <Select value={worktreeFilter} onValueChange={setWorktreeFilter}>
            <SelectTrigger
              size="sm"
              className="ml-2 h-7 flex-1 text-xs"
              aria-label="worktree で絞り込み"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_WORKTREES}>すべての worktree</SelectItem>
              {worktreeRoots.map((root) => (
                <SelectItem key={root} value={root}>
                  {basename(root)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <kbd className="rounded border px-1 text-[10px] text-muted-foreground">⌘I</kbd>
          <DialogClose aria-label="閉じる" className="rounded-md p-1 hover:bg-muted">
            <X className="size-4" />
          </DialogClose>
        </div>

        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
          {nonEmptySections.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              いま対応が必要なものはありません
            </p>
          )}
          {nonEmptySections.map((section) => {
            const items = bySection.get(section) ?? [];
            return (
              <section key={section} data-testid={`inbox-section-${section}`}>
                <header className="flex items-center gap-2 border-l-2 pl-2 text-xs font-semibold text-muted-foreground">
                  <span>{SECTION_LABEL[section]}</span>
                  <Badge variant="outline">{items.length}</Badge>
                </header>
                <ul>
                  {items.map((item) => {
                    const clickable = isRowClickable(item);
                    return (
                      <li
                        key={inboxRowKey(item)}
                        role={clickable ? "button" : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        data-testid="inbox-row"
                        data-inbox-section={item.section}
                        onClick={clickable ? () => handleRowClick(item) : undefined}
                        className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted"
                      >
                        <KindIcon kind={item.kind} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{rowTitle(item)}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {rowDetail(item)}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {rowMeta(item)}
                          </p>
                        </div>
                        {item.section === "undelivered" && (
                          <div onClick={(e) => e.stopPropagation()}>
                            <DeliveryChip
                              delivery={deliveryResultFor(item)}
                              busy={busyIds.has(item.id)}
                              onResend={() => resend(item)}
                            />
                          </div>
                        )}
                        {clickable && (
                          <ArrowRight
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
