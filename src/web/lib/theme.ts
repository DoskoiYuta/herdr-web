// テーマ設定（ui-redesign.md §5.5 D8）: `<html>` の `dark` クラスの付け外しは
// ここだけで行う。`useIsDark`（lib/useIsDark.ts）はそのクラスを
// MutationObserver で見ているだけなので、この付け外しに自動で追従する。

const STORAGE_KEY = "herdr-web:theme";

export type Theme = "system" | "light" | "dark";

const THEMES: readonly Theme[] = ["system", "light", "dark"];

export function loadTheme(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return (THEMES as readonly string[]).includes(raw ?? "") ? (raw as Theme) : "system";
  } catch {
    return "system";
  }
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore — the choice just won't persist across reloads
  }
}

function prefersDark(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/** `theme` が要求する実際のダーク/ライトを `<html>` に反映する。 */
export function applyTheme(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && prefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

// `system` のときだけ OS のダーク/ライト切替を購読する — 他のテーマに切り替え
// たら必ず外す（M16 レビュー指摘: 外さないと、後で system 以外へ切替えても
// OS 側の変更で `dark` クラスが勝手に付け外しされ続ける）。
let mediaQuery: MediaQueryList | null = null;
let mediaQueryListener: (() => void) | null = null;

function unregisterSystemListener(): void {
  if (mediaQuery && mediaQueryListener) {
    mediaQuery.removeEventListener("change", mediaQueryListener);
  }
  mediaQuery = null;
  mediaQueryListener = null;
}

function registerSystemListener(): void {
  // Always tear down any previous subscription first rather than treating a
  // non-null `mediaQuery` as "already registered, skip" — the latter would
  // keep listening on a stale `MediaQueryList` if `matchMedia` itself ever
  // changes (only actually happens in tests, but the cost of getting this
  // wrong — a permanently stuck theme — is worse than one redundant
  // add/removeEventListener pair).
  unregisterSystemListener();
  if (typeof matchMedia === "undefined") return;
  mediaQuery = matchMedia("(prefers-color-scheme: dark)");
  mediaQueryListener = () => applyTheme("system");
  mediaQuery.addEventListener("change", mediaQueryListener);
}

/** 起動時に一度呼ぶ（main.tsx）。 */
export function initTheme(): void {
  const theme = loadTheme();
  applyTheme(theme);
  if (theme === "system") registerSystemListener();
}

/** 設定ダイアログのテーマ切替: 保存して即座に反映し、購読を `theme` に合わせる。 */
export function setTheme(theme: Theme): void {
  saveTheme(theme);
  applyTheme(theme);
  if (theme === "system") registerSystemListener();
  else unregisterSystemListener();
}
