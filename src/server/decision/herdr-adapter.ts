import { sendAgentPrompt } from "../herdr/agent-prompt";
import type { HerdrGateway } from "../herdr/gateway";
import type { HerdrStateStore } from "../herdr/state";
import type { WorktreeResolver } from "../herdr/tree";
import { resolveWhoami } from "../herdr/whoami";
import type { DecisionNotifier, WhoamiResolver } from "./ports";

export type HerdrDecisionAdapterDeps = {
  state: HerdrStateStore;
  gateway: HerdrGateway;
  resolver: WorktreeResolver;
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

/** F13-3: 作成時の呼び出し元解決 (`/api/hw/whoami` と同じ実装)。 */
export function createHerdrWhoamiResolver(deps: {
  state: HerdrStateStore;
  resolver: WorktreeResolver;
}): WhoamiResolver {
  return {
    async resolve(paneId) {
      const info = await resolveWhoami(deps, paneId);
      if (!info) return null;
      return { worktreeRoot: info.worktreeRoot, repoKey: info.repoKey, agent: info.agent };
    },
  };
}
