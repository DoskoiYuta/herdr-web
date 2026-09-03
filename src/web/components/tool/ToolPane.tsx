import { Check, Copy } from "lucide-react";
import { useCallback, useState } from "react";
import type { AgentSessionInfo, AgentStatus } from "@contract/herdr";
import { DiffPanel } from "@/components/diff/DiffPanel";
import { GraphPanel } from "@/components/graph/GraphPanel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { gitApi } from "@/lib/api";

export type CommitRange = { from: string; to: string } | null;

/** plan.md F2-2: フォーカス pane のエージェント情報。null はフォーカス無し/herdr 未接続。 */
export type ToolPaneFocusInfo = {
  agent: string | null;
  agentStatus: AgentStatus | null;
  agentSession: AgentSessionInfo | null;
};

export interface ToolPaneProps {
  worktreeRoot: string | null;
  pinned: boolean;
  onPinToggle: () => void;
  repoChangedTick: number;
  onOpenPath: (root: string) => void;
  focusInfo?: ToolPaneFocusInfo | null;
}

function ResumeCopyButton({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false);
  const command = `claude --resume ${sessionId}`;

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボード API が使えない環境では何もしない
    }
  }, [command]);

  return (
    <Button type="button" size="xs" variant="outline" onClick={copy} className="gap-1">
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {command}
    </Button>
  );
}

function FocusInfoBar({ focusInfo }: { focusInfo: ToolPaneFocusInfo }) {
  if (!focusInfo.agent && !focusInfo.agentSession) return null;
  const session = focusInfo.agentSession;
  const showResume = session?.source === "herdr:claude" && session.kind === "id";

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-2 py-1 text-xs text-muted-foreground">
      {focusInfo.agent && (
        <span>
          {focusInfo.agent}
          {focusInfo.agentStatus ? ` · ${focusInfo.agentStatus}` : ""}
        </span>
      )}
      {showResume && <ResumeCopyButton sessionId={session.value} />}
    </div>
  );
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

function OpenPathForm({ onOpenPath }: { onOpenPath: (root: string) => void }) {
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!path.trim()) return;
      setBusy(true);
      setError(null);
      try {
        const info = await gitApi.root(path.trim());
        onOpenPath(info.root);
      } catch {
        setError("パスを解決できませんでした");
      } finally {
        setBusy(false);
      }
    },
    [path, onOpenPath],
  );

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-2">
      <label htmlFor="tool-pane-open-path" className="text-sm text-muted-foreground">
        リポジトリのパスを開く
      </label>
      <div className="flex gap-2">
        <input
          id="tool-pane-open-path"
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/path/to/worktree"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
        <Button type="submit" size="sm" disabled={busy}>
          開く
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}

export function ToolPane({
  worktreeRoot,
  pinned,
  onPinToggle,
  repoChangedTick,
  onOpenPath,
  focusInfo,
}: ToolPaneProps) {
  const [comparison, setComparison] = useState<CommitRange>(null);

  const handleSelectCommit = useCallback((range: CommitRange) => {
    setComparison(range);
  }, []);

  const resetToWorktree = useCallback(() => {
    setComparison(null);
  }, []);

  if (!worktreeRoot) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-4 text-center">
        <p className="text-sm text-muted-foreground">herdr 未接続 / worktree 未選択</p>
        <OpenPathForm onOpenPath={onOpenPath} />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{basename(worktreeRoot)}</div>
          <div className="truncate text-xs text-muted-foreground">{worktreeRoot}</div>
        </div>
        <button
          type="button"
          onClick={onPinToggle}
          aria-pressed={pinned}
          aria-label={pinned ? "ピン留めを解除" : "ピン留め"}
          className="shrink-0 rounded-md px-1.5 py-1 text-sm hover:bg-muted"
        >
          📌
        </button>
      </header>

      {focusInfo && <FocusInfoBar focusInfo={focusInfo} />}

      <Tabs defaultValue="diff" className="min-h-0 flex-1">
        <TabsList className="mx-2 mt-2 w-fit">
          <TabsTrigger value="diff">Diff</TabsTrigger>
          <TabsTrigger value="graph">Graph</TabsTrigger>
          <TabsTrigger value="review">Review</TabsTrigger>
        </TabsList>

        <TabsContent value="diff" className="min-h-0 flex-1 overflow-hidden">
          {comparison && (
            <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1 text-xs text-muted-foreground">
              <span>
                {comparison.from.slice(0, 7)} vs {comparison.to.slice(0, 7)}
              </span>
              <Button type="button" size="sm" variant="ghost" onClick={resetToWorktree}>
                作業ツリーに戻る
              </Button>
            </div>
          )}
          <DiffPanel
            repo={worktreeRoot}
            from={comparison?.from}
            to={comparison?.to}
            repoChangedTick={repoChangedTick}
          />
        </TabsContent>

        <TabsContent value="graph" className="min-h-0 flex-1 overflow-hidden">
          <GraphPanel
            repo={worktreeRoot}
            repoChangedTick={repoChangedTick}
            onSelectCommit={handleSelectCommit}
          />
        </TabsContent>

        <TabsContent
          value="review"
          className="min-h-0 flex-1 overflow-hidden p-2 text-sm text-muted-foreground"
        >
          レビューは未実装です。
        </TabsContent>
      </Tabs>
    </div>
  );
}
