// design.pen colors a single-letter git-status marker at the end of each
// tree row (M=amber, ?=gray, A=green, D=red). @pierre/trees' own built-in
// git-status lane has no per-status color and always labels an untracked
// file "U" rather than "?", so PathTree hides that built-in lane (see its
// `unsafeCSS`) and this decoration is shown in the "custom decoration" lane
// instead, alongside the row's dispersed +N/−M stats.
import type { GitStatus } from "@pierre/trees";
import { ADDITIONS_COLOR, DELETIONS_COLOR } from "./decorationColors";

const LETTER: Record<GitStatus, string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  untracked: "?",
  ignored: "",
};

const MODIFIED_COLOR = "#d97706"; // amber-600
const RENAMED_COLOR = "#2563eb"; // blue-600
const UNTRACKED_COLOR = "#71717a"; // zinc-500 (gray)

const COLOR: Record<GitStatus, string> = {
  added: ADDITIONS_COLOR,
  deleted: DELETIONS_COLOR,
  modified: MODIFIED_COLOR,
  renamed: RENAMED_COLOR,
  untracked: UNTRACKED_COLOR,
  ignored: UNTRACKED_COLOR,
};

export function gitStatusLetter(status: GitStatus): string {
  return LETTER[status];
}

export function gitStatusLetterColor(status: GitStatus): string {
  return COLOR[status];
}

/** CSS injected into the tree's shadow DOM (see PathTree's `unsafeCSS`):
 * hides @pierre/trees' own uncolored git-status letter on file rows only
 * (a directory's "contains a git change" dot has no `data-item-git-status`
 * of its own, so it's unaffected and still shows). */
export const HIDE_BUILT_IN_FILE_GIT_STATUS_CSS =
  '[data-item-type="file"][data-item-git-status] [data-item-section="git"] { display: none; }';
