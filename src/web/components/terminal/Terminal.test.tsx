// Terminal は @xterm/xterm と @/lib/termSocket に強く依存するため、両方を
// テストダブルに差し替える（DiffView.test.tsx が @pierre/diffs/react を
// 差し替えるのと同じ発想）。ResizeObserver も jsdom に無いのでスタブする。
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { sendInput } from "@/lib/termSocket";
import type { TermSocketHandlers } from "@/lib/termSocket";

let capturedHandlers: TermSocketHandlers | null = null;
let capturedKeyHandler: ((e: unknown) => boolean) | null = null;
const closeMock = vi.fn();
const connectTermSocketMock = vi.fn(
  (
    _loc: unknown,
    _opts: unknown,
    handlers: TermSocketHandlers,
  ): { readyState: number; close: () => void } => {
    capturedHandlers = handlers;
    return { readyState: 1, close: closeMock };
  },
);

vi.mock("@/lib/termSocket", () => ({
  connectTermSocket: (...args: unknown[]) =>
    connectTermSocketMock(args[0], args[1], args[2] as TermSocketHandlers),
  sendInput: vi.fn(),
  sendResize: vi.fn(),
}));

// Plain functions that `return` their instance object (rather than assigning
// to `this`) so `new XTermStub()` etc. still work as constructors without
// tripping oxlint's react(no-this-in-sfc) — these files are scanned as if
// they might be components since they start with a capital letter.
vi.mock("@xterm/xterm", () => ({
  Terminal: function XTermStub() {
    return {
      cols: 80,
      rows: 24,
      loadAddon: vi.fn(),
      attachCustomKeyEventHandler: vi.fn((handler: (e: unknown) => boolean) => {
        capturedKeyHandler = handler;
      }),
      open: vi.fn(),
      write: vi.fn(),
      dispose: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
    };
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: function FitAddonStub() {
    return { fit: vi.fn() };
  },
}));
vi.mock("@xterm/addon-clipboard", () => ({
  ClipboardAddon: function ClipboardAddonStub() {
    return {};
  },
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: function WebglAddonStub() {
    return { onContextLoss: vi.fn() };
  },
}));

beforeEach(() => {
  capturedHandlers = null;
  capturedKeyHandler = null;
  connectTermSocketMock.mockClear();
  closeMock.mockClear();
  vi.mocked(sendInput).mockClear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const { Terminal } = await import("./Terminal");

test("shows the exit code when the socket closes after an exit frame", () => {
  render(<Terminal />);
  act(() => {
    capturedHandlers?.onExit(1);
    capturedHandlers?.onClose();
  });

  expect(screen.getByText(/終了しました \(code 1\)/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "再接続" })).toBeInTheDocument();
});

test("code 127 additionally hints that herdr couldn't be found", () => {
  render(<Terminal />);
  act(() => {
    capturedHandlers?.onExit(127);
    capturedHandlers?.onClose();
  });

  expect(screen.getByText(/終了しました \(code 127\)/)).toBeInTheDocument();
  expect(screen.getByText(/herdr が見つかりません（PATH を確認）/)).toBeInTheDocument();
});

test("a close with no prior exit frame shows the reconnect overlay without an exit reason", () => {
  render(<Terminal />);
  act(() => {
    capturedHandlers?.onClose();
  });

  expect(screen.getByRole("button", { name: "再接続" })).toBeInTheDocument();
  expect(screen.queryByText(/終了しました/)).not.toBeInTheDocument();
});

const shiftLeft = {
  type: "keydown",
  key: "ArrowLeft",
  shiftKey: true,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  preventDefault: vi.fn(),
};

test.each([
  [
    "config の keybinds に一致するキーは herdr へ送られ xterm には渡らない",
    { "shift+left": "\x1bx" },
    shiftLeft,
    "\x1bx",
  ],
  [
    "keybinds で shift+enter を上書きすると CSI u ではなくその文字列が送られる",
    { "shift+enter": "\x1by" },
    { ...shiftLeft, key: "Enter" },
    "\x1by",
  ],
] as const)("%s", (_label, keybinds, event, expected) => {
  render(<Terminal keybinds={keybinds} />);
  let passedToXterm: boolean | undefined;
  act(() => {
    passedToXterm = capturedKeyHandler?.(event);
  });

  expect(sendInput).toHaveBeenCalledWith(expect.anything(), expected);
  expect(passedToXterm).toBe(false);
});
