import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { applyTheme, loadTheme, saveTheme, setTheme } from "./theme";

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
});
