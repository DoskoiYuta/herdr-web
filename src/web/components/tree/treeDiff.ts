// Pure set-difference helper for FilesTree.tsx's incremental sync with
// @pierre/trees' FileTree model. Recreating the model on every tree refetch
// would discard its internal state (expansion, search, selection); instead
// FilesTree diffs the previously-applied path list against the new one and
// only tells the model what changed via `model.batch()`.

export interface TreePathDiff {
  added: string[];
  removed: string[];
}

export function diffPaths(prev: readonly string[], next: readonly string[]): TreePathDiff {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  return {
    added: next.filter((p) => !prevSet.has(p)),
    removed: prev.filter((p) => !nextSet.has(p)),
  };
}
