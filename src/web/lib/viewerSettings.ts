// Shared, localStorage-persisted settings for the two single-column code
// viewers (Diff and Files, plan.md F3/F9): font size, whether the left tree
// is shown, and its width. Diff's own per-panel Settings (diffStyle/
// overflow) stays in diff/state.ts — those are diff-specific, not shared
// with Files. Backed by a `createLocalStorageStore` (lib/localStorageStore.ts)
// so a change from the settings dialog (ui-redesign.md §5.5) reaches an
// already-open Diff/Files panel without a remount.

import { MAX_FONT_SIZE, MIN_FONT_SIZE } from "./codeFont";
import { createLocalStorageStore } from "./localStorageStore";

export const MIN_TREE_WIDTH = 140;
export const MAX_TREE_WIDTH = 600;

export interface ViewerSettings {
  fontSize: number;
  showTree: boolean;
  treeWidth: number;
}

export const DEFAULT_VIEWER_SETTINGS: ViewerSettings = {
  fontSize: 13,
  showTree: true,
  treeWidth: 240,
};

const STORAGE_KEY = "herdr-web:viewer-settings";

/**
 * Clamp an arbitrary (possibly untrusted/corrupted) value to a valid
 * treeWidth: non-finite -> the default, otherwise clamped to
 * [MIN_TREE_WIDTH, MAX_TREE_WIDTH] and rounded to an integer.
 */
export function clampTreeWidth(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_VIEWER_SETTINGS.treeWidth;
  return Math.round(Math.min(MAX_TREE_WIDTH, Math.max(MIN_TREE_WIDTH, n)));
}

export function validateViewerSettings(
  raw: unknown,
  defaults: ViewerSettings = DEFAULT_VIEWER_SETTINGS,
): ViewerSettings {
  const out: ViewerSettings = { ...defaults };
  if (raw == null || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;

  if (
    typeof obj.fontSize === "number" &&
    Number.isFinite(obj.fontSize) &&
    obj.fontSize >= MIN_FONT_SIZE &&
    obj.fontSize <= MAX_FONT_SIZE
  ) {
    out.fontSize = obj.fontSize;
  }
  if (typeof obj.showTree === "boolean") {
    out.showTree = obj.showTree;
  }
  if (obj.treeWidth !== undefined) {
    out.treeWidth = clampTreeWidth(obj.treeWidth);
  }

  return out;
}

const store = createLocalStorageStore<ViewerSettings>({
  key: STORAGE_KEY,
  defaultValue: DEFAULT_VIEWER_SETTINGS,
  validate: validateViewerSettings,
});

export type UpdateViewerSettings = (partial: Partial<ViewerSettings>) => void;

/** Persisted viewer settings, shared by Diff, Files, and the settings dialog. */
export function useViewerSettings(): [ViewerSettings, UpdateViewerSettings] {
  return store.useStore();
}
