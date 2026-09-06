// `diff` Block: a unified patch, possibly touching several files.
// `@pierre/diffs` react's `PatchDiff` parses the raw patch text itself (no
// per-file loader — decision patches are display-only snapshots, not
// hydrated from a live worktree like DiffView.tsx's items).
import { PatchDiff } from "@pierre/diffs/react";
import { useIsDark } from "@/lib/useIsDark";
import { isTooLarge, TooLargeBlock } from "./TooLargeBlock";

export function DiffBlock({ patch }: { patch: string }) {
  const isDark = useIsDark();
  if (isTooLarge(patch)) return <TooLargeBlock text={patch} />;
  return (
    <PatchDiff
      patch={patch}
      options={{
        theme: { dark: "pierre-dark", light: "pierre-light" },
        themeType: isDark ? "dark" : "light",
      }}
    />
  );
}
