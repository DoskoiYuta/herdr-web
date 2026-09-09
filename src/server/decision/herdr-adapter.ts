import { sendAgentPrompt } from "../herdr/agent-prompt";
import type { HerdrGateway } from "../herdr/gateway";
import type { SubRepoLike, WorktreeEntryLike } from "../herdr/pane-worktree";
import type { HerdrStateStore } from "../herdr/state";
import type { WorktreeResolver } from "../herdr/tree";
import { resolveWhoami } from "../herdr/whoami";
import type { DecisionAlerter, DecisionNotifier, WhoamiResolver } from "./ports";

export type HerdrDecisionAdapterDeps = {
  state: HerdrStateStore;
  gateway: HerdrGateway;
  resolver: WorktreeResolver;
  listWorktrees(repoPath: string): Promise<WorktreeEntryLike[]>;
  listSubRepos(root: string): Promise<SubRepoLike[]>;
  logger?: Pick<typeof console, "warn" | "error">;
};

/** F13-9: pane が消えていれば `gone`。存在すれば共通の agent-prompt 送信に委ねる。 */
export function createHerdrDecisionNotifier(deps: HerdrDecisionAdapterDeps): DecisionNotifier {
  return {
    async deliver(paneId, text) {
      if (!paneId) return { state: "gone", pane: null };
      if (!deps.state.get().panes.has(paneId)) return { state: "gone", pane: null };
      const state = await sendAgentPrompt(
        { gateway: deps.gateway, logger: deps.logger },
        paneId,
        text,
      );
      return { state, pane: paneId };
    },
  };
}

/** F13-11: herdr 未接続なら呼ばない。リクエスト自体の失敗もここで飲み込み、
 * 依頼の作成を失敗させない（トーストはあくまで付加的な通知）。 */
export function createHerdrDecisionAlerter(deps: {
  gateway: HerdrGateway;
  logger?: Pick<typeof console, "warn">;
}): DecisionAlerter {
  return {
    async show(params) {
      if (!deps.gateway.status().connected) return;
      try {
        await deps.gateway.notificationShow(params);
      } catch (err) {
        deps.logger?.warn(`herdr: notification.show failed: ${String(err)}`);
      }
    },
  };
}

/** F13-3: 作成時の呼び出し元解決 (`/api/hw/whoami` と同じ実装)。 */
export function createHerdrWhoamiResolver(deps: {
  state: HerdrStateStore;
  resolver: WorktreeResolver;
  listWorktrees(repoPath: string): Promise<WorktreeEntryLike[]>;
  listSubRepos(root: string): Promise<SubRepoLike[]>;
}): WhoamiResolver {
  return {
    async resolve(paneId) {
      const info = await resolveWhoami(deps, paneId);
      if (!info) return null;
      return { worktreeRoot: info.worktreeRoot, repoKey: info.repoKey, agent: info.agent };
    },
  };
}
