import { err, ok, type Result } from "neverthrow";
import type {
  Ask,
  AskCountsResponse,
  AskWithSession,
  CreateAskRequest,
  ForFileMatch,
  ForFileRequest,
} from "../../contract/ask";
import type { EntryAuthor } from "../../contract/review";
import { locateAnchor } from "../review/domain/anchor";
import type { Clock } from "../review/domain/clock";
import { createLocks, type Locks } from "../review/usecases/locks";
import type { AskListFilter, AskRepository, AskSessionLauncher, LaunchError } from "./ports";
import { renderAskPrompt, renderAskReplyPrompt } from "./prompt";

export type AskEventEmit = {
  emit(e: {
    type: "ask";
    action: "created" | "replied" | "resolved" | "reanchored";
    ask: Ask;
  }): void;
};

export type NotFoundError = { type: "not_found"; message: string };
function notFound(message: string): NotFoundError {
  return { type: "not_found", message };
}

export type AskServiceDeps = {
  repository: AskRepository;
  launcher: AskSessionLauncher;
  clock: Clock;
  events: AskEventEmit;
  /** 質問作成時のプロンプトテンプレート (config.ask.template) */
  template: string;
  /** ユーザー返信時に送るテンプレート (config.ask.replyTemplate) */
  replyTemplate: string;
  maxSessions: number;
  generateId?: () => string;
  locks?: Locks;
};

/** 1 ask あたり thread は seq 昇順、次の seq は末尾 + 1 (空なら 0) */
function nextSeq(ask: Pick<Ask, "thread">): number {
  const last = ask.thread.at(-1);
  return last ? last.seq + 1 : 0;
}

export function createAskService(deps: AskServiceDeps) {
  const locks = deps.locks ?? createLocks();

  async function activeHerdrSessionCount(): Promise<number> {
    const all = await deps.repository.list({});
    return all.filter((a) => a.session?.kind === "herdr" && a.status !== "resolved").length;
  }

  async function createAsk(req: CreateAskRequest): Promise<Result<Ask, LaunchError>> {
    const id = (deps.generateId ?? (() => Bun.randomUUIDv7()))();
    const now = deps.clock.now().toISOString();
    const prompt = renderAskPrompt(deps.template, {
      id,
      path: req.path,
      anchor: req.anchor,
      question: req.body,
    });
    const thread: Ask["thread"] = [
      { seq: 0, author: "user", body: req.body, at: now, agentSession: null },
    ];

    if (req.target.kind === "new") {
      const activeCount = await activeHerdrSessionCount();
      if (activeCount >= deps.maxSessions) {
        return err({ type: "limit_reached", limit: deps.maxSessions });
      }
      const label = `ask:${id.slice(-8)}`;
      const started = await deps.launcher.start({
        askId: id,
        worktreeRoot: req.worktreeRoot,
        label,
        prompt,
      });
      // Launch failure: nothing to clean up — the ask is deliberately not
      // persisted (plan.md F10: honest failure over a half-created ask).
      if (started.isErr()) return err(started.error);

      const ask: Ask = {
        id,
        repo: req.repo,
        worktreeRoot: req.worktreeRoot,
        path: req.path,
        anchor: req.anchor,
        createdAtHead: req.createdAtHead,
        status: "open",
        session: started.value,
        thread,
        lastPrompt: { state: "sent", at: now },
        createdAt: now,
        updatedAt: now,
      };
      await deps.repository.save(ask);
      deps.events.emit({ type: "ask", action: "created", ask });
      return ok(ask);
    }

    // target.kind === "pane": persisted even if the prompt fails to reach the pane.
    const session = { kind: "pane" as const, paneId: req.target.paneId };
    const promptResult = await deps.launcher.prompt(session, prompt);
    const ask: Ask = {
      id,
      repo: req.repo,
      worktreeRoot: req.worktreeRoot,
      path: req.path,
      anchor: req.anchor,
      createdAtHead: req.createdAtHead,
      status: "open",
      session,
      thread,
      lastPrompt: { state: promptResult.isOk() ? "sent" : promptResult.error.type, at: now },
      createdAt: now,
      updatedAt: now,
    };
    await deps.repository.save(ask);
    deps.events.emit({ type: "ask", action: "created", ask });
    return ok(ask);
  }

  async function replyAsk(input: {
    id: string;
    author: EntryAuthor;
    body: string;
    agentSession?: string | null;
  }): Promise<Result<Ask, NotFoundError>> {
    return locks.withLock(`ask:${input.id}`, async (): Promise<Result<Ask, NotFoundError>> => {
      const ask = await deps.repository.get(input.id);
      if (!ask) return err(notFound(`ask ${input.id} not found`));

      const now = deps.clock.now().toISOString();
      const entry = {
        seq: nextSeq(ask),
        author: input.author,
        body: input.body,
        at: now,
        agentSession: input.agentSession ?? null,
      };
      const nextStatus =
        input.author === "user" ? "open" : ask.status === "resolved" ? "resolved" : "replied";

      let updated: Ask = {
        ...ask,
        thread: [...ask.thread, entry],
        status: nextStatus,
        updatedAt: now,
      };

      if (input.author === "user" && ask.session) {
        const replyPrompt = renderAskReplyPrompt(deps.replyTemplate, ask.id);
        const promptResult = await deps.launcher.prompt(ask.session, replyPrompt);
        updated = {
          ...updated,
          lastPrompt: { state: promptResult.isOk() ? "sent" : promptResult.error.type, at: now },
        };
      }

      await deps.repository.save(updated);
      deps.events.emit({ type: "ask", action: "replied", ask: updated });
      return ok(updated);
    });
  }

  async function resolveAsk(id: string): Promise<Result<Ask, NotFoundError>> {
    return locks.withLock(`ask:${id}`, async (): Promise<Result<Ask, NotFoundError>> => {
      const ask = await deps.repository.get(id);
      if (!ask) return err(notFound(`ask ${id} not found`));

      const now = deps.clock.now().toISOString();
      const updated: Ask = { ...ask, status: "resolved", updatedAt: now };
      await deps.repository.save(updated);
      deps.events.emit({ type: "ask", action: "resolved", ask: updated });
      if (ask.session) await deps.launcher.close(ask.session);
      return ok(updated);
    });
  }

  async function listAsks(filter: AskListFilter): Promise<Ask[]> {
    return deps.repository.list(filter);
  }

  async function getAsk(id: string): Promise<Ask | null> {
    return deps.repository.get(id);
  }

  async function getAskWithSession(id: string): Promise<AskWithSession | null> {
    const ask = await deps.repository.get(id);
    if (!ask) return null;
    const sessionStatus = ask.session ? await deps.launcher.status(ask.session) : "gone";
    return { ...ask, sessionStatus };
  }

  async function forFile(req: ForFileRequest): Promise<ForFileMatch[]> {
    const list = await deps.repository.list({
      repo: req.repo,
      worktreeRoot: req.worktreeRoot,
      path: req.path,
    });
    const now = deps.clock.now().toISOString();
    const results: ForFileMatch[] = [];
    for (const ask of list) {
      // Resolved asks are done: they must disappear from the code view even
      // though the anchor still lives on for `hw ask list --all` / status filters.
      if (ask.status === "resolved") continue;
      const loc = locateAnchor(ask.anchor, req.lines);
      let current = ask;
      const matched = loc !== null;
      if (matched && ask.status === "outdated") {
        current = { ...ask, status: "open", updatedAt: now };
        await deps.repository.save(current);
        deps.events.emit({ type: "ask", action: "reanchored", ask: current });
      } else if (!matched && ask.status !== "outdated") {
        current = { ...ask, status: "outdated", updatedAt: now };
        await deps.repository.save(current);
        deps.events.emit({ type: "ask", action: "reanchored", ask: current });
      }
      results.push({
        ask: current,
        startLine: loc ? loc.line : null,
        endLine: loc ? loc.line + loc.span - 1 : null,
      });
    }
    return results;
  }

  async function counts(repo: string, worktree: string): Promise<AskCountsResponse> {
    const list = await deps.repository.list({ repo, worktreeRoot: worktree });
    const byPath: Record<string, number> = {};
    let unresolved = 0;
    let replied = 0;
    for (const ask of list) {
      if (ask.status === "replied") replied++;
      if (ask.status !== "open" && ask.status !== "replied") continue;
      unresolved++;
      byPath[ask.path] = (byPath[ask.path] ?? 0) + 1;
    }
    return { unresolved, byPath, replied };
  }

  async function focusSession(id: string): Promise<Result<void, NotFoundError>> {
    const ask = await deps.repository.get(id);
    if (!ask) return err(notFound(`ask ${id} not found`));
    if (ask.session) await deps.launcher.focus(ask.session);
    return ok(undefined);
  }

  async function resendPrompt(id: string): Promise<Result<Ask, NotFoundError>> {
    return locks.withLock(`ask:${id}`, async (): Promise<Result<Ask, NotFoundError>> => {
      const ask = await deps.repository.get(id);
      if (!ask) return err(notFound(`ask ${id} not found`));
      const lastUser = [...ask.thread].reverse().find((e) => e.author === "user");
      if (!lastUser || !ask.session) return ok(ask);

      const now = deps.clock.now().toISOString();
      const promptResult = await deps.launcher.prompt(ask.session, lastUser.body);
      const updated: Ask = {
        ...ask,
        lastPrompt: { state: promptResult.isOk() ? "sent" : promptResult.error.type, at: now },
        updatedAt: now,
      };
      await deps.repository.save(updated);
      return ok(updated);
    });
  }

  return {
    createAsk,
    replyAsk,
    resolveAsk,
    listAsks,
    getAsk,
    getAskWithSession,
    forFile,
    counts,
    focusSession,
    resendPrompt,
  };
}

export type AskService = ReturnType<typeof createAskService>;
