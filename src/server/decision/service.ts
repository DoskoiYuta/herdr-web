import { err, ok, type Result } from "neverthrow";
import type {
  CreateDecisionRequest,
  Decision,
  DecisionAnswer,
  DecisionCounts,
} from "../../contract/decision";
import { createLocks, type Locks } from "../review/usecases/locks";
import type { DeliveryScheduler } from "./delivery-scheduler";
import type {
  Clock,
  DecisionAlerter,
  DecisionEvents,
  DecisionListFilter,
  DecisionRepository,
  WhoamiResolver,
} from "./ports";
import { validateDecisionAnswer } from "./validate-answer";

export type NotFoundError = { type: "not_found"; message: string };
function notFound(message: string): NotFoundError {
  return { type: "not_found", message };
}

export type InvalidStatusError = { type: "invalid_status"; message: string };
function invalidStatus(message: string): InvalidStatusError {
  return { type: "invalid_status", message };
}

export type ValidationError = { type: "validation"; message: string };
function validationError(message: string): ValidationError {
  return { type: "validation", message };
}

export type DecisionServiceDeps = {
  repository: DecisionRepository;
  whoami: WhoamiResolver;
  delivery: DeliveryScheduler;
  clock: Clock;
  events: DecisionEvents;
  alerter: DecisionAlerter;
  generateId?: () => string;
  locks?: Locks;
};

/** F13-11: 依頼の title、無ければ最初の設問の header。 */
function alertTitle(spec: CreateDecisionRequest["spec"]): string {
  return `判断依頼: ${spec.title ?? spec.items[0]?.header ?? ""}`;
}

function worktreeBasename(root: string | null): string | null {
  if (!root) return null;
  const trimmed = root.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function createDecisionService(deps: DecisionServiceDeps) {
  const locks = deps.locks ?? createLocks();
  const generateId = deps.generateId ?? (() => Bun.randomUUIDv7());

  async function createDecision(
    req: CreateDecisionRequest,
  ): Promise<Decision & { paneResolved: boolean }> {
    const id = generateId();
    const now = deps.clock.now().toISOString();

    let worktreeRoot: string | null = null;
    let repoKey: string | null = null;
    let agent: string | null = null;
    let paneResolved = false;
    if (req.paneId) {
      const info = await deps.whoami.resolve(req.paneId);
      if (info) {
        worktreeRoot = info.worktreeRoot;
        repoKey = info.repoKey;
        agent = info.agent;
        paneResolved = true;
      }
    }

    const decision: Decision = {
      id,
      status: "open",
      spec: req.spec,
      answer: null,
      paneId: req.paneId,
      claudeSessionId: req.claudeSessionId,
      worktreeRoot,
      repoKey,
      agent,
      createdAt: now,
      answeredAt: null,
      delivery: null,
    };
    await deps.repository.save(decision);
    deps.events.emit({ type: "decision", action: "created", id, worktreeRoot, paneId: req.paneId });
    await deps.alerter.show({
      title: alertTitle(req.spec),
      body: `${agent ?? "?"} / ${worktreeBasename(worktreeRoot) ?? "?"}。Web UI で回答してください`,
    });
    return { ...decision, paneResolved };
  }

  async function answerDecision(
    id: string,
    answer: DecisionAnswer,
  ): Promise<Result<Decision, NotFoundError | InvalidStatusError | ValidationError>> {
    return locks.withLock(`decision:${id}`, async () => {
      const decision = await deps.repository.get(id);
      if (!decision) return err(notFound(`decision ${id} not found`));
      if (decision.status !== "open") {
        return err(invalidStatus(`decision ${id} is ${decision.status}, not open`));
      }
      const problem = validateDecisionAnswer(decision.spec, answer);
      if (problem) return err(validationError(problem));
      const now = deps.clock.now().toISOString();
      const updated: Decision = { ...decision, status: "answered", answer, answeredAt: now };
      await deps.repository.save(updated);
      deps.events.emit({
        type: "decision",
        action: "answered",
        id,
        worktreeRoot: decision.worktreeRoot,
        paneId: decision.paneId,
      });
      deps.delivery.scheduleDelivery(id);
      return ok(updated);
    });
  }

  async function dismissDecision(
    id: string,
  ): Promise<Result<Decision, NotFoundError | InvalidStatusError>> {
    return locks.withLock(`decision:${id}`, async () => {
      const decision = await deps.repository.get(id);
      if (!decision) return err(notFound(`decision ${id} not found`));
      if (decision.status !== "open") {
        return err(invalidStatus(`decision ${id} is ${decision.status}, not open`));
      }
      const updated: Decision = { ...decision, status: "dismissed" };
      await deps.repository.save(updated);
      deps.events.emit({
        type: "decision",
        action: "dismissed",
        id,
        worktreeRoot: decision.worktreeRoot,
        paneId: decision.paneId,
      });
      deps.delivery.scheduleDelivery(id);
      return ok(updated);
    });
  }

  async function cancelDecision(
    id: string,
  ): Promise<Result<Decision, NotFoundError | InvalidStatusError>> {
    return locks.withLock(`decision:${id}`, async () => {
      const decision = await deps.repository.get(id);
      if (!decision) return err(notFound(`decision ${id} not found`));
      if (decision.status !== "open") {
        return err(invalidStatus(`decision ${id} is ${decision.status}, not open`));
      }
      const updated: Decision = { ...decision, status: "cancelled" };
      await deps.repository.save(updated);
      deps.events.emit({
        type: "decision",
        action: "cancelled",
        id,
        worktreeRoot: decision.worktreeRoot,
        paneId: decision.paneId,
      });
      return ok(updated);
    });
  }

  /** F13-8: 再送できるのは answered/dismissed かつ直近の配達が `sent` でないときだけ。 */
  function canResend(decision: Decision): boolean {
    if (decision.status !== "answered" && decision.status !== "dismissed") return false;
    return decision.delivery?.state !== "sent";
  }

  async function resendDecision(
    id: string,
  ): Promise<Result<Decision, NotFoundError | InvalidStatusError>> {
    const decision = await deps.repository.get(id);
    if (!decision) return err(notFound(`decision ${id} not found`));
    if (!canResend(decision)) {
      return err(invalidStatus(`decision ${id} cannot be resent (status=${decision.status})`));
    }
    await deps.delivery.resend(id);
    const updated = await deps.repository.get(id);
    return ok(updated ?? decision);
  }

  async function listDecisions(filter: DecisionListFilter): Promise<Decision[]> {
    return deps.repository.list(filter);
  }

  async function getDecision(id: string): Promise<Decision | null> {
    return deps.repository.get(id);
  }

  async function counts(): Promise<DecisionCounts> {
    const open = await deps.repository.list({ status: ["open"] });
    return { total: open.length };
  }

  return {
    createDecision,
    answerDecision,
    dismissDecision,
    cancelDecision,
    resendDecision,
    listDecisions,
    getDecision,
    counts,
  };
}

export type DecisionService = ReturnType<typeof createDecisionService>;
