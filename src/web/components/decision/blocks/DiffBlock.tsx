// `diff` Block: a unified patch for a single file (`@pierre/diffs`'s
// `PatchDiff` throws if the patch touches more than one file — multi-file
// support is a separate task). It parses the raw patch text itself (no
// per-file loader — decision patches are display-only snapshots, not
// hydrated from a live worktree like DiffView.tsx's items). Rendered as a
// single unified column regardless of viewport — the split view's per-file
// tab header doesn't fit the option preview's fixed width.
import type { FileDiffMetadata } from "@pierre/diffs";
import { PatchDiff } from "@pierre/diffs/react";
import { hunkStats } from "@/components/diff/reconcile";
import { useIsDark } from "@/lib/useIsDark";
import { isTooLarge, TooLargeBlock } from "./TooLargeBlock";

// `parsePatchFiles` keeps the raw `a/`/`b/` prefix from the patch's `---`/
// `+++` lines verbatim (it has no other way to know the real strip level) —
// strip it for display, matching the path git itself reports in `status`.
function displayName(name: string): string {
  return name.replace(/^[ab]\//, "");
}

export function DiffBlock({ patch }: { patch: string }) {
  const isDark = useIsDark();
  if (isTooLarge(patch)) return <TooLargeBlock text={patch} />;
  return (
    <PatchDiff
      patch={patch}
      className="block w-full max-w-full overflow-hidden rounded-md border border-border"
      options={{
        diffStyle: "unified",
        theme: { dark: "pierre-dark", light: "pierre-light" },
        themeType: isDark ? "dark" : "light",
      }}
      renderCustomHeader={(fileDiff: FileDiffMetadata) => {
        const { additions, deletions } = hunkStats(fileDiff);
        return (
          <div className="flex items-center justify-between gap-2 bg-muted px-2 py-1 font-mono text-xs">
            <span className="truncate">{displayName(fileDiff.name)}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>
              <span className="text-red-600 dark:text-red-400">−{deletions}</span>
            </span>
          </div>
        );
      }}
    />
  );
}
