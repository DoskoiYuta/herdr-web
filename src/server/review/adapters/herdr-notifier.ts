import type { PaneInfo } from "../../../contract/herdr";
import type { HerdrGateway } from "../../herdr/gateway";
import type { HerdrStateStore } from "../../herdr/state";
import type { WorktreeResolver } from "../../herdr/tree";
import type { AgentNotifier } from "../ports";

export type HerdrNotifierDeps = {
  state: HerdrStateStore;
  gateway: HerdrGateway;
  resolver: WorktreeResolver;
  /** `{count}` を件数に置換する */
  template: string;
  logger?: Pick<typeof console, "warn" | "error">;
};

function effectiveCwd(pane: PaneInfo): string | null {
  return pane.foreground_cwd ?? pane.cwd ?? null;
}

/**
 * plan §6.5 通知先: レビューの worktree を foreground_cwd に持つ pane だけを候補にする。
 * 他の worktree にいる pane は、その HEAD がレビューの commit を含んでいても対象にならない
 * — 別ワークスペースの agent へ黙って送ってしまうのを避けるため。
 */
export function createHerdrNotifier(deps: HerdrNotifierDeps): AgentNotifier {
  const logger = deps.logger ?? console;

  async function panesAt(worktreeRoot: string): Promise<PaneInfo[]> {
    const s = deps.state.get();
    const result: PaneInfo[] = [];
    for (const pane of s.panes.values()) {
      if (!pane.agent) continue;
      const cwd = effectiveCwd(pane);
      if (!cwd) continue;
      const info = await deps.resolver.resolve(cwd).catch(() => null);
      if (!info || info.root !== worktreeRoot) continue;
      result.push(pane);
    }
    return result;
  }

  return {
    async targetsAt(worktreeRoot) {
      const panes = await panesAt(worktreeRoot);
      const focusedId = deps.state.get().focusedPaneId;
      return panes.map((p) => ({ pane: p.pane_id, focused: p.pane_id === focusedId }));
    },

    async notify({ worktreeRoot, reviewIds, pane }) {
      const panes = await panesAt(worktreeRoot);
      if (panes.length === 0) return { result: "no_target", pane: null };

      let target: PaneInfo | undefined;
      if (pane) {
        target = panes.find((p) => p.pane_id === pane);
        if (!target) return { result: "no_target", pane: null };
      } else {
        const focusedId = deps.state.get().focusedPaneId;
        target = panes.find((p) => p.pane_id === focusedId) ?? panes[0]!;
      }

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
