import type { PaneInfo } from "../../../contract/herdr";
import { sendAgentPrompt } from "../../herdr/agent-prompt";
import type { HerdrGateway } from "../../herdr/gateway";
import {
  resolvePaneWorktree,
  type SubRepoLike,
  type WorktreeEntryLike,
} from "../../herdr/pane-worktree";
import type { HerdrStateStore } from "../../herdr/state";
import type { WorktreeResolver } from "../../herdr/tree";
import type { AgentNotifier } from "../ports";

export type HerdrNotifierDeps = {
  state: HerdrStateStore;
  gateway: HerdrGateway;
  resolver: WorktreeResolver;
  listWorktrees(repoPath: string): Promise<WorktreeEntryLike[]>;
  listSubRepos(root: string): Promise<SubRepoLike[]>;
  /** `{count}` を件数に置換する */
  template: string;
  logger?: Pick<typeof console, "warn" | "error">;
};

/**
 * ui-redesign.md §10.6 通知先: 第 1 候補はその worktree（サブリポジトリ選択中
 * ならサブリポジトリの実効 root）を実際に選択しているワークスペースの agent
 * pane。0 件なら実効 repoKey が一致する agent pane 全体にフォールバックする
 * — 別の worktree にいる pane へ黙って送ってしまうのを避けつつ、選択を
 * ずらしただけの pane も候補から漏らさない。
 */
export function createHerdrNotifier(deps: HerdrNotifierDeps): AgentNotifier {
  const logger = deps.logger ?? console;

  async function effectiveOf(pane: PaneInfo): Promise<{ root: string; repoKey: string } | null> {
    const resolved = await resolvePaneWorktree(deps, pane).catch(() => null);
    if (!resolved) return null;
    return resolved.subRepo
      ? { root: resolved.subRepo.root, repoKey: resolved.subRepo.repoKey }
      : { root: resolved.worktreeRoot, repoKey: resolved.repoKey };
  }

  async function agentPanesWithEffective(): Promise<
    { pane: PaneInfo; effective: { root: string; repoKey: string } }[]
  > {
    const s = deps.state.get();
    const result: { pane: PaneInfo; effective: { root: string; repoKey: string } }[] = [];
    for (const pane of s.panes.values()) {
      if (!pane.agent) continue;
      const effective = await effectiveOf(pane);
      if (effective) result.push({ pane, effective });
    }
    return result;
  }

  async function panesAt(worktreeRoot: string): Promise<PaneInfo[]> {
    const candidates = await agentPanesWithEffective();
    const exact = candidates.filter((c) => c.effective.root === worktreeRoot);
    if (exact.length > 0) return exact.map((c) => c.pane);

    const repoInfo = await deps.resolver.resolve(worktreeRoot).catch(() => null);
    if (!repoInfo) return [];
    return candidates.filter((c) => c.effective.repoKey === repoInfo.commonDir).map((c) => c.pane);
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
