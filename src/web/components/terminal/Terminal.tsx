// herdr TUI を xterm.js に描画する PTY attach ターミナル。
// アプリ状態は持たず、session だけを props で受け取る（F1）。

import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Unplug } from "lucide-react";
import { PanelState } from "@/components/ui/status/PanelState";
import {
  compileKeybinds,
  encodeModifiedEnter,
  isInboxToggleKey,
  isMaximizeToggleKey,
  matchKeybind,
} from "@/lib/termKeys";
import { connectTermSocket, sendInput, sendResize } from "@/lib/termSocket";
import { cn } from "@/lib/utils";

export type TerminalProps = {
  session?: string;
  className?: string;
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  /** config.json の `terminal.keybinds`（README「設定」参照）。 */
  keybinds?: Record<string, string>;
  /** D7: ⌘⇧M / Ctrl+Shift+M（xterm にフォーカスがあっても効く）。 */
  onToggleMaximize?: () => void;
  /** Inbox ダイアログの開閉（⌘I / Ctrl+I、xterm にフォーカスがあっても効く）。 */
  onToggleInbox?: () => void;
};

const DEFAULT_FONT_FAMILY =
  '"BitstromWera Nerd Font Mono", "JetBrainsMono Nerd Font", "Hack Nerd Font", "FiraCode Nerd Font", "Symbols Nerd Font Mono", Menlo, monospace';
const DEFAULT_FONT_SIZE = 13;
const DEFAULT_LINE_HEIGHT = 1.0;
const DEFAULT_KEYBINDS: Record<string, string> = { "shift+left": "\x1bb", "shift+right": "\x1bf" };

// ブラウザ標準のショートカットと衝突しうるキー。xterm 側へ渡した上で
// ブラウザの既定動作（新規タブ/ウィンドウを開く等）は止める。
const RESERVED_KEYS = new Set(["w", "t", "n"]);

function shouldPassToXterm(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey)) return true;
  const key = event.key.toLowerCase();
  if (RESERVED_KEYS.has(key) || (event.shiftKey && /^[a-z]$/.test(key))) {
    event.preventDefault();
  }
  return true;
}

/** CSS カスタムプロパティ（例: --background）を computed color に解決する */
function resolveCssColor(varName: string, fallback: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${varName})`;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved || fallback;
}

export function Terminal({
  session,
  className,
  fontFamily = DEFAULT_FONT_FAMILY,
  fontSize = DEFAULT_FONT_SIZE,
  lineHeight = DEFAULT_LINE_HEIGHT,
  keybinds = DEFAULT_KEYBINDS,
  onToggleMaximize,
  onToggleInbox,
}: TerminalProps) {
  const [reconnectNonce, setReconnectNonce] = useState(0);
  return (
    <TerminalSession
      key={reconnectNonce}
      session={session}
      className={className}
      fontFamily={fontFamily}
      fontSize={fontSize}
      lineHeight={lineHeight}
      keybinds={keybinds}
      onToggleMaximize={onToggleMaximize}
      onToggleInbox={onToggleInbox}
      onReconnect={() => setReconnectNonce((n) => n + 1)}
    />
  );
}

type TerminalSessionProps = Required<
  Pick<TerminalProps, "fontFamily" | "fontSize" | "lineHeight" | "keybinds">
> &
  Pick<TerminalProps, "session" | "className" | "onToggleMaximize" | "onToggleInbox"> & {
    onReconnect: () => void;
  };

// key={reconnectNonce} で丸ごと再マウントすることで PTY 接続をやり直す。
// そのぶんこの内側のコンポーネントの effect 依存配列には
// 「再接続のためだけの値」が混ざらず、正確に保てる。
function TerminalSession({
  session,
  className,
  fontFamily,
  fontSize,
  lineHeight,
  keybinds,
  onToggleMaximize,
  onToggleInbox,
  onReconnect,
}: TerminalSessionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  // 呼び出し側が毎レンダー新しい関数を渡しても PTY 接続をやり直さないよう、
  // 最新のコールバックは ref 経由で読む（effect の依存配列には積まない）。
  const onToggleMaximizeRef = useRef(onToggleMaximize);
  useEffect(() => {
    onToggleMaximizeRef.current = onToggleMaximize;
  }, [onToggleMaximize]);
  const onToggleInboxRef = useRef(onToggleInbox);
  useEffect(() => {
    onToggleInboxRef.current = onToggleInbox;
  }, [onToggleInbox]);
  // keybinds も同じ理由で ref 経由。毎キー入力での再パースを避けるため
  // config が変わったときだけ compileKeybinds でコンパイルし直す。
  const compiledKeybinds = useMemo(() => compileKeybinds(keybinds), [keybinds]);
  const keybindsRef = useRef(compiledKeybinds);
  useEffect(() => {
    keybindsRef.current = compiledKeybinds;
  }, [compiledKeybinds]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new XTerm({
      fontFamily,
      fontSize,
      lineHeight,
      theme: {
        background: resolveCssColor("--background", "#000000"),
        foreground: resolveCssColor("--foreground", "#ffffff"),
      },
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new ClipboardAddon());

    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    try {
      term.loadAddon(webgl);
    } catch {
      // WebGL が使えない環境ではデフォルトの canvas/dom レンダラーに任せる
    }

    term.attachCustomKeyEventHandler((event) => {
      if (isMaximizeToggleKey(event)) {
        event.preventDefault();
        onToggleMaximizeRef.current?.();
        return false;
      }
      if (isInboxToggleKey(event)) {
        event.preventDefault();
        onToggleInboxRef.current?.();
        return false;
      }
      const bound = matchKeybind(keybindsRef.current, event);
      if (bound !== null) {
        event.preventDefault();
        if (ws.readyState === WebSocket.OPEN) sendInput(ws, bound);
        return false;
      }
      const seq = encodeModifiedEnter(event);
      if (seq !== null) {
        event.preventDefault();
        if (ws.readyState === WebSocket.OPEN) sendInput(ws, seq);
        return false;
      }
      return shouldPassToXterm(event);
    });
    term.open(container);
    fit.fit();
    setDisconnected(false);
    setExitCode(null);
    // StrictMode の二重実行で、破棄済みソケットの close が新しい接続の overlay を出さないようにする
    let cancelled = false;

    const ws = connectTermSocket(
      { protocol: location.protocol, host: location.host },
      { session, cols: term.cols, rows: term.rows },
      {
        onOpen: () => sendResize(ws, term.cols, term.rows),
        onOutput: (data) => term.write(data),
        onExit: (code) => {
          if (!cancelled) setExitCode(code);
        },
        onClose: () => {
          if (!cancelled) setDisconnected(true);
        },
      },
    );

    const dataDisposable = term.onData((data) => sendInput(ws, data));

    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) sendResize(ws, term.cols, term.rows);
    });
    resizeObserver.observe(container);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      dataDisposable.dispose();
      ws.close();
      term.dispose();
    };
  }, [session, fontFamily, fontSize, lineHeight]);

  return (
    <div className={cn("relative h-full w-full", className)}>
      <div ref={containerRef} className="h-full w-full" />
      {disconnected && (
        <div className="absolute inset-0 bg-background/80">
          <PanelState
            icon={Unplug}
            title={exitCode !== null ? `終了しました (code ${exitCode})` : "接続が切断されました"}
            description={exitCode === 127 ? "herdr が見つかりません（PATH を確認）" : undefined}
            tone="warning"
            action={{ label: "再接続", onClick: onReconnect }}
          />
        </div>
      )}
    </div>
  );
}
