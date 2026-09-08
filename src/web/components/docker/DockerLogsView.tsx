// ログ領域は mount で /ws/docker-logs を開き、unmount で閉じる。これだけで
// 「展開を閉じる・タブを離れる・worktree を切り替える」の全部を止められる
// （呼び出し側が key={subRepoRoot} などで再マウントさせる前提、F11-9）。

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { connectDockerLogsSocket } from "@/lib/dockerLogsSocket";
import { appendLines, type DockerLogLine } from "@/lib/dockerLogsBuffer";
import { cn } from "@/lib/utils";

export type DockerLogsViewProps = {
  root: string;
  id: string;
  /** ヘッダーに出すコンテナ名（`docker logs` コマンド行の表示専用、実際の
   * ログ取得は `id` で行う）。 */
  name: string;
  onClose?: () => void;
  className?: string;
};

const MAX_LINES = 2000;
// A viewer within this many px of the bottom still counts as "at the bottom"
// (a scrollbar can rest a few px short after a resize/reflow).
const BOTTOM_THRESHOLD_PX = 4;

export function DockerLogsView({ root, id, name, onClose, className }: DockerLogsViewProps) {
  const [lines, setLines] = useState<DockerLogLine[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [following, setFollowing] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // root/id never change while an instance stays mounted (the caller
  // unmounts/remounts instead — see file header), so no in-effect reset is
  // needed beyond the useState initializers above.
  useEffect(() => {
    const ws = connectDockerLogsSocket(
      { protocol: location.protocol, host: location.host },
      { root, id },
      {
        onMessage: (msg) => {
          if (msg.type === "line") {
            setLines((prev) =>
              appendLines(prev, [{ stream: msg.stream, text: msg.text }], MAX_LINES),
            );
          } else if (msg.type === "exit") {
            setExitCode(msg.code);
          } else {
            setError(msg.message);
          }
        },
        onClose: () => {},
      },
    );

    return () => {
      ws.close();
    };
  }, [root, id]);

  // 末尾に居るときだけ自動スクロールする。DOM は effect が走る時点で
  // 既に新しい行を反映済みなので scrollHeight をそのまま読める。
  useEffect(() => {
    if (!following) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, following]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD_PX;
    setFollowing(atBottom);
  }

  function jumpToLatest() {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setFollowing(true);
  }

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1 font-mono text-xs text-muted-foreground">
        <span className="truncate">docker logs --follow --tail 200 {name}</span>
        <span className="flex shrink-0 items-center gap-2 font-sans">
          <span className="inline-flex items-center gap-1">
            <span
              className={cn(
                "size-1.5 rounded-full",
                following ? "bg-emerald-500" : "bg-muted-foreground",
              )}
              aria-hidden="true"
            />
            {following ? "フォロー中" : "追従を停止中"}
          </span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="閉じる"
              className="rounded p-0.5 hover:bg-muted"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </span>
      </div>
      {/* Fixed height, not flex-1: this view is embedded in a table cell
       * (ComposePanel's expanded row), whose height is intrinsic — a
       * flex-1 child there resolves to 0 and the log body disappears. */}
      <div className="relative h-56 shrink-0">
        <div
          ref={containerRef}
          data-testid="docker-logs-scroll"
          onScroll={handleScroll}
          className="h-56 overflow-auto whitespace-pre-wrap break-all bg-muted/20 p-2 font-mono text-[11px]"
        >
          {lines.map((line, i) => (
            <div key={i} className={line.stream === "stderr" ? "text-destructive" : undefined}>
              {line.text}
            </div>
          ))}
          {exitCode !== null && <div className="text-muted-foreground">終了 (code {exitCode})</div>}
          {error && <div className="text-destructive">{error}</div>}
        </div>
        {!following && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="absolute bottom-2 right-2 rounded bg-primary px-2 py-1 text-xs text-primary-foreground shadow"
          >
            最新へ
          </button>
        )}
      </div>
      <div className="shrink-0 border-t border-border px-2 py-1 text-[11px] text-muted-foreground">
        末尾 2000 行を保持 · 上にスクロールすると追従を止める
      </div>
    </div>
  );
}

export default DockerLogsView;
