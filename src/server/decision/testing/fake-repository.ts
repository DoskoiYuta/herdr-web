import type { Decision } from "../../../contract/decision";
import type { DecisionListFilter, DecisionRepository } from "../ports";

export class FakeDecisionRepository implements DecisionRepository {
  decisions = new Map<string, Decision>();

  async get(id: string): Promise<Decision | null> {
    return this.decisions.get(id) ?? null;
  }

  async list(filter: DecisionListFilter): Promise<Decision[]> {
    return [...this.decisions.values()].filter((d) => {
      if (filter.status && !filter.status.includes(d.status)) return false;
      if (filter.worktreeRoot && d.worktreeRoot !== filter.worktreeRoot) return false;
      return true;
    });
  }

  async save(decision: Decision): Promise<void> {
    this.decisions.set(decision.id, decision);
  }
}
