// 「一致しない質問 N 件」strip (F10): asks whose anchor no longer resolves
// against the current file content (`ForFileMatch.startLine === null`).
// Shown above the code viewer rather than inline, since there's no line to
// anchor them to; clicking one expands its AskThread right here.
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
  if (matches.length === 0) return null;

  return (
    <div
      className="border-b border-border bg-muted/40 px-2 py-1 text-xs"
      data-testid="ask-mismatch-strip"
    >
      <p className="mb-1 text-muted-foreground">一致しない質問 {matches.length} 件</p>
      <ul className="flex flex-col gap-1">
        {matches.map((match) => (
          <li key={match.ask.id}>
            <button
              type="button"
              className="flex w-full items-center gap-2 truncate text-left hover:text-foreground"
              onClick={() => setExpandedId((prev) => (prev === match.ask.id ? null : match.ask.id))}
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
    </div>
  );
}

export default AskMismatchStrip;
