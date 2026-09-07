import type { Anchor, Review } from "../../contract/review";
import type { Ask, AskPromptState, AskSession } from "../../contract/ask";
import type { Decision, DecisionDeliveryState } from "../../contract/decision";
import type { InboxItem, InboxResponse, InboxSection } from "../../contract/inbox";
import type { NotifyState } from "../../contract/review";
import type { AskRepository } from "../ask/ports";
import type { DecisionRepository } from "../decision/ports";
import type { HerdrState, HerdrStateStore } from "../herdr/state";
import { livePanes, type WorktreeInfo, type WorktreeResolver } from "../herdr/tree";
import type { ReviewRepository } from "../review/ports";

export type InboxServiceDeps = {
  reviewRepository: ReviewRepository;
  askRepository: AskRepository;
  decisionRepository: DecisionRepository;
  /** `get()` だけ使う（tree.ts が使うのと同じ経路）。 */
  state: Pick<HerdrStateStore, "get">;
  resolver: WorktreeResolver;
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
    location: { path: review.path, line: review.anchor.lineHint },
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
    location: { path: review.path, line: review.anchor.lineHint },
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
    const [reviews, asks, decisions] = await Promise.all([
      deps.reviewRepository.list({}),
      deps.askRepository.list({}),
      deps.decisionRepository.list({}),
    ]);

    const items: InboxItem[] = [];

    for (const review of reviews) {
      if (review.status !== "open" && review.status !== "replied") continue;
      if (!UNDELIVERED_NOTIFY_STATES.has(review.notify.state)) continue;
      items.push(reviewUndeliveredItem(review, state));
    }
    for (const ask of asks) {
      if (ask.status !== "open" && ask.status !== "replied") continue;
      if (!ask.lastPrompt || !UNDELIVERED_ASK_PROMPT_STATES.has(ask.lastPrompt.state)) continue;
      items.push(askUndeliveredItem(ask, state));
    }
    for (const decision of decisions) {
      if (decision.status !== "answered" && decision.status !== "dismissed") continue;
      if (!decision.delivery) continue;
      if (!UNDELIVERED_DECISION_DELIVERY_STATES.has(decision.delivery.state)) continue;
      items.push(decisionUndeliveredItem(decision));
    }

    for (const review of reviews) {
      if (review.status !== "replied") continue;
      items.push(reviewRepliedItem(review, state));
    }
    for (const ask of asks) {
      if (ask.status !== "replied") continue;
      items.push(askRepliedItem(ask, state));
    }

    const draftsByWorktree = new Map<string, { repoKey: string; count: number; at: string }>();
    for (const review of reviews) {
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
    const cwds = new Set<string>();
    for (const pane of blockedPanes) {
      const cwd = pane.foreground_cwd ?? pane.cwd ?? null;
      if (cwd) cwds.add(cwd);
    }
    const resolved = new Map<string, WorktreeInfo | null>();
    await Promise.all(
      [...cwds].map(async (cwd) => {
        resolved.set(cwd, await deps.resolver.resolve(cwd).catch(() => null));
      }),
    );
    for (const pane of blockedPanes) {
      const cwd = pane.foreground_cwd ?? pane.cwd ?? null;
      const info = cwd ? (resolved.get(cwd) ?? null) : null;
      items.push({
        section: "blocked",
        kind: "agent",
        paneId: pane.pane_id,
        agent: pane.agent ?? null,
        label: pane.label ?? null,
        workspaceLabel: state.workspaces.get(pane.workspace_id)?.label ?? null,
        tabLabel: state.tabs.get(pane.tab_id)?.label ?? null,
        worktreeRoot: info?.root ?? null,
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
