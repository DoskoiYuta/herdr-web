// Pure state helpers for the diff viewer. No DOM, no fetch, no
// localStorage — everything here is plain functions over plain data so it
// can be unit tested directly (state.test.ts).
//
// Trimmed port of tdiff's src/client/state.ts: this repo drops the
// SSE/EventSource connection tracking, the "server instance" binding
// concept, the notReady/503 path, and the quit flow — herdr-web has no
// long-running tdiff server process to be disconnected from or told to
// close. What's kept is:
//   - Settings (diffStyle / overflow), validated the same defensive way (a
//     corrupted persisted value falls back field-by-field rather than
//     invalidating the whole object). fontSize/showTree/treeWidth moved to
//     `@/lib/viewerSettings` — they're shared with the Files tab now.
//   - A small "banner" reducer capturing tdiff's update-available flow:
//     a freshly fetched patch hash that differs from what's currently
//     rendered raises a banner instead of forcing a re-render, and the
//     banner clears once that hash is actually applied.

export type DiffStyle = "split" | "unified";
export type Overflow = "wrap" | "scroll";

export interface Settings {
  diffStyle: DiffStyle;
  overflow: Overflow;
}

export const DEFAULT_SETTINGS: Settings = {
  diffStyle: "split",
  overflow: "wrap",
};

const DIFF_STYLE_VALUES = new Set<string>(["split", "unified"]);
const OVERFLOW_VALUES = new Set<string>(["wrap", "scroll"]);

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

  return out;
}

const SETTINGS_KEY = "herdr-web:diff-settings";

/** Also read/written by the settings dialog's "Diff の既定表示" (ui-redesign.md
 * §5.5) — kept in this pure module (rather than DiffPanel.tsx) so importing
 * it doesn't drag in DiffPanel's own module, which tests routinely mock
 * wholesale. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return validateSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore — settings just won't persist across reloads
  }
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
