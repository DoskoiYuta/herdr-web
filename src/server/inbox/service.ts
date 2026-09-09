import type { Anchor, Review } from "../../contract/review";
import type { Ask, AskPromptState, AskSession } from "../../contract/ask";
import type { Decision, DecisionDeliveryState } from "../../contract/decision";
import type { InboxItem, InboxLocation, InboxResponse, InboxSection } from "../../contract/inbox";
import type { NotifyState } from "../../contract/review";
import type { AskRepository } from "../ask/ports";
import type { DecisionRepository } from "../decision/ports";
import {
  resolvePaneWorktree,
  type ResolvedPaneWorktree,
  type SubRepoLike,
  type WorktreeEntryLike,
} from "../herdr/pane-worktree";
import type { HerdrState, HerdrStateStore } from "../herdr/state";
import { livePanes, type WorktreeResolver } from "../herdr/tree";
import type { ReviewRepository } from "../review/ports";

export type InboxServiceDeps = {
  reviewRepository: ReviewRepository;
  askRepository: AskRepository;
  decisionRepository: DecisionRepository;
  /** `resolvePaneWorktree` にも渡すため `getSelection`/`setSelection` も要る。 */
  state: Pick<HerdrStateStore, "get" | "getSelection" | "setSelection">;
  resolver: WorktreeResolver;
  listWorktrees(repoPath: string): Promise<WorktreeEntryLike[]>;
  listSubRepos(root: string): Promise<SubRepoLike[]>;
};

const UNDELIVERED_NOTIFY_STATES = new Set<NotifyState>(["agent_blocked", "no_target", "unknown"]);
const UNDELIVERED_DECISION_DELIVERY_STATES = new Set<DecisionDeliveryState>([
  "agent_blocked",
  "gone",
  "unknown",
]);
const UNDELIVERED_ASK_PROMPT_STATES = new Set<AskPromptState>(["agent_blocked", "gone", "failed"]);

const SECTION_ORDER: InboxSection[] = ["undelivered", "replied", "unsent", "blocked"];

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

/** `path:L10` / `path:L10–12`（複数行選択時）。 */
function locationTitle(path: string, anchor: Anchor): string {
  const start = anchor.lineHint;
  const end = start + anchor.lines.length - 1;
  return end > start ? `${path}:L${start}–${end}` : `${path}:L${start}`;
}

/**
 * review の location は anchor.side と（commit ターゲットなら）比較範囲を
 * 持たせる — ToolPane の Diff 初期表示は search の side が無いと "new" 側に
 * フォールバックするため、old 側にコメントした review はこれが無いと無関係な
 * 行を開いてしまう。commit ターゲットは Graph → Diff 遷移と同じ `parent..hash`
 * の形（親は `hash~1` で表す — 実 parent hash を引く GitHistory 依存を持ち込まない）。
 */
function reviewLocation(review: Review): InboxLocation {
  const base: InboxLocation = {
    path: review.path,
    line: review.anchor.lineHint,
    side: review.anchor.side,
  };
  if (review.target.kind === "commit") {
    return { ...base, from: `${review.target.hash}~1`, to: review.target.hash };
  }
  return base;
}

function agentForPane(state: HerdrState, paneId: string | null): string | null {
  if (!paneId) return null;
  return state.panes.get(paneId)?.agent ?? null;
}

/** ask の専用ワークスペースは id が変わるので label で毎回引き直す（ask/ports.ts と同じ規則）。 */
function agentForAskSession(state: HerdrState, session: AskSession | null): string | null {
  if (!session) return null;
  if (session.kind === "pane") return agentForPane(state, session.paneId);
  for (const workspace of state.workspaces.values()) {
    if (workspace.label !== session.label) continue;
    for (const pane of state.panes.values()) {
      if (pane.workspace_id === workspace.workspace_id) return pane.agent ?? null;
    }
  }
  return null;
}

function reviewUndeliveredItem(review: Review, state: HerdrState): InboxItem {
  const lastEntry = review.thread.at(-1);
  return {
    section: "undelivered",
    kind: "review",
    id: review.id,
    title: locationTitle(review.path, review.anchor),
    detail: lastEntry ? truncate(lastEntry.body, 120) : "",
    worktreeRoot: review.worktreeRoot,
    repoKey: review.repo,
    agent: agentForPane(state, review.notify.pane),
    at: review.notify.at ?? review.updatedAt,
    delivery: { state: review.notify.state, canResend: true },
    location: reviewLocation(review),
  };
}

function askUndeliveredItem(ask: Ask, state: HerdrState): InboxItem {
  const lastEntry = ask.thread.at(-1);
  const lastPrompt = ask.lastPrompt!;
  return {
    section: "undelivered",
    kind: "ask",
    id: ask.id,
    title: locationTitle(ask.path, ask.anchor),
    detail: lastEntry ? truncate(lastEntry.body, 120) : "",
    worktreeRoot: ask.worktreeRoot,
    repoKey: ask.repo,
    agent: agentForAskSession(state, ask.session),
    at: lastPrompt.at,
    delivery: { state: lastPrompt.state, canResend: true },
    location: { path: ask.path, line: ask.anchor.lineHint },
  };
}

function decisionUndeliveredItem(decision: Decision): InboxItem {
  const delivery = decision.delivery!;
  const firstItem = decision.spec.items[0];
  return {
    section: "undelivered",
    kind: "decision",
    id: decision.id,
    title: decision.spec.title ?? firstItem?.header ?? "",
    detail: truncate(firstItem?.question ?? "", 120),
    worktreeRoot: decision.worktreeRoot,
    repoKey: decision.repoKey,
    agent: decision.agent,
    at: delivery.at,
    delivery: { state: delivery.state, canResend: true },
  };
}

function reviewRepliedItem(review: Review, state: HerdrState): InboxItem {
  const lastAgentEntry = [...review.thread].reverse().find((e) => e.author === "agent");
  return {
    section: "replied",
    kind: "review",
    id: review.id,
    title: locationTitle(review.path, review.anchor),
    excerpt: lastAgentEntry ? truncate(lastAgentEntry.body, 120) : "",
    worktreeRoot: review.worktreeRoot,
    repoKey: review.repo,
    agent: agentForPane(state, review.notify.pane),
    at: review.updatedAt,
    location: reviewLocation(review),
  };
}

function askRepliedItem(ask: Ask, state: HerdrState): InboxItem {
  const lastAgentEntry = [...ask.thread].reverse().find((e) => e.author === "agent");
  return {
    section: "replied",
    kind: "ask",
    id: ask.id,
    title: locationTitle(ask.path, ask.anchor),
    excerpt: lastAgentEntry ? truncate(lastAgentEntry.body, 120) : "",
    worktreeRoot: ask.worktreeRoot,
    repoKey: ask.repo,
    agent: agentForAskSession(state, ask.session),
    at: ask.updatedAt,
    location: { path: ask.path, line: ask.anchor.lineHint },
  };
}

function itemWorktreeRoot(item: InboxItem): string | null {
  return item.worktreeRoot;
}

function itemAt(item: InboxItem): string | null {
  return item.at;
}

export function createInboxService(deps: InboxServiceDeps) {
  async function getInbox(worktree?: string): Promise<InboxResponse> {
    const state = deps.state.get();
    // review/ask の undelivered ∪ replied は status: open/replied のみ必要 — DB
    // 側でも絞る。unsent（下書き）は resolved 等にも付きうるので別クエリにし、
    // status は絞らない（既存の countsUsecase の pendingDrafts と同じ考え方）。
    const [reviewsForThread, reviewsForDrafts, asks, decisions] = await Promise.all([
      deps.reviewRepository.list({ status: ["open", "replied"], worktreeRoot: worktree }),
      deps.reviewRepository.list({ worktreeRoot: worktree }),
      deps.askRepository.list({ status: ["open", "replied"], worktreeRoot: worktree }),
      deps.decisionRepository.list({ status: ["answered", "dismissed"], worktreeRoot: worktree }),
    ]);

    const items: InboxItem[] = [];

    for (const review of reviewsForThread) {
      // status === "replied" はエージェントが自力で返信済み — 通知の成否に
      // 関わらず「返信が届いた」だけに出す（undelivered との二重表示を避ける）。
      if (review.status !== "open") continue;
      if (!UNDELIVERED_NOTIFY_STATES.has(review.notify.state)) continue;
      items.push(reviewUndeliveredItem(review, state));
    }
    for (const ask of asks) {
      if (ask.status !== "open") continue;
      if (!ask.lastPrompt || !UNDELIVERED_ASK_PROMPT_STATES.has(ask.lastPrompt.state)) continue;
      items.push(askUndeliveredItem(ask, state));
    }
    for (const decision of decisions) {
      if (!decision.delivery) continue;
      if (!UNDELIVERED_DECISION_DELIVERY_STATES.has(decision.delivery.state)) continue;
      items.push(decisionUndeliveredItem(decision));
    }

    for (const review of reviewsForThread) {
      if (review.status !== "replied") continue;
      items.push(reviewRepliedItem(review, state));
    }
    for (const ask of asks) {
      if (ask.status !== "replied") continue;
      items.push(askRepliedItem(ask, state));
    }

    const draftsByWorktree = new Map<string, { repoKey: string; count: number; at: string }>();
    for (const review of reviewsForDrafts) {
      if (!review.thread.some((e) => e.draft)) continue;
      const existing = draftsByWorktree.get(review.worktreeRoot);
      if (existing) {
        existing.count += 1;
        if (review.updatedAt > existing.at) existing.at = review.updatedAt;
      } else {
        draftsByWorktree.set(review.worktreeRoot, {
          repoKey: review.repo,
          count: 1,
          at: review.updatedAt,
        });
      }
    }
    for (const [worktreeRoot, entry] of draftsByWorktree) {
      items.push({
        section: "unsent",
        kind: "review",
        worktreeRoot,
        repoKey: entry.repoKey,
        count: entry.count,
        at: entry.at,
      });
    }

    const blockedPanes = livePanes(state).filter((p) => p.agent_status === "blocked");
    const resolved = new Map<string, ResolvedPaneWorktree | null>();
    await Promise.all(
      blockedPanes.map(async (pane) => {
        resolved.set(pane.pane_id, await resolvePaneWorktree(deps, pane).catch(() => null));
      }),
    );
    for (const pane of blockedPanes) {
      const info = resolved.get(pane.pane_id) ?? null;
      items.push({
        section: "blocked",
        kind: "agent",
        paneId: pane.pane_id,
        agent: pane.agent ?? null,
        label: pane.label ?? null,
        workspaceLabel: state.workspaces.get(pane.workspace_id)?.label ?? null,
        tabLabel: state.tabs.get(pane.tab_id)?.label ?? null,
        worktreeRoot: info?.worktreeRoot ?? null,
        at: null,
      });
    }

    const filtered = worktree ? items.filter((item) => itemWorktreeRoot(item) === worktree) : items;

    const grouped = new Map<InboxSection, InboxItem[]>(SECTION_ORDER.map((s) => [s, []]));
    for (const item of filtered) grouped.get(item.section)!.push(item);
    for (const section of SECTION_ORDER) {
      grouped.get(section)!.sort((a, b) => (itemAt(b) ?? "").localeCompare(itemAt(a) ?? ""));
    }

    const orderedItems = SECTION_ORDER.flatMap((section) => grouped.get(section)!);
    const bySection = Object.fromEntries(
      SECTION_ORDER.map((section) => [section, grouped.get(section)!.length]),
    ) as Record<InboxSection, number>;

    return {
      items: orderedItems,
      counts: { total: orderedItems.length, bySection },
    };
  }

  return { getInbox };
}

export type InboxService = ReturnType<typeof createInboxService>;
