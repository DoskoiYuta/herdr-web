// 「一致しない質問 N 件」strip (F10): asks whose anchor no longer resolves
// against the current file content (`ForFileMatch.startLine === null`).
// Shown above the code viewer rather than inline, since there's no line to
// anchor them to; clicking one expands its AskThread right here.
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import type { ForFileMatch } from "@/lib/api";
import { AskThread } from "./AskThread";

function firstLine(body: string): string {
  return (body.split("\n")[0] ?? "").trim();
}

export interface AskMismatchStripProps {
  matches: ForFileMatch[];
  onReply: (id: string, body: string) => void | Promise<void>;
  onResolve: (id: string) => void | Promise<void>;
  onResend: (id: string) => void | Promise<void>;
  onFocus: (id: string) => void | Promise<void>;
}

export function AskMismatchStrip({
  matches,
  onReply,
  onResolve,
  onResend,
  onFocus,
}: AskMismatchStripProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  if (matches.length === 0) return null;

  return (
    <div
      className="border-b border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs"
      data-testid="ask-mismatch-strip"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
          <RefreshCw className="size-3.5 shrink-0" aria-hidden />
          このファイルの内容と一致しない質問が {matches.length} 件あります（無効）
        </p>
        <button
          type="button"
          className="shrink-0 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => setCollapsed((prev) => !prev)}
        >
          {collapsed ? "表示" : "隠す"}
        </button>
      </div>
      {!collapsed && (
        <ul className="mt-1 flex flex-col gap-1">
          {matches.map((match) => (
            <li key={match.ask.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 truncate text-left hover:text-foreground"
                onClick={() =>
                  setExpandedId((prev) => (prev === match.ask.id ? null : match.ask.id))
                }
              >
                <span className="truncate font-mono text-muted-foreground">{match.ask.path}</span>
                <span className="truncate">{firstLine(match.ask.thread[0]?.body ?? "")}</span>
              </button>
              {expandedId === match.ask.id && (
                <AskThread
                  match={match}
                  onReply={onReply}
                  onResolve={onResolve}
                  onResend={onResend}
                  onFocus={onFocus}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default AskMismatchStrip;
