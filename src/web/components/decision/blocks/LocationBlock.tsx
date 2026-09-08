// `location` Block: opens the same path in the Files tab that
// ask's "対象ファイルを開く" uses (App.tsx's `handleOpenAskFile` path), so a
// human can jump straight from context/preview to the real file.
import { FileCode } from "lucide-react";

export function LocationBlock({
  path,
  lines,
  worktreeRoot,
  onOpen,
}: {
  path: string;
  lines: [number, number] | null;
  worktreeRoot: string | null;
  onOpen?: (location: {
    worktreeRoot: string;
    path: string;
    lines: [number, number] | null;
  }) => void;
}) {
  const lineLabel = lines
    ? lines[0] === lines[1]
      ? `:L${lines[0]}`
      : `:L${lines[0]}–${lines[1]}`
    : null;
  if (worktreeRoot === null || !onOpen) {
    return (
      <span className="inline-flex w-fit shrink-0 items-center gap-1.5 self-start rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
        <FileCode className="size-3.5 shrink-0" />
        <span className="font-mono">{path}</span>
        {lineLabel && <span>{lineLabel}</span>}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="inline-flex w-fit shrink-0 items-center gap-1.5 self-start rounded bg-muted px-2 py-1 text-xs hover:bg-accent"
      onClick={() => onOpen({ worktreeRoot, path, lines })}
    >
      <FileCode className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="font-mono">{path}</span>
      {lineLabel && <span className="text-muted-foreground">{lineLabel}</span>}
      <span className="text-muted-foreground">Files で開く →</span>
    </button>
  );
}
