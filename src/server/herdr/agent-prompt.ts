import type { HerdrGateway } from "./gateway";

export type AgentPromptOutcome = "sent" | "agent_blocked" | "unknown";

export type SendAgentPromptDeps = {
  gateway: HerdrGateway;
  logger?: Pick<typeof console, "warn" | "error">;
};

/**
 * Sends `agent.prompt` to a specific pane and interprets herdr's outcome into
 * the three-way result every notifier (review, decision) persists.
 * `agent_prompt_stalled` still means herdr accepted and delivered the text,
 * so it maps to "sent" — treating it as unsent would cause a double-send on
 * retry. A transport-level timeout means delivery is genuinely unknown, so it
 * maps to "unknown" rather than the false claim "agent_blocked" (which would
 * mislead a human into not retrying, or an automatic retry into double-send).
 */
export async function sendAgentPrompt(
  deps: SendAgentPromptDeps,
  paneId: string,
  text: string,
): Promise<AgentPromptOutcome> {
  const logger = deps.logger ?? console;
  try {
    const outcome = await deps.gateway.agentPrompt(paneId, text);
    if (outcome.status === "sent") return "sent";
    if (outcome.status === "agent_prompt_stalled") {
      logger.warn(`agent-prompt: prompt to ${paneId} stalled`);
      return "sent";
    }
    return "agent_blocked";
  } catch (err) {
    if (err instanceof Error && /timed out/i.test(err.message)) {
      logger.error("agent-prompt: agent.prompt timed out", err);
      return "unknown";
    }
    logger.error("agent-prompt: agent.prompt failed", err);
    return "agent_blocked";
  }
}
