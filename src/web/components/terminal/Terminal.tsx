// herdr TUI を xterm.js に描画する PTY attach ターミナル。
// アプリ状態は持たず、session だけを props で受け取る（F1）。

import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { encodeModifiedEnter, isMaximizeToggleKey } from "@/lib/termKeys";
import { connectTermSocket, sendInput, sendResize } from "@/lib/termSocket";
import { cn } from "@/lib/utils";

export type TerminalProps = {
  session?: string;
  className?: string;
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  /** D7: ⌘⇧M / Ctrl+Shift+M（xterm にフォーカスがあっても効く）。 */
  onToggleMaximize?: () => void;
};

const DEFAULT_FONT_FAMILY =
  '"BitstromWera Nerd Font Mono", "JetBrainsMono Nerd Font", "Hack Nerd Font", "FiraCode Nerd Font", "Symbols Nerd Font Mono", Menlo, monospace';
const DEFAULT_FONT_SIZE = 13;
const DEFAULT_LINE_HEIGHT = 1.0;

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
  onToggleMaximize,
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
      onToggleMaximize={onToggleMaximize}
      onReconnect={() => setReconnectNonce((n) => n + 1)}
    />
  );
}

type TerminalSessionProps = Required<
  Pick<TerminalProps, "fontFamily" | "fontSize" | "lineHeight">
> &
  Pick<TerminalProps, "session" | "className" | "onToggleMaximize"> & { onReconnect: () => void };

// key={reconnectNonce} で丸ごと再マウントすることで PTY 接続をやり直す。
// そのぶんこの内側のコンポーネントの effect 依存配列には
// 「再接続のためだけの値」が混ざらず、正確に保てる。
function TerminalSession({
  session,
  className,
  fontFamily,
  fontSize,
  lineHeight,
  onToggleMaximize,
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
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80">
          {exitCode !== null && (
            <div className="flex flex-col items-center gap-1 text-center text-sm">
              <p>終了しました (code {exitCode})</p>
              {exitCode === 127 && (
                <p className="text-muted-foreground">herdr が見つかりません（PATH を確認）</p>
              )}
            </div>
          )}
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
            onClick={onReconnect}
          >
            再接続
          </button>
        </div>
      )}
    </div>
  );
}
