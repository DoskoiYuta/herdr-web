// Shared PathTree row-decoration colors for +additions/-deletions stats
// (Diff and Graph's commit file tree). @pierre/trees applies `color` as a
// raw inline style (see node_modules/@pierre/trees/dist/render/FileTreeView.js),
// not a Tailwind class, so these must be literal CSS colors rather than
// utility class names.
export const ADDITIONS_COLOR = "#059669"; // emerald-600
export const DELETIONS_COLOR = "#dc2626"; // red-600
