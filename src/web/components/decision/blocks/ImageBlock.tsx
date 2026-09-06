// `image` Block: served from `/api/fs/raw`, which only allows
// paths under its configured roots — the actual containment check lives
// server-side (fsApi.rawUrl just builds the URL).
import { fsApi } from "@/lib/api";

export function ImageBlock({ path, worktreeRoot }: { path: string; worktreeRoot: string | null }) {
  if (worktreeRoot === null) {
    return (
      <p className="text-xs text-muted-foreground">
        画像を表示できません（依頼の呼び出し元 worktree が不明です）: {path}
      </p>
    );
  }
  const src = fsApi.rawUrl({ root: worktreeRoot, path, tick: 0 });
  return <img src={src} alt={path} className="max-w-full" />;
}
