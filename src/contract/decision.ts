import { toJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";

/**
 * 判断依頼 (decision): エージェントが `hw decision request` で人間に判断を求める
 * もの。方向が逆の「質問」(ask, F10) とは別テーブル・別 API・別語 (plan.md F13)。
 */

/** F13-6: context / option preview に埋め込める表示単位。UI は `markdown` だけ描画し、
 * 他の kind はプレースホルダ表示にとどまる。 */
export const BlockSchema = v.variant("kind", [
  v.object({ kind: v.literal("markdown"), text: v.string() }),
  v.object({ kind: v.literal("code"), language: v.string(), text: v.string() }),
  v.object({ kind: v.literal("diff"), patch: v.string() }),
  v.object({ kind: v.literal("mermaid"), text: v.string() }),
  v.object({ kind: v.literal("svg"), markup: v.string() }),
  v.object({
    kind: v.literal("html"),
    html: v.string(),
    // `false` also disables the srcdoc's own height-measurement script, so
    // the rendered iframe keeps its initial height instead of fitting `html`.
    allowScripts: v.optional(v.boolean(), false),
  }),
  v.object({ kind: v.literal("image"), path: v.string() }),
  v.object({
    kind: v.literal("location"),
    path: v.string(),
    lines: v.optional(v.nullable(v.tuple([v.number(), v.number()])), null),
  }),
  v.object({
    kind: v.literal("table"),
    header: v.array(v.string()),
    rows: v.array(v.array(v.string())),
  }),
]);
export type Block = v.InferOutput<typeof BlockSchema>;

export const DecisionItemKindSchema = v.picklist(["single", "multi", "text", "confirm"]);
export type DecisionItemKind = v.InferOutput<typeof DecisionItemKindSchema>;

export const DecisionOptionSchema = v.object({
  label: v.string(),
  description: v.optional(v.nullable(v.string()), null),
  recommended: v.optional(v.boolean(), false),
  preview: v.optional(v.array(BlockSchema), []),
});
export type DecisionOption = v.InferOutput<typeof DecisionOptionSchema>;

export const DecisionItemSchema = v.pipe(
  v.object({
    id: v.pipe(v.string(), v.minLength(1)),
    header: v.string(),
    /** markdown */
    question: v.string(),
    kind: DecisionItemKindSchema,
    options: v.optional(v.array(DecisionOptionSchema), []),
    allowOther: v.optional(v.boolean(), true),
    required: v.optional(v.boolean(), true),
  }),
  v.check(
    (item) => new Set(item.options.map((o) => o.label)).size === item.options.length,
    "option labels within an item must be unique",
  ),
);
export type DecisionItem = v.InferOutput<typeof DecisionItemSchema>;

export const DecisionSpecSchema = v.pipe(
  v.object({
    title: v.optional(v.nullable(v.string()), null),
    context: v.optional(v.array(BlockSchema), []),
    items: v.pipe(v.array(DecisionItemSchema), v.minLength(1)),
    layout: v.optional(v.nullable(v.literal("compare")), null),
  }),
  v.check(
    (spec) => new Set(spec.items.map((i) => i.id)).size === spec.items.length,
    "item ids must be unique",
  ),
);
export type DecisionSpec = v.InferOutput<typeof DecisionSpecSchema>;

/** F13-7: 回答は設問ごと。`text` は `other` に入る。`confirm` は `selected` が `["yes"]`/`["no"]`。 */
export const DecisionItemAnswerSchema = v.object({
  selected: v.array(v.string()),
  other: v.nullable(v.string()),
  note: v.nullable(v.string()),
});
export type DecisionItemAnswer = v.InferOutput<typeof DecisionItemAnswerSchema>;

export const DecisionAnswerSchema = v.object({
  /** item id -> 回答 */
  answers: v.record(v.string(), DecisionItemAnswerSchema),
});
export type DecisionAnswer = v.InferOutput<typeof DecisionAnswerSchema>;

/** 依頼の結果だけを表す。配達の状況は `delivery` で別に持つ (plan F13-4)。 */
export const DecisionStatusSchema = v.picklist(["open", "answered", "dismissed", "cancelled"]);
export type DecisionStatus = v.InferOutput<typeof DecisionStatusSchema>;

/**
 * 直近の配達試行の結果。`pending` は再試行待ち（herdr 未接続 / replay 中 /
 * 直近の試行が `agent_blocked` 以外の理由で失敗）、`sent` 以外は再送可能。
 */
export const DecisionDeliveryStateSchema = v.picklist([
  "pending",
  "sent",
  "agent_blocked",
  "gone",
  "unknown",
]);
export type DecisionDeliveryState = v.InferOutput<typeof DecisionDeliveryStateSchema>;

export const DecisionDeliverySchema = v.object({
  state: DecisionDeliveryStateSchema,
  /** 試行回数（バックオフの目安として UI に見せる）。 */
  attempts: v.number(),
  pane: v.nullable(v.string()),
  at: v.string(),
});
export type DecisionDelivery = v.InferOutput<typeof DecisionDeliverySchema>;

export const DecisionSchema = v.object({
  id: v.string(),
  status: DecisionStatusSchema,
  spec: DecisionSpecSchema,
  answer: v.nullable(DecisionAnswerSchema),
  paneId: v.nullable(v.string()),
  claudeSessionId: v.nullable(v.string()),
  worktreeRoot: v.nullable(v.string()),
  repoKey: v.nullable(v.string()),
  agent: v.nullable(v.string()),
  createdAt: v.string(),
  /** 回答・却下・取り下げのいずれかで確定した時刻。`status` が `open` の間は null。 */
  answeredAt: v.nullable(v.string()),
  delivery: v.nullable(DecisionDeliverySchema),
});
export type Decision = v.InferOutput<typeof DecisionSchema>;

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

export const CreateDecisionRequestSchema = v.object({
  spec: DecisionSpecSchema,
  paneId: v.optional(v.nullable(v.string()), null),
  claudeSessionId: v.optional(v.nullable(v.string()), null),
});
export type CreateDecisionRequest = v.InferOutput<typeof CreateDecisionRequestSchema>;

export const CreateDecisionResponseSchema = v.object({
  id: v.string(),
  url: v.string(),
  /** F13-3/呼び出し元の pane が herdr 上に見つかったか。false なら回答は自動で届かない。 */
  paneResolved: v.boolean(),
});
export type CreateDecisionResponse = v.InferOutput<typeof CreateDecisionResponseSchema>;

export const ListDecisionQuerySchema = v.object({
  /** comma-separated DecisionStatus */
  status: v.optional(v.string()),
  worktreeRoot: v.optional(v.string()),
});
export type ListDecisionQuery = v.InferOutput<typeof ListDecisionQuerySchema>;

export const DecisionCountsQuerySchema = v.object({
  worktreeRoot: v.optional(v.string()),
});
export type DecisionCountsQuery = v.InferOutput<typeof DecisionCountsQuerySchema>;

export const DecisionCountsSchema = v.object({
  /** `worktreeRoot` 指定時はその worktree の open 件数、未指定なら全体 */
  total: v.number(),
});
export type DecisionCounts = v.InferOutput<typeof DecisionCountsSchema>;

export const AnswerDecisionRequestSchema = DecisionAnswerSchema;
export type AnswerDecisionRequest = v.InferOutput<typeof AnswerDecisionRequestSchema>;

/**
 * `/ws/events` に流す (plan §9.w)。`worktreeRoot`/`paneId` は呼び出し元の
 * whoami 解決結果 — 未解決なら null。`delivery-updated` は配達試行が
 * 失敗/保留に変わったとき（`sent` は `delivered` で別に出す）。
 */
export const DecisionEventSchema = v.object({
  type: v.literal("decision"),
  action: v.picklist([
    "created",
    "answered",
    "dismissed",
    "cancelled",
    "delivered",
    "delivery-updated",
  ]),
  id: v.string(),
  worktreeRoot: v.nullable(v.string()),
  paneId: v.nullable(v.string()),
});
export type DecisionEvent = v.InferOutput<typeof DecisionEventSchema>;

/** 1 MiB。JSON 文字列長で検査する (plan F13-5) — ルート/CLI 事前検証の両方で使う。 */
export const DECISION_SPEC_MAX_BYTES = 1024 * 1024;

/** F13-7: agent.prompt 本文の上限。超える分は `hw decision show <id>` に逃がす。 */
export const DECISION_PROMPT_MAX_BYTES = 2048;

/**
 * `/api/decision/schema` / `hw decision schema` が返す JSON Schema。
 * id/label の一意性は `v.check` によるクロスフィールド検証で、JSON Schema に
 * 変換できないため無視する（実際の検証は valibot 側でサーバー/CLI が行う）。
 */
export function decisionSpecJsonSchema(): unknown {
  return toJsonSchema(DecisionSpecSchema, { errorMode: "ignore" });
}
