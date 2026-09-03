// Pure state helpers for the diff viewer. No DOM, no fetch, no
// localStorage — everything here is plain functions over plain data so it
// can be unit tested directly (state.test.ts).
//
// Trimmed port of tdiff's src/client/state.ts: this repo drops the
// SSE/EventSource connection tracking, the "server instance" binding
// concept, the notReady/503 path, and the quit flow — herdr-web has no
// long-running tdiff server process to be disconnected from or told to
// close. What's kept is:
//   - Settings (diffStyle / overflow / fontSize / showTree / treeWidth),
//     validated the same defensive way (a corrupted persisted value falls
//     back field-by-field rather than invalidating the whole object).
//   - A small "banner" reducer capturing tdiff's update-available flow:
//     a freshly fetched patch hash that differs from what's currently
//     rendered raises a banner instead of forcing a re-render, and the
//     banner clears once that hash is actually applied.

import { MAX_FONT_SIZE, MIN_FONT_SIZE } from "./reconcile.ts";

export type DiffStyle = "split" | "unified";
export type Overflow = "wrap" | "scroll";

export interface Settings {
  diffStyle: DiffStyle;
  overflow: Overflow;
  fontSize: number;
  showTree: boolean;
  treeWidth: number;
}

export const DEFAULT_SETTINGS: Settings = {
  diffStyle: "split",
  overflow: "wrap",
  fontSize: 15,
  showTree: true,
  treeWidth: 240,
};

const DIFF_STYLE_VALUES = new Set<string>(["split", "unified"]);
const OVERFLOW_VALUES = new Set<string>(["wrap", "scroll"]);

export const MIN_TREE_WIDTH = 140;
export const MAX_TREE_WIDTH = 600;

/**
 * Clamp an arbitrary (possibly untrusted/corrupted) value to a valid
 * treeWidth: non-finite -> the default (240), otherwise clamped to
 * [MIN_TREE_WIDTH, MAX_TREE_WIDTH] and rounded to an integer.
 */
export function clampTreeWidth(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_SETTINGS.treeWidth;
  return Math.round(Math.min(MAX_TREE_WIDTH, Math.max(MIN_TREE_WIDTH, n)));
}

export function validateSettings(raw: unknown, defaults: Settings = DEFAULT_SETTINGS): Settings {
  const out: Settings = { ...defaults };
  if (raw == null || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.diffStyle === "string" && DIFF_STYLE_VALUES.has(obj.diffStyle)) {
    out.diffStyle = obj.diffStyle as DiffStyle;
  }
  if (typeof obj.overflow === "string" && OVERFLOW_VALUES.has(obj.overflow)) {
    out.overflow = obj.overflow as Overflow;
  }
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

// ---------------------------------------------------------------------------
// Update-available banner
// ---------------------------------------------------------------------------

export interface BannerState {
  /** hash of the patch currently rendered on screen, or null before the first render. */
  renderedHash: string | null;
  /** hash of a fetched-but-not-yet-applied patch, or null when nothing is pending. */
  pendingHash: string | null;
}

export function initialBannerState(): BannerState {
  return { renderedHash: null, pendingHash: null };
}

export type BannerEvent =
  /** A patch has just been applied (rendered) to the screen. */
  | { type: "applied"; hash: string }
  /** A patch fetch (initial or a refetch) resolved with this hash. */
  | { type: "fetched"; hash: string };

export function reduceBanner(state: BannerState, event: BannerEvent): BannerState {
  if (event.type === "applied") {
    return {
      renderedHash: event.hash,
      pendingHash: state.pendingHash === event.hash ? null : state.pendingHash,
    };
  }

  // 'fetched': before anything has ever been rendered, the first render
  // will show the latest content anyway — don't raise a banner for it.
  if (state.renderedHash === null) return state;
  const pendingHash = event.hash === state.renderedHash ? null : event.hash;
  return { ...state, pendingHash };
}

export interface UpdateBanner {
  text: string;
  hash: string;
}

/** Derive the (single, non-exclusive) update-available banner from state. */
export function updateBanner(state: BannerState): UpdateBanner | null {
  if (state.pendingHash == null) return null;
  return { text: "変更があります", hash: state.pendingHash };
}
