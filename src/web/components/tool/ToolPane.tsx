import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentSessionInfo, AgentStatus } from "@contract/herdr";
import type { SubRepo } from "@contract/git";
import type { PaneRow, Repo } from "@contract/events";
import { DiffPanel, type DiffInitialLocation } from "@/components/diff/DiffPanel";
import { DockerPanel } from "@/components/docker/DockerPanel";
import { FilesPanel, type FilesInitialLocation } from "@/components/files/FilesPanel";
import { GraphPanel } from "@/components/graph/GraphPanel";
import { ProcessPanel } from "@/components/process/ProcessPanel";
import { useReviewCounts } from "@/components/review/hooks/useReviewCounts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { gitApi, reviewApi, SendTargetError } from "@/lib/api";
import type { AskEvent } from "@/lib/askEvent";
import type { ReviewEvent } from "@/lib/herdrStore";
import { reviewEventMatchesRepo } from "@/lib/reviewEvent";
import { agentPanesAt } from "@/lib/sendTargets";
import { cn } from "@/lib/utils";
import { STATUS_META } from "@/components/sidebar/PaneRow";
import { PaneLayoutMiniMap } from "./PaneLayoutMiniMap";
import { usePanePreview } from "./hooks/usePanePreview";

/** A sub-repo/submodule selection never gets its own `repoChangedTick` from
 * the server — the poller only watches the *focused* worktree (see
 * server/git/poller.ts) — so the diff/graph queries fall back to polling on
 * this interval while a non-root sub-repo is selected. */
const SUB_REPO_POLL_MS = 3000;

// Radix Select は value="" を許さないので、ルート（id ""）だけ番兵値に写す
const ROOT_SELECT_VALUE = "__root__";
const toSelectValue = (id: string) => (id === "" ? ROOT_SELECT_VALUE : id);
const fromSelectValue = (v: string) => (v === ROOT_SELECT_VALUE ? "" : v);

const SUB_REPO_KIND_LABEL: Record<SubRepo["kind"], string> = {
  root: "",
  submodule: "submodule",
  vcs: "vcstool",
};

export type CommitRange = { from: string; to: string } | null;

/** plan.md F2-2: フォーカス pane のエージェント情報。null はフォーカス無し/herdr 未接続。 */
export type ToolPaneFocusInfo = {
  agent: string | null;
  agentStatus: AgentStatus | null;
  agentSession: AgentSessionInfo | null;
};

/** 送信先が確定できなかったときの `POST /api/review/send` 409 レスポンスの表示文言。 */
const SEND_TARGET_ERROR_MESSAGE: Record<SendTargetError["type"], string> = {
  no_agent: "この worktree にエージェントがいません",
  ambiguous_target: "送信先を選んでください",
  invalid_target: "選んだセッションはこの worktree にいません",
};

/** Send-target picker candidate card (ToolPane's dialog, 2+ agent panes at
 * the current worktree). Renders immediately from `pane` (the sidebar's
 * PaneRow) and fills in workspace/tab/title, the layout minimap, and the
 * output tail once `usePanePreview` resolves — a failed/slow preview just
 * leaves those parts out, the card stays clickable throughout. */
function SendTargetCard({
  pane,
  fetchPreview,
  onSelect,
}: {
  pane: PaneRow;
  fetchPreview: boolean;
  onSelect: (paneId: string) => void;
}) {
  const { data: preview } = usePanePreview(pane.paneId, fetchPreview);
  const meta = STATUS_META[preview?.agentStatus ?? pane.agentStatus];
  const StatusIcon = meta.icon;
  const workspaceLabel = preview?.workspaceLabel ?? pane.workspaceLabel;
  const tabLabel = preview?.tabLabel ?? pane.tabLabel;
  const title = preview?.title ?? pane.label ?? pane.tabLabel ?? pane.paneId;
  const sessionId = preview?.agentSession?.slice(0, 8) ?? null;
  const tail = preview?.tail ?? [];

  return (
    <Button
      type="button"
      variant="outline"
      className="h-auto flex-col items-stretch gap-1.5 p-2 text-left whitespace-normal"
      onClick={() => onSelect(pane.paneId)}
    >
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">
          {workspaceLabel ?? "?"} › {tabLabel ?? "?"}
        </span>
        {sessionId && <span className="shrink-0 font-mono">{sessionId}</span>}
      </div>
      <div className="flex items-center gap-2">
        {preview?.layout && (
          <PaneLayoutMiniMap layout={preview.layout} candidatePaneId={pane.paneId} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <StatusIcon
              className={cn("size-3 shrink-0", meta.className, meta.spin && "animate-spin")}
            />
            <span className="truncate text-sm font-medium">{title}</span>
          </div>
          {tail.length > 0 && (
            <pre className="mt-1 max-h-24 overflow-hidden rounded bg-muted/50 p-1 font-mono text-[10px] whitespace-pre-wrap break-all text-muted-foreground">
              {tail.slice(-6).join("\n")}
            </pre>
          )}
        </div>
      </div>
    </Button>
  );
}

export interface ToolPaneProps {
  worktreeRoot: string | null;
  /** リポジトリキー（git-common-dir 絶対パス）。レビュー API に渡す `repo`。 */
  repoKey?: string | null;
  /** サイドバーツリーの repos。送信先候補（`worktreeRoot` のエージェント pane）を
   * 引くのに使う — サブリポジトリ選択中でも pane はこの worktree root に紐付く。 */
  repos?: Repo[];
  pinned: boolean;
  onPinToggle: () => void;
  repoChangedTick: number;
  onOpenPath: (root: string) => void;
  focusInfo?: ToolPaneFocusInfo | null;
  /** F5-9: review / review-notify WS イベントの購読（herdrStore から渡す）。 */
  subscribeReviewEvents?: (cb: (event: ReviewEvent) => void) => () => void;
  /** F10: ask / ask-notify WS イベントの購読（herdrStore から渡す）。herdrStore
   * がまだこのイベントを持たない間は未指定で、FilesPanel の for-file ポーリング
   * のみで追従する。 */
  subscribeAskEvents?: (cb: (event: AskEvent) => void) => () => void;
  /** F10: 質問セッション行の「対象ファイルを開く」からのジャンプ先。Files タブへ
   * 切り替え、該当ファイルを選択してスクロールする。一度消費したら親が null に
   * 戻す想定（DiffPanel の `initialLocation` と同じ流儀）。 */
  filesInitialLocation?: FilesInitialLocation | null;
  onFilesInitialLocationConsumed?: () => void;
  /** F13-7: 判断依頼への「場所を添付」導線。有効な間は Files タブへ切り替え、
   * 選ばれた場所を呼び出し元 (App.tsx) へ渡す。 */
  decisionAttachActive?: boolean;
  onAttachDecisionLocation?: (location: { path: string; lines: [number, number] }) => void;
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
  repoKey = null,
  repos = [],
  pinned,
  onPinToggle,
  repoChangedTick,
  onOpenPath,
  focusInfo,
  subscribeReviewEvents,
  subscribeAskEvents,
  filesInitialLocation = null,
  onFilesInitialLocationConsumed,
  decisionAttachActive = false,
  onAttachDecisionLocation,
}: ToolPaneProps) {
  const [comparison, setComparison] = useState<CommitRange>(null);
  const [activeTab, setActiveTab] = useState(() =>
    filesInitialLocation || decisionAttachActive ? "files" : "diff",
  );
  const [initialLocation, setInitialLocation] = useState<DiffInitialLocation | null>(null);

  // F10: 質問セッション行「対象ファイルを開く」が来たら Files タブへ切り替える
  // （React 公式の「変化した prop から state を合わせ込む」パターン、
  // `prevWorktreeRoot` と同じ発想）。
  const [prevFilesInitialLocation, setPrevFilesInitialLocation] = useState(filesInitialLocation);
  if (filesInitialLocation !== prevFilesInitialLocation) {
    setPrevFilesInitialLocation(filesInitialLocation);
    if (filesInitialLocation && activeTab !== "files") setActiveTab("files");
  }

  // F13-7: 判断依頼の「場所を添付」が始まったら同様に Files タブへ切り替える。
  const [prevDecisionAttachActive, setPrevDecisionAttachActive] = useState(decisionAttachActive);
  if (decisionAttachActive !== prevDecisionAttachActive) {
    setPrevDecisionAttachActive(decisionAttachActive);
    if (decisionAttachActive && activeTab !== "files") setActiveTab("files");
  }

  // A commit comparison picked in one worktree's Graph tab is meaningless
  // (and can even reference a hash the new worktree doesn't have) once focus
  // moves to a different worktree — drop back to the working tree comparison.
  // Adjusted during render (React's documented "state that depends on a
  // prop changing" pattern — see DiffPanel.tsx's `prevItemsForSelection` /
  // `prevInitialLocation`), not in an effect: an effect here would setState
  // synchronously on every worktreeRoot change and force an extra commit.
  const [prevWorktreeRoot, setPrevWorktreeRoot] = useState(worktreeRoot);
  // `subRepoId` is the selected entry's `SubRepo.id` ("" = the worktree
  // root itself). Reset alongside `comparison`/`initialLocation` when
  // `worktreeRoot` changes; deliberately NOT reset on `repoChangedTick`
  // (see ToolPaneProps).
  const [subRepoId, setSubRepoId] = useState("");
  if (worktreeRoot !== prevWorktreeRoot) {
    setPrevWorktreeRoot(worktreeRoot);
    if (comparison !== null) setComparison(null);
    if (initialLocation !== null) setInitialLocation(null);
    if (subRepoId !== "") setSubRepoId("");
  }

  // Sub-repository switcher (plan.md: submodules + `.repos/<child>` nested
  // repos). Listed even for a null worktreeRoot (query stays disabled) so
  // hook order is unconditional.
  const subReposQuery = useQuery({
    queryKey: ["subrepos", worktreeRoot],
    queryFn: () => gitApi.subrepos(worktreeRoot as string),
    enabled: worktreeRoot !== null,
    staleTime: Infinity,
    retry: false,
  });
  const subRepos = subReposQuery.data?.repos ?? [];
  const selectedSubRepo = subRepos.find((r) => r.id === subRepoId) ?? null;
  const isSubRepoSelected = selectedSubRepo !== null && selectedSubRepo.kind !== "root";
  const subRepoRoot = selectedSubRepo?.root ?? worktreeRoot ?? "";

  // repoKey にも選択中のサブリポジトリを反映する。サブリポジトリは herdr の
  // フォーカス pane が把握している repoKey とは別の git-common-dir を持つので、
  // 選択中は /api/git/root で都度解決する。
  const subRepoRootInfoQuery = useQuery({
    queryKey: ["git-root", subRepoRoot],
    queryFn: () => gitApi.root(subRepoRoot),
    enabled: isSubRepoSelected,
    staleTime: Infinity,
    retry: false,
  });
  const resolvedRepoKey = isSubRepoSelected
    ? (subRepoRootInfoQuery.data?.commonDir ?? null)
    : repoKey;
  // サブリポジトリ選択中は repoChangedTick が来ない（サーバの poller はフォーカス
  // 中の worktree しか見ていない — server/git/poller.ts）ため、diff/graph の
  // クエリをこの間隔でポーリングして代替する。
  const subRepoPollMs = isSubRepoSelected ? SUB_REPO_POLL_MS : undefined;

  const handleSelectCommit = useCallback((range: CommitRange) => {
    setComparison(range);
  }, []);

  const openDiffFor = useCallback((range: { from: string; to: string }) => {
    setComparison(range);
    setActiveTab("diff");
  }, []);

  const resetToWorktree = useCallback(() => {
    setComparison(null);
  }, []);

  const handleInitialLocationConsumed = useCallback(() => {
    setInitialLocation(null);
  }, []);

  // git-graph の review 件数バッジ + 送信ボタン（F5-10）。review WS イベントと
  // repoChangedTick の両方で tick を上げ、`staleTime: Infinity` のクエリを
  // 明示的に再フェッチする（useGraph/useReviewList と同じ流儀）。
  const [reviewTick, setReviewTick] = useState(0);
  const countsQuery = useReviewCounts(
    resolvedRepoKey && subRepoRoot ? { repo: resolvedRepoKey, worktree: subRepoRoot } : null,
    reviewTick + repoChangedTick,
  );
  const reviewCounts = countsQuery.data ?? null;
  const pendingDrafts = reviewCounts?.pendingDrafts ?? 0;

  useEffect(() => {
    if (!subscribeReviewEvents) return;
    return subscribeReviewEvents((event) => {
      if (reviewEventMatchesRepo(event, resolvedRepoKey)) setReviewTick((t) => t + 1);
    });
  }, [subscribeReviewEvents, resolvedRepoKey]);

  // 送信先候補は subRepoRoot ではなく worktreeRoot（実際の git worktree）に
  // 紐付く — pane はサブリポジトリ選択とは無関係にトップの worktree で開かれる。
  const agentPanes = useMemo(
    () => (worktreeRoot ? agentPanesAt(repos, worktreeRoot) : []),
    [repos, worktreeRoot],
  );

  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const sendTo = useCallback(
    async (pane?: string) => {
      if (!resolvedRepoKey || !subRepoRoot || sendBusy) return;
      setSendBusy(true);
      setSendError(null);
      try {
        await reviewApi.send({ repo: resolvedRepoKey, worktreeRoot: subRepoRoot, pane });
        setReviewTick((t) => t + 1);
        setPickerOpen(false);
      } catch (err) {
        setSendError(
          err instanceof SendTargetError
            ? SEND_TARGET_ERROR_MESSAGE[err.type]
            : "送信に失敗しました",
        );
      } finally {
        setSendBusy(false);
      }
    },
    [resolvedRepoKey, subRepoRoot, sendBusy],
  );

  const handleSend = useCallback(() => {
    if (pendingDrafts === 0 || sendBusy || agentPanes.length === 0) return;
    if (agentPanes.length === 1) {
      void sendTo(agentPanes[0]!.paneId);
      return;
    }
    setPickerOpen(true);
  }, [pendingDrafts, sendBusy, agentPanes, sendTo]);

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
          <div className="truncate text-xs text-muted-foreground">
            {selectedSubRepo && selectedSubRepo.id !== ""
              ? `${worktreeRoot}/${selectedSubRepo.id}`
              : worktreeRoot}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {subRepos.length > 1 && (
            <Select
              value={toSelectValue(subRepoId)}
              onValueChange={(v) => setSubRepoId(fromSelectValue(v))}
            >
              <SelectTrigger size="sm" className="max-w-40" aria-label="サブリポジトリを選択">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {subRepos.map((r) => (
                  <SelectItem key={r.id} value={toSelectValue(r.id)}>
                    <span className="truncate">{r.name}</span>
                    {SUB_REPO_KIND_LABEL[r.kind] && (
                      <span className="text-[10px] text-muted-foreground">
                        {SUB_REPO_KIND_LABEL[r.kind]}
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pendingDrafts === 0 || sendBusy || agentPanes.length === 0}
            title={agentPanes.length === 0 ? SEND_TARGET_ERROR_MESSAGE.no_agent : undefined}
            onClick={handleSend}
          >
            送信 ({pendingDrafts})
          </Button>
          <button
            type="button"
            onClick={onPinToggle}
            aria-pressed={pinned}
            aria-label={pinned ? "ピン留めを解除" : "ピン留め"}
            className="shrink-0 rounded-md px-1.5 py-1 text-sm hover:bg-muted"
          >
            📌
          </button>
        </div>
      </header>
      {sendError && (
        <p className="shrink-0 border-b border-border px-2 py-1 text-xs text-destructive">
          {sendError}
        </p>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>送信先を選択</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            {agentPanes.map((pane) => (
              <SendTargetCard
                key={pane.paneId}
                pane={pane}
                fetchPreview={pickerOpen}
                onSelect={(paneId) => void sendTo(paneId)}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {focusInfo && <FocusInfoBar focusInfo={focusInfo} />}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1">
        <TabsList className="mx-2 mt-2 w-fit">
          <TabsTrigger value="diff">Diff</TabsTrigger>
          <TabsTrigger value="graph">Graph</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="docker">Docker</TabsTrigger>
          <TabsTrigger value="process">Process</TabsTrigger>
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
            key={`${subRepoRoot}|${comparison?.from ?? ""}|${comparison?.to ?? ""}`}
            repo={subRepoRoot}
            repoKey={resolvedRepoKey}
            from={comparison?.from}
            to={comparison?.to}
            repoChangedTick={repoChangedTick}
            pollMs={subRepoPollMs}
            subscribeReviewEvents={subscribeReviewEvents}
            initialLocation={initialLocation}
            onInitialLocationConsumed={handleInitialLocationConsumed}
          />
        </TabsContent>

        <TabsContent value="graph" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {comparison && (
            <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1 text-xs text-muted-foreground">
              <span>
                選択中: {comparison.from.slice(0, 7)} vs {comparison.to.slice(0, 7)}
              </span>
              <Button type="button" size="sm" variant="ghost" onClick={() => setActiveTab("diff")}>
                Diff で見る
              </Button>
            </div>
          )}
          <div className="min-h-0 flex-1">
            <GraphPanel
              repo={subRepoRoot}
              repoChangedTick={repoChangedTick}
              pollMs={subRepoPollMs}
              onSelectCommit={handleSelectCommit}
              onOpenDiff={openDiffFor}
              reviewCounts={reviewCounts}
            />
          </div>
        </TabsContent>

        <TabsContent value="files" className="min-h-0 flex-1 overflow-hidden">
          <FilesPanel
            key={subRepoRoot}
            repo={subRepoRoot}
            repoChangedTick={repoChangedTick}
            pollMs={subRepoPollMs}
            repoKey={resolvedRepoKey}
            worktreeRoot={worktreeRoot}
            repos={repos}
            subscribeAskEvents={subscribeAskEvents}
            initialLocation={filesInitialLocation}
            onInitialLocationConsumed={onFilesInitialLocationConsumed}
            locationAttachActive={decisionAttachActive}
            onAttachLocation={onAttachDecisionLocation}
          />
        </TabsContent>

        <TabsContent value="docker" className="min-h-0 flex-1 overflow-hidden">
          <DockerPanel key={subRepoRoot} root={subRepoRoot} />
        </TabsContent>

        <TabsContent value="process" className="min-h-0 flex-1 overflow-hidden">
          <ProcessPanel key={subRepoRoot} root={subRepoRoot} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
