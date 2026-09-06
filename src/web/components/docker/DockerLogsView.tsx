// ログ領域は mount で /ws/docker-logs を開き、unmount で閉じる。これだけで
// 「展開を閉じる・タブを離れる・worktree を切り替える」の全部を止められる
// （呼び出し側が key={subRepoRoot} などで再マウントさせる前提、F11-9）。

import { useEffect, useRef, useState } from "react";
import { connectDockerLogsSocket } from "@/lib/dockerLogsSocket";
import { appendLines, type DockerLogLine } from "@/lib/dockerLogsBuffer";
import { cn } from "@/lib/utils";

export type DockerLogsViewProps = {
  root: string;
  id: string;
  className?: string;
};

const MAX_LINES = 2000;
// A viewer within this many px of the bottom still counts as "at the bottom"
// (a scrollbar can rest a few px short after a resize/reflow).
const BOTTOM_THRESHOLD_PX = 4;

export function DockerLogsView({ root, id, className }: DockerLogsViewProps) {
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
    <div className={cn("relative flex max-h-64 min-h-0 flex-col", className)}>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all bg-muted/20 p-2 font-mono text-xs"
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
  );
}

export default DockerLogsView;
