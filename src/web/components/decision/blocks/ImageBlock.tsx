// `image` Block: served from `/api/fs/raw`, which only allows
// paths under its configured roots — the actual containment check lives
// server-side (fsApi.rawUrl just builds the URL).
import { useState } from "react";
import { fsApi } from "@/lib/api";
import { cn } from "@/lib/utils";

export function ImageBlock({ path, worktreeRoot }: { path: string; worktreeRoot: string | null }) {
  const [error, setError] = useState(false);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [zoomed, setZoomed] = useState(false);

  if (worktreeRoot === null) {
    return (
      <p className="text-xs text-muted-foreground">
        画像を表示できません（依頼の呼び出し元 worktree が不明です）: {path}
      </p>
    );
  }
  if (error) {
    return <p className="text-xs text-muted-foreground">画像を読み込めません: {path}</p>;
  }
  const src = fsApi.rawUrl({ root: worktreeRoot, path, tick: 0 });
  return (
    <span className="flex w-fit shrink-0 flex-col items-start gap-1 self-start">
      <img
        src={src}
        alt={path}
        className={cn(
          "rounded-sm border border-border",
          zoomed ? "max-w-none cursor-zoom-out" : "h-auto max-w-full cursor-zoom-in",
        )}
        onLoad={(e) =>
          setDims({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
        }
        onError={() => setError(true)}
        onClick={() => setZoomed((z) => !z)}
      />
      <span className="text-xs text-muted-foreground">
        {path}
        {dims ? ` · ${dims.width}×${dims.height}` : ""}
      </span>
    </span>
  );
}
