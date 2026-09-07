// レビュー / 質問 / 判断依頼 / エージェントの種別アイコン。色は
// src/web/index.css の --kind-* トークン（docs/ui-redesign.md §6）。
import { Bot, GitPullRequestArrow, MessageCircleQuestion, Signpost } from "lucide-react";

export type Kind = "review" | "ask" | "decision" | "agent";

const KIND_ICON: Record<Kind, typeof Bot> = {
  review: GitPullRequestArrow,
  ask: MessageCircleQuestion,
  decision: Signpost,
  agent: Bot,
};

export const KIND_LABEL: Record<Kind, string> = {
  review: "レビュー",
  ask: "質問",
  decision: "判断依頼",
  agent: "エージェント",
};

const KIND_COLOR: Record<Kind, string> = {
  review: "var(--kind-review)",
  ask: "var(--kind-ask)",
  decision: "var(--kind-decision)",
  agent: "var(--kind-agent)",
};

export function KindIcon({ kind, className }: { kind: Kind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return (
    <Icon
      role="img"
      data-kind-svg={kind}
      className={className ?? "size-3.5 shrink-0"}
      style={{ color: KIND_COLOR[kind] }}
      aria-label={KIND_LABEL[kind]}
    />
  );
}
