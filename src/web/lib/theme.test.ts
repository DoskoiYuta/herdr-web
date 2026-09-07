import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { applyTheme, initTheme, loadTheme, saveTheme, setTheme } from "./theme";

function stubPrefersDark(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

/** A `matchMedia` stub that remembers its listener and lets a test flip
 * `.matches` and fire a real "change" event through it — for testing that
 * `system` actually tracks a live OS preference change (not just the value
 * at the moment `applyTheme`/`setTheme` was called). */
function stubLiveMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<() => void>();
  const mql = {
    get matches() {
      return matches;
    },
    addEventListener: vi.fn((_event: string, listener: () => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_event: string, listener: () => void) => {
      listeners.delete(listener);
    }),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mql),
  );
  return {
    setMatches(next: boolean) {
      matches = next;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
    mql,
  };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadTheme", () => {
  test("defaults to 'system' with nothing stored", () => {
    expect(loadTheme()).toBe("system");
  });

  test("defaults to 'system' for a corrupted stored value", () => {
    localStorage.setItem("herdr-web:theme", "not-a-theme");
    expect(loadTheme()).toBe("system");
  });

  test("round-trips a value saved by saveTheme", () => {
    saveTheme("dark");
    expect(loadTheme()).toBe("dark");
  });
});

describe("applyTheme", () => {
  test.each([
    ["dark" as const, true, true],
    ["light" as const, true, false],
    ["system" as const, true, true],
    ["system" as const, false, false],
  ])("theme=%s, OS prefers dark=%s -> dark class present: %s", (theme, osDark, expectDark) => {
    stubPrefersDark(osDark);
    applyTheme(theme);
    expect(document.documentElement.classList.contains("dark")).toBe(expectDark);
  });

  test("switching from dark to light removes the class", () => {
    stubPrefersDark(false);
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("setTheme", () => {
  test("persists the choice and applies it immediately", () => {
    stubPrefersDark(false);
    setTheme("dark");
    expect(loadTheme()).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  // 無いと壊れる: 起動後に system へ切り替えても OS のテーマ変更に一切追従
  // しない（初回の値のまま固定される）。
  test("switching to 'system' at runtime tracks a later OS preference change", () => {
    const media = stubLiveMatchMedia(false);
    setTheme("light");
    setTheme("system");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    media.setMatches(true);

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  // 無いと壊れる: system から離れたあとも購読が残ると、OS 側の変更で
  // dark クラスが勝手に付け外しされ続ける。
  test("switching away from 'system' stops tracking OS preference changes", () => {
    const media = stubLiveMatchMedia(false);
    setTheme("system");
    setTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    media.setMatches(true);

    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  test("switching to 'system' twice does not register a second listener", () => {
    const media = stubLiveMatchMedia(false);
    setTheme("system");
    setTheme("system");
    expect(media.listenerCount()).toBe(1);
  });
});

describe("initTheme", () => {
  // レビュー指摘の起点シナリオ: light で起動したあと system に切り替える。
  test("starting with 'light' then switching to 'system' still tracks OS changes", () => {
    localStorage.setItem("herdr-web:theme", "light");
    const media = stubLiveMatchMedia(false);
    initTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    setTheme("system");
    media.setMatches(true);

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  test("starting with 'system' tracks OS changes without an explicit setTheme call", () => {
    localStorage.setItem("herdr-web:theme", "system");
    const media = stubLiveMatchMedia(false);
    initTheme();

    media.setMatches(true);

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
