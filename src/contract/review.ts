import * as v from "valibot";

/** 差分の左右どちらの側の行か */
export const SideSchema = v.picklist(["old", "new"]);
export type Side = v.InferOutput<typeof SideSchema>;

/** アンカー先: 未コミットなら worktree、コミット後は commit */
export const ReviewTargetSchema = v.variant("kind", [
  v.object({ kind: v.literal("worktree"), root: v.string() }),
  v.object({ kind: v.literal("commit"), hash: v.string() }),
]);
export type ReviewTarget = v.InferOutput<typeof ReviewTargetSchema>;

/** 内容アンカー: 行番号ではなく行内容 + 前後コンテキストで一致を取る */
export const AnchorSchema = v.object({
  side: SideSchema,
  /** 注釈対象の行。末尾空白を trim 済み */
  line: v.string(),
  /** 同じ側の直前最大 3 行。trim 済み */
  before: v.array(v.string()),
  /** 同じ側の直後最大 3 行。trim 済み */
  after: v.array(v.string()),
  /** 作成時点でのその側の 1-based 行番号 */
  lineHint: v.pipe(v.number(), v.integer(), v.minValue(1)),
  /** 正規化した `before\n line \n after` の sha1 hex */
  hash: v.string(),
});
export type Anchor = v.InferOutput<typeof AnchorSchema>;

export const ReviewStatusSchema = v.picklist(["open", "replied", "resolved", "outdated"]);
export type ReviewStatus = v.InferOutput<typeof ReviewStatusSchema>;

/** 通知の結果状態。`pending` は作成直後（未送信）、`none` は移行前の既定値。 */
export const NotifyStateSchema = v.picklist([
  "pending",
  "sent",
  "agent_blocked",
  "no_target",
  "unknown",
  "none",
]);
export type NotifyState = v.InferOutput<typeof NotifyStateSchema>;

export const NotifySchema = v.object({
  state: NotifyStateSchema,
  pane: v.nullable(v.string()),
  at: v.nullable(v.string()),
});
export type Notify = v.InferOutput<typeof NotifySchema>;

export const EntryAuthorSchema = v.picklist(["user", "agent"]);
export type EntryAuthor = v.InferOutput<typeof EntryAuthorSchema>;

export const EntrySchema = v.object({
  seq: v.pipe(v.number(), v.integer(), v.minValue(0)),
  author: EntryAuthorSchema,
  body: v.string(),
  at: v.string(),
  agentSession: v.nullable(v.string()),
});
export type Entry = v.InferOutput<typeof EntrySchema>;

export const ViewedAsSchema = v.object({ from: v.string(), to: v.string() });
export type ViewedAs = v.InferOutput<typeof ViewedAsSchema>;

export const ReviewSchema = v.object({
  id: v.string(),
  /** リポジトリキー = git-common-dir の絶対パス */
  repo: v.string(),
  target: ReviewTargetSchema,
  /** 作成時の worktree。commit 確定後も履歴として残す */
  worktreeRoot: v.string(),
  /** リポジトリルートからの相対パス */
  path: v.string(),
  anchor: AnchorSchema,
  /** 作成時の HEAD */
  createdAtHead: v.string(),
  viewedAs: ViewedAsSchema,
  status: ReviewStatusSchema,
  /** thread[0] が最初のコメント（author: "user"） */
  thread: v.array(EntrySchema),
  /** 通知の状態（永続化、drain 用）。§F5-6 */
  notify: NotifySchema,
  createdAt: v.string(),
  updatedAt: v.string(),
});
export type Review = v.InferOutput<typeof ReviewSchema>;

export const RepoRecordSchema = v.object({
  key: v.string(),
  rootCommit: v.nullable(v.string()),
  name: v.string(),
  firstSeenAt: v.string(),
  lastSeenAt: v.string(),
});
export type RepoRecord = v.InferOutput<typeof RepoRecordSchema>;

/* ------------------------------------------------------------------ */
/* API 境界: リクエスト / クエリスキーマ                              */
/* ------------------------------------------------------------------ */

const optionalBoolFromQuery = v.optional(
  v.pipe(
    v.string(),
    v.transform((s) => s === "true" || s === "1"),
  ),
);

export const ListReviewQuerySchema = v.object({
  repo: v.optional(v.string()),
  worktree: v.optional(v.string()),
  status: v.optional(v.string()), // comma-separated ReviewStatus
  commit: v.optional(v.string()),
  since: v.optional(v.string()),
  uncommitted: optionalBoolFromQuery,
  unreachable: optionalBoolFromQuery,
  all: optionalBoolFromQuery,
  path: v.optional(v.string()),
});
export type ListReviewQuery = v.InferOutput<typeof ListReviewQuerySchema>;

export const ForDiffRequestSchema = v.object({
  repo: v.string(),
  /**
   * worktree 付きレビュー（to が WORKTREE/INDEX の場合）の絞り込みに使う worktree ルート。
   * commit 間 diff の場合は無視してよい。plan §9.4 にはない追加フィールド（route の deviation 注記を参照）。
   */
  worktreeRoot: v.optional(v.string()),
  from: v.string(),
  to: v.string(),
  path: v.string(),
  sideLines: v.object({
    old: v.array(v.string()),
    new: v.array(v.string()),
  }),
});
export type ForDiffRequest = v.InferOutput<typeof ForDiffRequestSchema>;

export const CreateReviewRequestSchema = v.object({
  repo: v.string(),
  worktreeRoot: v.string(),
  target: ReviewTargetSchema,
  path: v.string(),
  anchor: AnchorSchema,
  createdAtHead: v.string(),
  viewedAs: ViewedAsSchema,
  body: v.string(),
  agentSession: v.optional(v.nullable(v.string())),
});
export type CreateReviewRequest = v.InferOutput<typeof CreateReviewRequestSchema>;

export const ReplyRequestSchema = v.object({
  body: v.string(),
  author: EntryAuthorSchema,
  agentSession: v.optional(v.nullable(v.string())),
});
export type ReplyRequest = v.InferOutput<typeof ReplyRequestSchema>;

export const ReanchorRequestSchema = v.object({
  head: v.optional(v.string()),
});
export type ReanchorRequest = v.InferOutput<typeof ReanchorRequestSchema>;

export const RepoMoveRequestSchema = v.object({
  from: v.string(),
  to: v.string(),
});
export type RepoMoveRequest = v.InferOutput<typeof RepoMoveRequestSchema>;

/* ------------------------------------------------------------------ */
/* API 境界: レスポンススキーマ                                        */
/* ------------------------------------------------------------------ */

/** `POST /api/review/for-diff` が解決する `{ review, line, confidence }[]` の要素形。 */
export const ForDiffMatchSchema = v.object({
  review: ReviewSchema,
  line: v.pipe(v.number(), v.integer(), v.minValue(1)),
  confidence: v.picklist(["exact", "context", "line"]),
});
export type ForDiffMatch = v.InferOutput<typeof ForDiffMatchSchema>;

/** `POST /api/repo/move` のレスポンス（移動した repo / review の件数）。 */
export const RepoMoveResultSchema = v.object({ repos: v.number(), reviews: v.number() });
export type RepoMoveResult = v.InferOutput<typeof RepoMoveResultSchema>;
