import { beforeEach, describe, expect, test } from "bun:test";
import type { Anchor, Review } from "../../contract/review";
import type { Ask } from "../../contract/ask";
import type { Decision } from "../../contract/decision";
import type { PaneInfo, WorkspaceInfo } from "../../contract/herdr";
import { createReview } from "../review/domain/transitions";
import { FakeReviewRepository, ManualClock } from "../review/testing/fakes";
import { FakeAskRepository } from "../ask/testing/fake-repository";
import { FakeDecisionRepository } from "../decision/testing/fake-repository";
import { emptyState, selectionKey, type HerdrState, type WorkspaceSelection } from "../herdr/state";
import type { WorktreeInfo, WorktreeResolver } from "../herdr/tree";
import { createInboxService } from "./service";

const ANCHOR: Anchor = {
  side: "new",
  lines: ["x"],
  before: [],
  after: [],
  lineHint: 10,
  hash: "h",
};
const CLOCK = new ManualClock("2026-01-01T00:00:00.000Z");

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    ...createReview(
      {
        id: "review-1",
        repo: "/repo",
        target: { kind: "worktree", root: "/repo" },
        worktreeRoot: "/repo",
        path: "a.ts",
        anchor: ANCHOR,
        createdAtHead: "head0",
        viewedAs: { from: "WORKTREE", to: "WORKTREE" },
        body: "why?",
      },
      CLOCK,
    ),
    ...overrides,
  };
}

function makeAsk(overrides: Partial<Ask> = {}): Ask {
  return {
    id: "ask-1",
    repo: "/repo",
    worktreeRoot: "/repo",
    path: "a.ts",
    anchor: ANCHOR,
    createdAtHead: "head0",
    status: "open",
    session: null,
    thread: [
      {
        seq: 0,
        author: "user",
        body: "what is this?",
        at: "2026-01-01T00:00:00.000Z",
        agentSession: null,
      },
    ],
    lastPrompt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "decision-1",
    status: "open",
    spec: {
      title: "どちらにする?",
      context: [],
      items: [
        {
          id: "i1",
          header: "選択",
          question: "A or B?",
          kind: "single",
          options: [],
          allowOther: true,
          required: true,
        },
      ],
      layout: null,
    },
    answer: null,
    paneId: null,
    claudeSessionId: null,
    worktreeRoot: "/repo",
    repoKey: "/repo/.git",
    agent: "claude",
    createdAt: "2026-01-01T00:00:00.000Z",
    answeredAt: null,
    delivery: null,
    ...overrides,
  };
}

function makePane(overrides: Partial<PaneInfo> = {}): PaneInfo {
  return {
    pane_id: "pane-1",
    terminal_id: "term-1",
    workspace_id: "ws-1",
    tab_id: "tab-1",
    focused: false,
    agent_status: "idle",
    revision: 1,
    ...overrides,
  };
}

function makeWorkspace(overrides: Partial<WorkspaceInfo> = {}): WorkspaceInfo {
  return {
    workspace_id: "ws-1",
    number: 1,
    label: "main",
    focused: false,
    pane_count: 1,
    tab_count: 1,
    active_tab_id: "tab-1",
    agent_status: "idle",
    ...overrides,
  };
}

/** `livePanes`（tree.ts）は workspace が state に無い pane を捨てる — 明示的に
 * workspace を渡さないテストでも、各 pane の workspace_id に対応する最小限の
 * workspace レコードを自動で用意する。 */
function stateWithPanes(panes: PaneInfo[], workspaces: WorkspaceInfo[] = []): HerdrState {
  const state = emptyState();
  for (const p of panes) state.panes.set(p.pane_id, p);
  const explicit = new Set(workspaces.map((w) => w.workspace_id));
  for (const w of workspaces) state.workspaces.set(w.workspace_id, w);
  for (const p of panes) {
    if (explicit.has(p.workspace_id) || state.workspaces.has(p.workspace_id)) continue;
    state.workspaces.set(p.workspace_id, makeWorkspace({ workspace_id: p.workspace_id }));
  }
  return state;
}

function fakeResolver(map: Record<string, WorktreeInfo | null>): WorktreeResolver {
  return { resolve: async (cwd) => map[cwd] ?? null };
}

let reviewRepository: FakeReviewRepository;
let askRepository: FakeAskRepository;
let decisionRepository: FakeDecisionRepository;

beforeEach(() => {
  reviewRepository = new FakeReviewRepository();
  askRepository = new FakeAskRepository();
  decisionRepository = new FakeDecisionRepository();
});

function service(
  state: HerdrState = emptyState(),
  resolver: WorktreeResolver = fakeResolver({}),
  selections: Map<string, WorkspaceSelection> = new Map(),
) {
  return createInboxService({
    reviewRepository,
    askRepository,
    decisionRepository,
    state: {
      get: () => state,
      getSelection: (workspaceId, repoKey) =>
        selections.get(selectionKey(workspaceId, repoKey)) ?? null,
      setSelection: async (sel) => ({ ok: true, selection: { ...sel, updatedAt: "t" } }),
    },
    resolver,
    listWorktrees: async () => [],
    listSubRepos: async () => [],
  });
}

describe("undelivered section", () => {
  test.each([
    ["open", "agent_blocked", true],
    ["open", "no_target", true],
    ["open", "unknown", true],
    ["open", "sent", false],
    ["open", "pending", false],
    ["open", "none", false],
    // 無いと壊れる: replied（エージェントが返信済み）を undelivered にも含めると、
    // 通知に失敗しただけで実際は返信済みのレビューが「届いていない通知」と
    // 「返信が届いた」に二重表示され、既に不要な「再送」が出てしまう。
    ["replied", "agent_blocked", false],
  ] as const)(
    // 無いと壊れる: notify.state の分類を間違えると、再送が必要なレビューが Inbox に
    // 出なかったり、届いているレビューまで再送候補として出てしまう。
    "review with status=%s notify.state=%s is included=%s",
    async (status, notifyState, included) => {
      const repliedThread: Partial<Review> =
        status === "replied"
          ? {
              thread: [
                { seq: 0, author: "user", body: "x", at: "t", agentSession: null, draft: false },
                { seq: 1, author: "agent", body: "y", at: "t", agentSession: null, draft: false },
              ],
            }
          : {};
      await reviewRepository.save(
        makeReview({
          status,
          notify: { state: notifyState, pane: "p1", at: "2026-01-02T00:00:00.000Z" },
          ...repliedThread,
        }),
      );
      const result = await service().getInbox();
      const ids = result.items.filter((i) => i.section === "undelivered").map((i) => i.id);
      expect(ids.includes("review-1")).toBe(included);
    },
  );

  test("undelivered review is excluded once resolved (status not open)", async () => {
    await reviewRepository.save(
      makeReview({
        status: "resolved",
        notify: { state: "agent_blocked", pane: "p1", at: "2026-01-02T00:00:00.000Z" },
      }),
    );
    const result = await service().getInbox();
    expect(result.items.some((i) => i.section === "undelivered")).toBe(false);
  });

  test.each([
    ["open", "agent_blocked", true],
    ["open", "gone", true],
    ["open", "failed", true],
    ["open", "sent", false],
    // 無いと壊れる: ask も review と同じ二重表示バグを持ちうる。
    ["replied", "agent_blocked", false],
  ] as const)(
    "ask with status=%s lastPrompt.state=%s is included=%s",
    async (status, state, included) => {
      const repliedThread: Partial<Ask> =
        status === "replied"
          ? {
              thread: [
                { seq: 0, author: "user", body: "x", at: "t", agentSession: null },
                { seq: 1, author: "agent", body: "y", at: "t", agentSession: null },
              ],
            }
          : {};
      await askRepository.save(
        makeAsk({
          status,
          lastPrompt: { state, at: "2026-01-02T00:00:00.000Z" },
          ...repliedThread,
        }),
      );
      const result = await service().getInbox();
      const ids = result.items.filter((i) => i.section === "undelivered").map((i) => i.id);
      expect(ids.includes("ask-1")).toBe(included);
    },
  );

  test.each([
    ["answered", "agent_blocked", true],
    ["dismissed", "gone", true],
    ["answered", "unknown", true],
    ["answered", "sent", false],
    ["open", "agent_blocked", false],
  ] as const)(
    "decision status=%s delivery.state=%s is included=%s",
    async (status, deliveryState, included) => {
      await decisionRepository.save(
        makeDecision({
          status,
          delivery: {
            state: deliveryState,
            attempts: 1,
            pane: "p1",
            at: "2026-01-02T00:00:00.000Z",
          },
        }),
      );
      const result = await service().getInbox();
      const ids = result.items.filter((i) => i.section === "undelivered").map((i) => i.id);
      expect(ids.includes("decision-1")).toBe(included);
    },
  );

  // 無いと壊れる: decision.delivery が null（まだ配達を試みていない）のに未達扱いすると、
  // answered 直後の全依頼が毎回 Inbox に出てしまう。
  test("decision with delivery=null is not undelivered even if status is answered", async () => {
    await decisionRepository.save(makeDecision({ status: "answered", delivery: null }));
    const result = await service().getInbox();
    expect(result.items.some((i) => i.section === "undelivered")).toBe(false);
  });
});

describe("replied section", () => {
  test("replied review appears with its location", async () => {
    await reviewRepository.save(
      makeReview({
        status: "replied",
        thread: [
          { seq: 0, author: "user", body: "why?", at: "t0", agentSession: null, draft: false },
          {
            seq: 1,
            author: "agent",
            body: "because x",
            at: "t1",
            agentSession: null,
            draft: false,
          },
        ],
      }),
    );
    const result = await service().getInbox();
    const item = result.items.find((i) => i.section === "replied");
    expect(item?.kind).toBe("review");
    if (item?.section === "replied") {
      expect(item.location).toEqual({ path: "a.ts", line: 10, side: "new" });
    }
  });

  test("open review does not appear in replied", async () => {
    await reviewRepository.save(makeReview({ status: "open" }));
    const result = await service().getInbox();
    expect(result.items.some((i) => i.section === "replied")).toBe(false);
  });

  test("replied ask appears in replied section", async () => {
    await askRepository.save(makeAsk({ status: "replied" }));
    const result = await service().getInbox();
    expect(result.items.some((i) => i.section === "replied" && i.kind === "ask")).toBe(true);
  });

  // 無いと壊れる: replied + 通知失敗の review/ask が undelivered にも漏れて出ると、
  // 同じレビューが Inbox に 2 回現れ、返信済みなのに「再送」ボタンまで出てしまう。
  test.each(["review", "ask"] as const)(
    "a replied %s with a failed notify appears exactly once, in replied only",
    async (kind) => {
      if (kind === "review") {
        await reviewRepository.save(
          makeReview({
            status: "replied",
            notify: { state: "agent_blocked", pane: "p1", at: "t" },
            thread: [
              { seq: 0, author: "user", body: "x", at: "t", agentSession: null, draft: false },
              { seq: 1, author: "agent", body: "y", at: "t", agentSession: null, draft: false },
            ],
          }),
        );
      } else {
        await askRepository.save(
          makeAsk({
            status: "replied",
            lastPrompt: { state: "agent_blocked", at: "t" },
            thread: [
              { seq: 0, author: "user", body: "x", at: "t", agentSession: null },
              { seq: 1, author: "agent", body: "y", at: "t", agentSession: null },
            ],
          }),
        );
      }
      const result = await service().getInbox();
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.section).toBe("replied");
      expect(result.counts.total).toBe(1);
      expect(result.counts.bySection.replied).toBe(1);
      expect(result.counts.bySection.undelivered).toBe(0);
    },
  );
});

describe("replied review location", () => {
  // 無いと壊れる: old 側にコメントした review の location が side を落とすと、
  // ToolPane 側の既定 "new" にフォールバックして無関係な行を開いてしまう。
  test("carries anchor.side so an old-side comment opens the old side", async () => {
    await reviewRepository.save(
      makeReview({
        status: "replied",
        anchor: { ...ANCHOR, side: "old" },
        thread: [
          { seq: 0, author: "user", body: "x", at: "t", agentSession: null, draft: false },
          { seq: 1, author: "agent", body: "y", at: "t", agentSession: null, draft: false },
        ],
      }),
    );
    const result = await service().getInbox();
    const item = result.items.find((i) => i.section === "replied");
    expect(item?.section === "replied" && item.location).toEqual({
      path: "a.ts",
      line: 10,
      side: "old",
    });
  });

  // 無いと壊れる: commit ターゲットの review は from/to が無いと Diff が
  // WORKTREE/INDEX の比較のまま開き、コメントの付いたコミット間 diff を表示できない。
  test("carries from/to (hash~1..hash) for a commit-targeted review", async () => {
    await reviewRepository.save(
      makeReview({
        status: "replied",
        target: { kind: "commit", hash: "abc123" },
        thread: [
          { seq: 0, author: "user", body: "x", at: "t", agentSession: null, draft: false },
          { seq: 1, author: "agent", body: "y", at: "t", agentSession: null, draft: false },
        ],
      }),
    );
    const result = await service().getInbox();
    const item = result.items.find((i) => i.section === "replied");
    expect(item?.section === "replied" && item.location).toEqual({
      path: "a.ts",
      line: 10,
      side: "new",
      from: "abc123~1",
      to: "abc123",
    });
  });
});

describe("unsent section", () => {
  test("counts reviews with a draft entry per worktree, not per entry", async () => {
    await reviewRepository.save(
      makeReview({
        id: "r1",
        worktreeRoot: "/wt-a",
        thread: [
          { seq: 0, author: "user", body: "d1", at: "t0", agentSession: null, draft: true },
          { seq: 1, author: "user", body: "d2", at: "t1", agentSession: null, draft: true },
        ],
      }),
    );
    await reviewRepository.save(
      makeReview({
        id: "r2",
        worktreeRoot: "/wt-a",
        thread: [{ seq: 0, author: "user", body: "d3", at: "t2", agentSession: null, draft: true }],
      }),
    );
    const result = await service().getInbox();
    const item = result.items.find((i) => i.section === "unsent");
    expect(item).toMatchObject({ worktreeRoot: "/wt-a", count: 2 });
  });

  test("review without any draft entry does not create an unsent row", async () => {
    await reviewRepository.save(
      makeReview({
        thread: [
          { seq: 0, author: "user", body: "sent", at: "t0", agentSession: null, draft: false },
        ],
      }),
    );
    const result = await service().getInbox();
    expect(result.items.some((i) => i.section === "unsent")).toBe(false);
  });
});

describe("blocked section", () => {
  test("blocked pane appears with resolved worktreeRoot", async () => {
    const pane = makePane({
      pane_id: "p1",
      agent_status: "blocked",
      agent: "claude",
      foreground_cwd: "/wt-a",
    });
    const state = stateWithPanes([pane], [makeWorkspace({ workspace_id: "ws-1", label: "main" })]);
    const resolver = fakeResolver({
      "/wt-a": { root: "/wt-a", commonDir: "/wt-a/.git", branch: "main", isMain: true },
    });
    const result = await service(state, resolver).getInbox();
    const item = result.items.find((i) => i.section === "blocked");
    expect(item).toMatchObject({ paneId: "p1", agent: "claude", worktreeRoot: "/wt-a" });
  });

  test("idle pane is not included in blocked", async () => {
    const pane = makePane({ agent_status: "idle" });
    const state = stateWithPanes([pane]);
    const result = await service(state).getInbox();
    expect(result.items.some((i) => i.section === "blocked")).toBe(false);
  });

  // 無いと壊れる: cwd の raw worktree のまま filter すると、選択中の worktree
  // (サイドバーのツリーと同じ実効値) と一致せず、Inbox の worktree 絞り込みで
  // その pane が消えてしまう。
  test("a blocked pane in a workspace with a saved selection appears under the SELECTED worktree, not its cwd's", async () => {
    const pane = makePane({
      pane_id: "p1",
      workspace_id: "ws-1",
      agent_status: "blocked",
      agent: "claude",
      foreground_cwd: "/repo",
    });
    const state = stateWithPanes([pane], [makeWorkspace({ workspace_id: "ws-1", label: "main" })]);
    const resolver = fakeResolver({
      "/repo": { root: "/repo", commonDir: "/repo/.git", branch: "main", isMain: true },
    });
    const selections = new Map([
      [
        selectionKey("ws-1", "/repo/.git"),
        {
          workspaceId: "ws-1",
          repoKey: "/repo/.git",
          worktreeRoot: "/repo-feature",
          subRepoId: null,
          subWorktreeRoot: null,
          updatedAt: "t0",
        } satisfies WorkspaceSelection,
      ],
    ]);
    const svc = createInboxService({
      reviewRepository,
      askRepository,
      decisionRepository,
      state: {
        get: () => state,
        getSelection: (workspaceId, repoKey) =>
          selections.get(selectionKey(workspaceId, repoKey)) ?? null,
        setSelection: async (sel) => ({ ok: true, selection: { ...sel, updatedAt: "t" } }),
      },
      resolver,
      listWorktrees: async () => [
        { root: "/repo", branch: "main", head: "h1", isMain: true },
        { root: "/repo-feature", branch: "feature", head: "h2", isMain: false },
      ],
      listSubRepos: async () => [],
    });

    const all = await svc.getInbox();
    expect(all.items.find((i) => i.section === "blocked")).toMatchObject({
      paneId: "p1",
      worktreeRoot: "/repo-feature",
    });

    const filtered = await svc.getInbox("/repo-feature");
    expect(filtered.items.map((i) => i.section === "blocked" && i.paneId)).toContain("p1");
    const filteredOnCwd = await svc.getInbox("/repo");
    expect(filteredOnCwd.items.some((i) => i.section === "blocked")).toBe(false);
  });
});

describe("worktree filter", () => {
  test("filters undelivered/replied/unsent items by worktreeRoot", async () => {
    await reviewRepository.save(
      makeReview({
        id: "match",
        worktreeRoot: "/wt-a",
        status: "replied",
        thread: [{ seq: 0, author: "agent", body: "x", at: "t", agentSession: null, draft: false }],
      }),
    );
    await reviewRepository.save(
      makeReview({
        id: "other",
        worktreeRoot: "/wt-b",
        status: "replied",
        thread: [{ seq: 0, author: "agent", body: "x", at: "t", agentSession: null, draft: false }],
      }),
    );
    const result = await service().getInbox("/wt-a");
    const ids = result.items.map((i) => (i.section === "replied" ? i.id : null)).filter(Boolean);
    expect(ids).toEqual(["match"]);
  });

  test("filters blocked panes by their own resolved worktreeRoot", async () => {
    const panes = [
      makePane({ pane_id: "p1", agent_status: "blocked", foreground_cwd: "/wt-a" }),
      makePane({ pane_id: "p2", agent_status: "blocked", foreground_cwd: "/wt-b" }),
    ];
    const state = stateWithPanes(panes);
    const resolver = fakeResolver({
      "/wt-a": { root: "/wt-a", commonDir: "/a/.git", branch: "main", isMain: true },
      "/wt-b": { root: "/wt-b", commonDir: "/b/.git", branch: "main", isMain: true },
    });
    const result = await service(state, resolver).getInbox("/wt-a");
    const paneIds = result.items.filter((i) => i.section === "blocked").map((i) => i.paneId);
    expect(paneIds).toEqual(["p1"]);
  });
});

describe("ordering", () => {
  // 無いと壊れる: セクション順を間違えると、より緊急な「届いていない通知」より
  // 下に表示され、ダイアログを開いた人がまず見るべきものを見逃す。
  test("sections appear in order: undelivered, replied, unsent, blocked", async () => {
    await reviewRepository.save(
      makeReview({
        id: "replied-1",
        status: "replied",
        thread: [{ seq: 0, author: "agent", body: "x", at: "t", agentSession: null, draft: false }],
      }),
    );
    await reviewRepository.save(
      makeReview({
        id: "undelivered-1",
        status: "open",
        notify: { state: "agent_blocked", pane: "p1", at: "t" },
        thread: [{ seq: 0, author: "user", body: "x", at: "t", agentSession: null, draft: false }],
      }),
    );
    await reviewRepository.save(
      makeReview({
        id: "unsent-1",
        worktreeRoot: "/wt-unsent",
        thread: [{ seq: 0, author: "user", body: "d", at: "t", agentSession: null, draft: true }],
      }),
    );
    const pane = makePane({ pane_id: "blocked-1", agent_status: "blocked" });
    const state = stateWithPanes([pane]);
    const result = await service(state).getInbox();
    expect(result.items.map((i) => i.section)).toEqual([
      "undelivered",
      "replied",
      "unsent",
      "blocked",
    ]);
  });

  test("within a section, newer items come first", async () => {
    await reviewRepository.save(
      makeReview({
        id: "older",
        status: "replied",
        thread: [
          {
            seq: 0,
            author: "agent",
            body: "x",
            at: "2026-01-01T00:00:00.000Z",
            agentSession: null,
            draft: false,
          },
        ],
      }),
    );
    await reviewRepository.save(
      makeReview({
        id: "newer",
        status: "replied",
        thread: [
          {
            seq: 0,
            author: "agent",
            body: "x",
            at: "2026-01-03T00:00:00.000Z",
            agentSession: null,
            draft: false,
          },
        ],
      }),
    );
    // updatedAt drives the ordering (replied uses updatedAt, not thread entry timestamps directly)
    const older = await reviewRepository.get("older");
    const newer = await reviewRepository.get("newer");
    if (older) await reviewRepository.save({ ...older, updatedAt: "2026-01-01T00:00:00.000Z" });
    if (newer) await reviewRepository.save({ ...newer, updatedAt: "2026-01-03T00:00:00.000Z" });

    const result = await service().getInbox();
    const ids = result.items
      .filter((i) => i.section === "replied")
      .map((i) => (i.section === "replied" ? i.id : null));
    expect(ids).toEqual(["newer", "older"]);
  });
});

describe("counts", () => {
  test("counts.total and counts.bySection match the items returned", async () => {
    await reviewRepository.save(
      makeReview({
        id: "replied-1",
        status: "replied",
        thread: [{ seq: 0, author: "agent", body: "x", at: "t", agentSession: null, draft: false }],
      }),
    );
    const pane = makePane({ pane_id: "blocked-1", agent_status: "blocked" });
    const state = stateWithPanes([pane]);
    const result = await service(state).getInbox();
    expect(result.counts.total).toBe(result.items.length);
    expect(result.counts.bySection.replied).toBe(1);
    expect(result.counts.bySection.blocked).toBe(1);
    expect(result.counts.bySection.undelivered).toBe(0);
    expect(result.counts.bySection.unsent).toBe(0);
  });
});
