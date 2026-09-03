// herdr TUI を xterm.js に描画する PTY attach ターミナル。
// アプリ状態は持たず、session だけを props で受け取る（F1）。

import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { connectTermSocket, sendInput, sendResize } from "@/lib/termSocket";
import { cn } from "@/lib/utils";

export type TerminalProps = {
  session?: string;
  className?: string;
  fontFamily?: string;
};

const DEFAULT_FONT_FAMILY =
  '"JetBrainsMono Nerd Font", "JetBrainsMono NF", "Hack Nerd Font", "FiraCode Nerd Font", "Symbols Nerd Font Mono", monospace';

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

export function Terminal({ session, className, fontFamily = DEFAULT_FONT_FAMILY }: TerminalProps) {
  const [reconnectNonce, setReconnectNonce] = useState(0);
  return (
    <TerminalSession
      key={reconnectNonce}
      session={session}
      className={className}
      fontFamily={fontFamily}
      onReconnect={() => setReconnectNonce((n) => n + 1)}
    />
  );
}

type TerminalSessionProps = Required<Pick<TerminalProps, "fontFamily">> &
  Pick<TerminalProps, "session" | "className"> & { onReconnect: () => void };

// key={reconnectNonce} で丸ごと再マウントすることで PTY 接続をやり直す。
// そのぶんこの内側のコンポーネントの effect 依存配列には
// 「再接続のためだけの値」が混ざらず、正確に保てる。
function TerminalSession({ session, className, fontFamily, onReconnect }: TerminalSessionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new XTerm({
      fontFamily,
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

    term.attachCustomKeyEventHandler(shouldPassToXterm);
    term.open(container);
    fit.fit();
    setDisconnected(false);
    // StrictMode の二重実行で、破棄済みソケットの close が新しい接続の overlay を出さないようにする
    let cancelled = false;

    const ws = connectTermSocket(
      { protocol: location.protocol, host: location.host },
      { session, cols: term.cols, rows: term.rows },
      {
        onOpen: () => sendResize(ws, term.cols, term.rows),
        onOutput: (data) => term.write(data),
        onExit: () => {
          /* close は onClose 側でハンドルする */
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
  }, [session, fontFamily]);

  return (
    <div className={cn("relative h-full w-full", className)}>
      <div ref={containerRef} className="h-full w-full" />
      {disconnected && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80">
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
