import type { Ask } from "../../../contract/ask";
import type { AskListFilter, AskRepository } from "../ports";

export class FakeAskRepository implements AskRepository {
  asks = new Map<string, Ask>();

  async get(id: string): Promise<Ask | null> {
    return this.asks.get(id) ?? null;
  }

  async list(filter: AskListFilter): Promise<Ask[]> {
    return [...this.asks.values()].filter((a) => {
      if (filter.repo && a.repo !== filter.repo) return false;
      if (filter.worktreeRoot && a.worktreeRoot !== filter.worktreeRoot) return false;
      if (filter.status && !filter.status.includes(a.status)) return false;
      if (filter.path && a.path !== filter.path) return false;
      return true;
    });
  }

  async save(ask: Ask): Promise<void> {
    this.asks.set(ask.id, ask);
  }
}
