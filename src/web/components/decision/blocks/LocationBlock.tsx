// `location` Block: opens the same path in the Files tab that
// ask's "対象ファイルを開く" uses (App.tsx's `handleOpenAskFile` path), so a
// human can jump straight from context/preview to the real file.
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
  const label = lines ? `${path}:${lines[0]}-${lines[1]}` : path;
  if (worktreeRoot === null || !onOpen) {
    return <span className="text-sm text-muted-foreground">{label}</span>;
  }
  return (
    <button
      type="button"
      className="text-sm text-primary underline underline-offset-2"
      onClick={() => onOpen({ worktreeRoot, path, lines })}
    >
      {label}
    </button>
  );
}
