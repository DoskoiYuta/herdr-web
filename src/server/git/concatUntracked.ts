export interface ConcatUntrackedResult {
  patch: string;
  untrackedCount: number;
  untrackedTruncated: boolean;
}

/**
 * Append per-file untracked-file diff pieces to the end of a base patch.
 * Only the first `limit` pieces are included; `untrackedCount` reports the
 * total regardless of truncation.
 */
export function concatUntracked(
  basePatch: string,
  pieces: string[],
  limit = 200,
): ConcatUntrackedResult {
  const included = pieces.slice(0, limit);
  let patch = basePatch;
  if (included.length > 0 && patch.length > 0 && !patch.endsWith("\n")) {
    patch += "\n";
  }
  patch += included.join("");

  return {
    patch,
    untrackedCount: pieces.length,
    untrackedTruncated: pieces.length > limit,
  };
}
