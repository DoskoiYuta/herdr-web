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

/** 内容アンカー: 行番号ではなく行内容 + 前後コンテキストで一致を取る。複数行の選択は `lines` に連続して入る */
export const AnchorSchema = v.object({
  side: SideSchema,
  /** 注釈対象の行（選択範囲、1 行以上、連続）。末尾空白を trim 済み。再解決は先頭行を基準にする */
  lines: v.pipe(v.array(v.string()), v.minLength(1)),
  /** 同じ側の、先頭行の直前最大 3 行。trim 済み */
  before: v.array(v.string()),
  /** 同じ側の、最終行の直後最大 3 行。trim 済み */
  after: v.array(v.string()),
  /** 作成時点での先頭行の、その側の 1-based 行番号 */
  lineHint: v.pipe(v.number(), v.integer(), v.minValue(1)),
  /** 正規化した `before\n lines \n after` を "\n" で連結した文字列の sha1 hex */
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
  /** draft なら最終編集時刻、送信後は送信時刻 */
  at: v.string(),
  agentSession: v.nullable(v.string()),
  /**
   * user のメッセージは下書きとして作られ、`POST /api/review/send` でまとめて送信される。
   * agent には送信済みのメッセージしか見えない（draft は list / show から落とす）。agent のメッセージは常に false。
   */
  draft: v.boolean(),
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
  /**
   * open: user の送信済みメッセージに agent が未応答 / replied: agent が応答済み。
   * 下書きだけの review も open だが、送信済みメッセージが無いあいだ agent からは見えない。
   * user の下書き追加では変わらず、send で open に戻る（resolved も reopen される）。
   */
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
  /** true なら下書きエントリを含める（Web UI 用）。既定は agent 向けに下書きを落とし、送信済みが無い review は返さない */
  drafts: optionalBoolFromQuery,
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

/** author=user は下書きを追加する。author=agent は即送信済みで、送信済みメッセージの無い review には返信できない */
export const ReplyRequestSchema = v.object({
  body: v.string(),
  author: EntryAuthorSchema,
  agentSession: v.optional(v.nullable(v.string())),
});
export type ReplyRequest = v.InferOutput<typeof ReplyRequestSchema>;

/** `PUT /api/review/:id/draft/:seq` — 下書きエントリの本文を差し替える */
export const EditDraftRequestSchema = v.object({ body: v.string() });
export type EditDraftRequest = v.InferOutput<typeof EditDraftRequestSchema>;

/**
 * `POST /api/review/send` — `repo` の review のうち `worktreeRoot` で作られた下書きをすべて送信し、
 * その worktree のエージェント pane に 1 回だけ通知する。
 */
export const SendDraftsRequestSchema = v.object({
  repo: v.string(),
  worktreeRoot: v.string(),
  /**
   * 通知先の pane。`worktreeRoot` にいるエージェント pane が 1 つならば省略可。
   * 0 なら 409 `no_agent`、複数で未指定なら 409 `ambiguous_target`、候補外なら 409 `invalid_target`。
   */
  pane: v.optional(v.string()),
});
export type SendDraftsRequest = v.InferOutput<typeof SendDraftsRequestSchema>;

/** `GET /api/review/counts` — git graph のバッジと送信ボタンのための集計 */
export const ReviewCountsQuerySchema = v.object({
  repo: v.string(),
  worktree: v.string(),
});
export type ReviewCountsQuery = v.InferOutput<typeof ReviewCountsQuerySchema>;

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

/**
 * `POST /api/review/for-diff` が解決する要素形。`line` は `sideLines[side]` への 1-based index（先頭行）、
 * `span` はそこから連続して一致した行数（`anchor.lines` 全体が一致すれば lines.length、先頭行しか一致しなければ 1）。
 * 下書きエントリを含む（Web UI 専用）。
 */
export const ForDiffMatchSchema = v.object({
  review: ReviewSchema,
  line: v.pipe(v.number(), v.integer(), v.minValue(1)),
  span: v.pipe(v.number(), v.integer(), v.minValue(1)),
  confidence: v.picklist(["exact", "context", "line"]),
});
export type ForDiffMatch = v.InferOutput<typeof ForDiffMatchSchema>;

/** `unresolved`: status が open/replied で送信済みメッセージを持つ review 数。`drafts`: 下書きエントリを持つ review 数 */
export const ReviewCountSchema = v.object({ unresolved: v.number(), drafts: v.number() });
export type ReviewCount = v.InferOutput<typeof ReviewCountSchema>;

export const ReviewCountsResponseSchema = v.object({
  /** commit 付き review の集計。hash → count。0 件の commit は含まない */
  byCommit: v.record(v.string(), ReviewCountSchema),
  /** `worktree` に付いた未コミット review の集計 */
  worktree: ReviewCountSchema,
  /** `POST /send` が送る対象（`worktreeRoot` が `worktree` に一致し、下書きを持つ review）の数 */
  pendingDrafts: v.number(),
  /** Diff タブの通知バッジ（ui-redesign.md §5.4）: `worktree` から見える replied 件数 */
  replied: v.number(),
});
export type ReviewCountsResponse = v.InferOutput<typeof ReviewCountsResponseSchema>;

/** `POST /api/review/send` のレスポンス: 送信した review（送信後の状態） */
export const SendDraftsResultSchema = v.object({ reviews: v.array(ReviewSchema) });
export type SendDraftsResult = v.InferOutput<typeof SendDraftsResultSchema>;

/** `POST /api/repo/move` のレスポンス（移動した repo / review の件数）。 */
export const RepoMoveResultSchema = v.object({ repos: v.number(), reviews: v.number() });
export type RepoMoveResult = v.InferOutput<typeof RepoMoveResultSchema>;
