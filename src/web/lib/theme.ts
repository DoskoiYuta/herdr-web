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

/** 起動時に一度呼ぶ（main.tsx）。`system` のときは OS 設定の変更にも追従する
 * — 呼び出し元はアプリの寿命いっぱい生きているので購読の解除は不要。 */
export function initTheme(): void {
  const theme = loadTheme();
  applyTheme(theme);
  if (theme === "system" && typeof matchMedia !== "undefined") {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (loadTheme() === "system") applyTheme("system");
    });
  }
}

/** 設定ダイアログのテーマ切替: 保存して即座に反映する。 */
export function setTheme(theme: Theme): void {
  saveTheme(theme);
  applyTheme(theme);
}
