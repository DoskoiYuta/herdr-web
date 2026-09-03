import type { PaneInfo } from "../../../contract/herdr";
import type { HerdrGateway } from "../../herdr/gateway";
import type { HerdrStateStore } from "../../herdr/state";
import type { WorktreeResolver } from "../../herdr/tree";
import type { AgentNotifier, GitHistory } from "../ports";

export type HerdrNotifierDeps = {
  state: HerdrStateStore;
  gateway: HerdrGateway;
  resolver: WorktreeResolver;
  gitHistory: GitHistory;
  /** `{count}` を件数に置換する */
  template: string;
  logger?: Pick<typeof console, "warn" | "error">;
};

function effectiveCwd(pane: PaneInfo): string | null {
  return pane.foreground_cwd ?? pane.cwd ?? null;
}

/**
 * plan §6.5 通知先: レビューの worktree を foreground_cwd に持つ pane を探し、
 * フォーカス pane が含まれればそこへ、無ければ最初のエージェント pane へ agent.prompt する。
 * commit 付きの場合は、その commit を HEAD に含む worktree の pane も候補にする。通知先は保存しない。
 */
export function createHerdrNotifier(deps: HerdrNotifierDeps): AgentNotifier {
  const logger = deps.logger ?? console;

  async function candidates(worktreeRoot: string, commit: string | null): Promise<PaneInfo[]> {
    const s = deps.state.get();
    const byRoot = new Map<string, PaneInfo[]>();
    for (const pane of s.panes.values()) {
      if (!pane.agent) continue;
      const cwd = effectiveCwd(pane);
      if (!cwd) continue;
      const info = await deps.resolver.resolve(cwd).catch(() => null);
      if (!info) continue;
      const list = byRoot.get(info.root) ?? [];
      list.push(pane);
      byRoot.set(info.root, list);
    }
    const direct = byRoot.get(worktreeRoot) ?? [];
    if (direct.length > 0 || !commit) return direct;
    const viaCommit: PaneInfo[] = [];
    for (const [root, panes] of byRoot) {
      const head = await deps.gitHistory.headOf(root);
      if (head && (await deps.gitHistory.isAncestor(root, commit, head))) viaCommit.push(...panes);
    }
    return viaCommit;
  }

  return {
    async notify({ worktreeRoot, commit, reviewIds }) {
      const panes = await candidates(worktreeRoot, commit);
      if (panes.length === 0) return { result: "no_target", pane: null };
      const focusedId = deps.state.get().focusedPaneId;
      const target = panes.find((p) => p.pane_id === focusedId) ?? panes[0]!;
      const text = deps.template.replaceAll("{count}", String(reviewIds.length));
      try {
        const outcome = await deps.gateway.agentPrompt(target.pane_id, text);
        if (outcome.status === "sent") return { result: "sent", pane: target.pane_id };
        if (outcome.status === "agent_prompt_stalled") {
          // 送信自体は行われたので「未通知」扱いにはしない（再送すると二重になる）
          logger.warn(`notify: prompt to ${target.pane_id} stalled`);
          return { result: "sent", pane: target.pane_id };
        }
        return { result: "agent_blocked", pane: target.pane_id };
      } catch (err) {
        // F7: a transport-level timeout means we genuinely don't know whether
        // the prompt was ever sent — "agent_blocked" would be a false claim
        // that herdr rejected it, and would mislead a human into not retrying.
        if (err instanceof Error && /timed out/i.test(err.message)) {
          logger.error("notify: agent.prompt timed out", err);
          return { result: "unknown", pane: target.pane_id };
        }
        logger.error("notify: agent.prompt failed", err);
        return { result: "agent_blocked", pane: target.pane_id };
      }
    },
  };
}
