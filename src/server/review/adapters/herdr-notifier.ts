import type { PaneInfo } from "../../../contract/herdr";
import { sendAgentPrompt } from "../../herdr/agent-prompt";
import type { HerdrGateway } from "../../herdr/gateway";
import { effectiveCwd, type HerdrStateStore } from "../../herdr/state";
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
      const cwd = effectiveCwd(s, pane);
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
      const result = await sendAgentPrompt({ gateway: deps.gateway, logger }, target.pane_id, text);
      return { result, pane: target.pane_id };
    },
  };
}
