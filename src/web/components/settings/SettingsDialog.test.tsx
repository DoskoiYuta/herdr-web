import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Health } from "@contract/health";
import type { ClientConfig } from "@contract/config";

const healthMock = vi.fn<() => Promise<Health>>();
const configMock = vi.fn<() => Promise<ClientConfig>>();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  healthApi: { get: () => healthMock() },
  configApi: { get: () => configMock() },
}));

const { SettingsDialog } = await import("./SettingsDialog");
const { loadTheme } = await import("@/lib/theme");
const { loadSettings } = await import("@/components/diff/state");
const { DEFAULT_VIEWER_SETTINGS } = await import("@/lib/viewerSettings");

function renderDialog(onOpenChange = vi.fn()) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <SettingsDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  healthMock.mockResolvedValue({
    ok: true,
    version: "0.0.0",
    herdr: { connected: true, protocol: 20 },
  });
  configMock.mockResolvedValue({
    terminal: { fontFamily: "monospace", fontSize: 13, lineHeight: 1 },
    graphInitialCommits: 200,
    ask: { agents: ["claude"], defaultAgent: "claude", maxSessions: 5 },
    paths: {
      config: "/home/u/.config/herdr-web/config.json",
      db: "/home/u/.config/herdr-web/herdr-web.db",
    },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SettingsDialog theme", () => {
  test("selecting 'ダーク' applies the dark class and persists the choice", () => {
    renderDialog();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "ダーク" }));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(loadTheme()).toBe("dark");
  });

  test("selecting 'ライト' after 'ダーク' removes the dark class", () => {
    renderDialog();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "ダーク" }));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "ライト" }));

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(loadTheme()).toBe("light");
  });
});

describe("SettingsDialog font size", () => {
  test("clicking A+ increases and persists the shared viewer font size", async () => {
    renderDialog();
    const before = DEFAULT_VIEWER_SETTINGS.fontSize;
    expect(screen.getByText(String(before))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "文字を大きく" }));

    expect(await screen.findByText(String(before + 1))).toBeInTheDocument();
  });
});

describe("SettingsDialog diff defaults", () => {
  test("switching to unified persists diffStyle to the shared diff-settings key", () => {
    renderDialog();
    expect(loadSettings().diffStyle).toBe("split");

    fireEvent.mouseDown(screen.getByRole("tab", { name: "unified" }));

    expect(loadSettings().diffStyle).toBe("unified");
  });
});

describe("SettingsDialog connection", () => {
  test("shows the herdr connection state and protocol from /api/health", async () => {
    renderDialog();
    expect(await screen.findByText("接続済み · protocol 20")).toBeInTheDocument();
  });

  test("shows 未接続 when herdr isn't connected", async () => {
    healthMock.mockResolvedValue({
      ok: true,
      version: "0.0.0",
      herdr: { connected: false, protocol: null },
    });
    renderDialog();
    expect(await screen.findByText("未接続")).toBeInTheDocument();
  });
});

describe("SettingsDialog close", () => {
  test("clicking 閉じる calls onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    renderDialog(onOpenChange);
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
