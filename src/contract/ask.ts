import * as v from "valibot";
import { AnchorSchema, EntryAuthorSchema } from "./review";

/**
 * 「質問」(ask): 変更ではなくコードベースの場所（path + 内容アンカー）に付く会話。
 * plan.md F10。レビュー (F5) とは別テーブル・別 API で、コミットへの追従も
 * 下書きの一括送信も持たない。1 範囲 = 1 スレッド。
 */

export const AskStatusSchema = v.picklist(["open", "replied", "resolved", "outdated"]);
export type AskStatus = v.InferOutput<typeof AskStatusSchema>;

/**
 * 回答するエージェントの居場所。
 * - herdr: Web UI サーバーが作った専用ワークスペース。herdr の id は詰められて
 *   変わるので id ではなく `label`（`ask:<短縮 id>`）で毎回引き直す。
 * - pane: 既存のエージェント pane（送信時に選んだもの）。
 */
export const AskSessionSchema = v.variant("kind", [
  v.object({ kind: v.literal("herdr"), label: v.string() }),
  v.object({ kind: v.literal("pane"), paneId: v.string() }),
]);
export type AskSession = v.InferOutput<typeof AskSessionSchema>;

/** セッションの生存状態（保存しない、都度 herdr から引く）。`gone` は pane / workspace が無い。 */
export const AskSessionStatusSchema = v.picklist([
  "idle",
  "working",
  "blocked",
  "done",
  "unknown",
  "gone",
]);
export type AskSessionStatus = v.InferOutput<typeof AskSessionStatusSchema>;

/** 直近の user メッセージをエージェントへ渡せたか。 */
export const AskPromptStateSchema = v.picklist(["sent", "agent_blocked", "gone", "failed"]);
export type AskPromptState = v.InferOutput<typeof AskPromptStateSchema>;

export const AskEntrySchema = v.object({
  seq: v.pipe(v.number(), v.integer(), v.minValue(0)),
  author: EntryAuthorSchema,
  body: v.string(),
  at: v.string(),
  agentSession: v.nullable(v.string()),
});
export type AskEntry = v.InferOutput<typeof AskEntrySchema>;

export const AskSchema = v.object({
  id: v.string(),
  /** リポジトリキー = git-common-dir の絶対パス */
  repo: v.string(),
  worktreeRoot: v.string(),
  /** リポジトリルートからの相対パス */
  path: v.string(),
  /** side は常に "new"（worktree 上のファイル内容） */
  anchor: AnchorSchema,
  createdAtHead: v.nullable(v.string()),
  status: AskStatusSchema,
  session: v.nullable(AskSessionSchema),
  /** thread[0] が質問本文（author: "user"） */
  thread: v.array(AskEntrySchema),
  lastPrompt: v.nullable(v.object({ state: AskPromptStateSchema, at: v.string() })),
  createdAt: v.string(),
  updatedAt: v.string(),
});
export type Ask = v.InferOutput<typeof AskSchema>;

/** GET /api/ask/:id が返す。`sessionStatus` は herdr から都度引く。 */
export const AskWithSessionSchema = v.object({
  ...AskSchema.entries,
  sessionStatus: AskSessionStatusSchema,
});
export type AskWithSession = v.InferOutput<typeof AskWithSessionSchema>;

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

export const AskTargetSchema = v.variant("kind", [
  /** 専用ワークスペースで claude を起動して質問する（既定） */
  v.object({ kind: v.literal("new") }),
  /** 既存のエージェント pane に質問する */
  v.object({ kind: v.literal("pane"), paneId: v.string() }),
]);
export type AskTarget = v.InferOutput<typeof AskTargetSchema>;

export const CreateAskRequestSchema = v.object({
  repo: v.string(),
  worktreeRoot: v.string(),
  path: v.string(),
  anchor: AnchorSchema,
  createdAtHead: v.nullable(v.string()),
  body: v.pipe(v.string(), v.minLength(1)),
  target: AskTargetSchema,
});
export type CreateAskRequest = v.InferOutput<typeof CreateAskRequestSchema>;

export const ListAskQuerySchema = v.object({
  repo: v.optional(v.string()),
  worktree: v.optional(v.string()),
  /** comma-separated AskStatus。既定は open,replied */
  status: v.optional(v.string()),
  path: v.optional(v.string()),
});
export type ListAskQuery = v.InferOutput<typeof ListAskQuerySchema>;

export const AskReplyRequestSchema = v.object({
  body: v.pipe(v.string(), v.minLength(1)),
  /** hw から呼ばれるときの作者。Web UI は常に user */
  author: v.optional(EntryAuthorSchema, "user"),
  agentSession: v.optional(v.nullable(v.string()), null),
});
export type AskReplyRequest = v.InferOutput<typeof AskReplyRequestSchema>;

/** Files タブ用: 1 ファイルの現在の行内容に対してアンカー一致を取る（review の for-diff と同じ発想） */
export const ForFileRequestSchema = v.object({
  repo: v.string(),
  worktreeRoot: v.string(),
  path: v.string(),
  /** ファイルの全行（未正規化でよい） */
  lines: v.array(v.string()),
});
export type ForFileRequest = v.InferOutput<typeof ForFileRequestSchema>;

export const ForFileMatchSchema = v.object({
  ask: AskSchema,
  /** 1-based, 両端含む。null なら現在の内容に一致しない */
  startLine: v.nullable(v.number()),
  endLine: v.nullable(v.number()),
});
export type ForFileMatch = v.InferOutput<typeof ForFileMatchSchema>;

export const AskCountsQuerySchema = v.object({ repo: v.string(), worktree: v.string() });
export const AskCountsResponseSchema = v.object({
  unresolved: v.number(),
  byPath: v.record(v.string(), v.number()),
});
export type AskCountsResponse = v.InferOutput<typeof AskCountsResponseSchema>;

/**
 * `/ws/events` に review イベントと同じチャンネルで流す。events.ts のイベント union への
 * 合流は他エージェント担当（src/contract/events.ts）。
 */
export const AskEventSchema = v.object({
  type: v.literal("ask"),
  action: v.picklist(["created", "replied", "resolved", "reanchored"]),
  ask: AskSchema,
});
export type AskEvent = v.InferOutput<typeof AskEventSchema>;
