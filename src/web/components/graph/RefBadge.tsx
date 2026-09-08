import type { RefType } from "@contract/git";

export interface RefBadgeProps {
  name: string;
  type: RefType;
  isHead: boolean;
}

// design.pen: the checked-out branch is a solid pill, other local branches
// and remotes are outlined, tags are a solid amber pill.
const CLASS_BY_TYPE: Record<RefType, string> = {
  head: "border-primary/40 bg-primary/10 text-primary",
  remote: "border-border bg-transparent text-foreground",
  tag: "border-transparent bg-amber-500 text-amber-950",
  stash: "border-border bg-secondary text-secondary-foreground",
};
const HEAD_CHECKED_OUT_CLASS = "border-transparent bg-primary text-primary-foreground";

export default function RefBadge({ name, type, isHead }: RefBadgeProps) {
  const className = type === "head" && isHead ? HEAD_CHECKED_OUT_CLASS : CLASS_BY_TYPE[type];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0 font-sans text-[11px] leading-4 whitespace-nowrap ${className}`}
    >
      {name}
    </span>
  );
}
