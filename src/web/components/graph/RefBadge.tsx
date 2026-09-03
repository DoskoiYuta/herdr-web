import type { RefType } from "@contract/git";

export interface RefBadgeProps {
  name: string;
  type: RefType;
  isHead: boolean;
}

const CLASS_BY_TYPE: Record<RefType, string> = {
  head: "border-primary/40 bg-primary/10 text-primary",
  remote: "border-border bg-muted text-muted-foreground",
  tag: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  stash: "border-border bg-secondary text-secondary-foreground",
};

export default function RefBadge({ name, type, isHead }: RefBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-1 py-0 text-[11px] leading-4 whitespace-nowrap ${CLASS_BY_TYPE[type]} ${isHead ? "font-semibold" : ""}`}
    >
      {name}
    </span>
  );
}
