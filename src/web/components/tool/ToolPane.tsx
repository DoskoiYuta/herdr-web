import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SubRepo } from "@contract/git";
import type { PaneRow } from "@contract/events";
import { DiffPanel, type DiffInitialLocation } from "@/components/diff/DiffPanel";
import { DockerPanel } from "@/components/docker/DockerPanel";
import { FilesPanel } from "@/components/files/FilesPanel";
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
import { useHerdrState, useReviewEvents } from "@/lib/HerdrStoreContext";
import { reviewEventMatchesRepo } from "@/lib/reviewEvent";
import { agentPanesAt } from "@/lib/sendTargets";
import { cn } from "@/lib/utils";
import { normalizeTab, type ToolSearch, type ToolTab } from "@/router/search";
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

const EMPTY_SEARCH: ToolSearch = {};

const routeApi = getRouteApi("/focus/$tab");

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

function FocusInfoBar({
  focusInfo,
}: {
  focusInfo: NonNullable<ReturnType<typeof useHerdrState>["focus"]>;
}) {
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

/** `/focus/$tab` の唯一の下で描画される — URL がタブ・比較範囲・選択サブ
 * リポジトリ・ジャンプ先の唯一の正になる（plan.md F2-4: ピン留めは持たない）。
 * このコンポーネント自身はローカル state を持たない（送信ダイアログの開閉や
 * エラー文言のような一時的な UI 状態を除く）。 */
export function ToolPane() {
  const params = routeApi.useParams();
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const state = useHerdrState();

  const worktreeRoot = state.focus?.worktreeRoot ?? null;
  const tab: ToolTab = normalizeTab(params.tab);
  const repos = state.repos;
  const repoKey = state.focus?.repoKey ?? null;
  const focusInfo = state.focus;
  const repoChangedTick = worktreeRoot ? (state.repoChanged[worktreeRoot]?.tick ?? 0) : 0;

  // 別 worktree のファイル位置を開く導線（router.tsx useOpenWorktreeLocation）が
  // 付ける search の `root`: herdr の focus がまだその worktree に切り替わって
  // いない間は、`path`/`line` を今表示中の（無関係な）worktree に適用しない
  // ゲート。focus が追いついたら消す。
  const intendedRoot = search.root ?? null;
  const rootPending = intendedRoot !== null && intendedRoot !== worktreeRoot;
  useEffect(() => {
    if (intendedRoot !== null && intendedRoot === worktreeRoot) {
      void navigate({ search: (prev) => ({ ...prev, root: undefined }), replace: true });
    }
  }, [intendedRoot, worktreeRoot, navigate]);

  // `/focus/$tab` の worktreeRoot は herdr の focus に追従するので、URL を変えずに
  // 変わることがある。前の worktree の比較範囲・選択サブリポジトリ・ジャンプ先が
  // 新しい worktree に持ち越されないよう、値が変わった回だけ search を空にする
  // — ただし上の `root` ゲートが今回の変化を待っていた場合（意図した遷移）は
  // 対象外にする。`navigate()` は次のレンダーまで URL に反映されないため、
  // worktreeRoot が変わったレンダー自身でも旧 search を使わないよう、React の
  // 「レンダー中に state を調整する」パターン（FilesPanel.tsx の selectedPath
  // 切り替えと同様）で `searchCleared` を同じレンダーパス内に確定させる。effect
  // は URL を実際に空にする navigate の発行だけを担い、`searchCleared` 自体は
  // URL が実際に空になったことを検知したレンダーで戻す（effect 内で setState
  // しない）。
  const [trackedWorktreeRoot, setTrackedWorktreeRoot] = useState(worktreeRoot);
  const [searchCleared, setSearchCleared] = useState(false);
  if (trackedWorktreeRoot !== worktreeRoot) {
    setTrackedWorktreeRoot(worktreeRoot);
    if (intendedRoot !== worktreeRoot) {
      setSearchCleared(true);
    }
  } else if (searchCleared && Object.keys(search).length === 0) {
    setSearchCleared(false);
  }
  const effectiveSearch = searchCleared ? EMPTY_SEARCH : search;
  useEffect(() => {
    if (searchCleared) void navigate({ search: () => ({}), replace: true });
  }, [searchCleared, navigate]);

  const comparison: CommitRange =
    effectiveSearch.from && effectiveSearch.to
      ? { from: effectiveSearch.from, to: effectiveSearch.to }
      : null;
  const subRepoId = effectiveSearch.sub ?? "";
  const initialLocation: DiffInitialLocation | null =
    tab === "diff" && !rootPending && effectiveSearch.path
      ? { path: effectiveSearch.path, line: effectiveSearch.line ?? 1, side: "new" }
      : null;
  const filesSelectedPath = tab === "files" && !rootPending ? (effectiveSearch.path ?? null) : null;
  const filesMdMode = effectiveSearch.md ?? "preview";
  const filesInitialLocation =
    tab === "files" && !rootPending && effectiveSearch.path && effectiveSearch.line
      ? { path: effectiveSearch.path, line: effectiveSearch.line }
      : null;

  const handleTabChange = useCallback(
    (nextTab: string) => {
      void navigate({
        params: (prev) => ({ ...prev, tab: nextTab }),
        search: (prev) => ({ ...prev, path: undefined, line: undefined, root: undefined }),
      });
    },
    [navigate],
  );

  const handleSelectCommit = useCallback(
    (range: CommitRange) => {
      void navigate({ search: (prev) => ({ ...prev, from: range?.from, to: range?.to }) });
    },
    [navigate],
  );

  const openDiffFor = useCallback(
    (range: { from: string; to: string }) => {
      void navigate({
        params: (prev) => ({ ...prev, tab: "diff" }),
        search: (prev) => ({ ...prev, from: range.from, to: range.to }),
      });
    },
    [navigate],
  );

  const resetToWorktree = useCallback(() => {
    void navigate({ search: (prev) => ({ ...prev, from: undefined, to: undefined }) });
  }, [navigate]);

  const handleInitialLocationConsumed = useCallback(() => {
    void navigate({ search: (prev) => ({ ...prev, path: undefined, line: undefined }) });
  }, [navigate]);

  const handleFilesSelectedPathChange = useCallback(
    (path: string | null) => {
      // 別ファイルを選ぶと `md`（ソース/プレビュー切替）も一緒に落とす —
      // 前のファイルで選んでいた表示モードが無関係な新しいファイルに残らない
      // ようにする。
      void navigate({
        search: (prev) => ({ ...prev, path: path ?? undefined, line: undefined, md: undefined }),
      });
    },
    [navigate],
  );

  const handleFilesMdModeChange = useCallback(
    (mode: "source" | "preview") => {
      void navigate({ search: (prev) => ({ ...prev, md: mode === "preview" ? undefined : mode }) });
    },
    [navigate],
  );

  const handleFilesInitialLocationConsumed = useCallback(() => {
    void navigate({ search: (prev) => ({ ...prev, line: undefined }) });
  }, [navigate]);

  const handleSubRepoChange = useCallback(
    (id: string) => {
      void navigate({
        search: (prev) => ({
          ...prev,
          sub: id === "" ? undefined : id,
          from: undefined,
          to: undefined,
          path: undefined,
          line: undefined,
          root: undefined,
        }),
      });
    },
    [navigate],
  );

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

  useReviewEvents(
    useCallback(
      (event) => {
        if (reviewEventMatchesRepo(event, resolvedRepoKey)) setReviewTick((t) => t + 1);
      },
      [resolvedRepoKey],
    ),
  );

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
              onValueChange={(v) => handleSubRepoChange(fromSelectValue(v))}
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

      <Tabs value={tab} onValueChange={handleTabChange} className="min-h-0 flex-1">
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
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => handleTabChange("diff")}
              >
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
            selectedPath={filesSelectedPath}
            onSelectedPathChange={handleFilesSelectedPathChange}
            mdMode={filesMdMode}
            onMdModeChange={handleFilesMdModeChange}
            initialLocation={filesInitialLocation}
            onInitialLocationConsumed={handleFilesInitialLocationConsumed}
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

/** 送信先が確定できなかったときの `POST /api/review/send` 409 レスポンスの表示文言。 */
const SEND_TARGET_ERROR_MESSAGE: Record<SendTargetError["type"], string> = {
  no_agent: "この worktree にエージェントがいません",
  ambiguous_target: "送信先を選んでください",
  invalid_target: "選んだセッションはこの worktree にいません",
};
