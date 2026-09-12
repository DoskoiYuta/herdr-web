import { useRouterState } from "@tanstack/react-router";
import { getRouteApi } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DiffPanel, type DiffInitialLocation } from "@/components/diff/DiffPanel";
import { ComposePanel } from "@/components/docker/ComposePanel";
import { FilesPanel } from "@/components/files/FilesPanel";
import { GraphPanel } from "@/components/graph/GraphPanel";
import { NotesPanel } from "@/components/notes/NotesPanel";
import { ProcessPanel } from "@/components/process/ProcessPanel";
import { DecisionListView } from "@/components/decision/DecisionListView";
import { DecisionView } from "@/components/decision/DecisionView";
import type { OpenLocation } from "@/components/decision/BlockView";
import { useDecisionCounts } from "@/components/decision/hooks/useDecisionCounts";
import { useAskCounts } from "@/components/ask/hooks/useAskCounts";
import { useReviewCounts } from "@/components/review/hooks/useReviewCounts";
import { SendDraftsButton } from "@/components/review/SendDraftsButton";
import { EmptyWorktreeNotice } from "@/components/tool/EmptyWorktreeNotice";
import { TabBadge } from "@/components/tool/TabBadge";
import { WorktreeSelect } from "@/components/tool/WorktreeSelect";
import { Button } from "@/components/ui/button";
import { AgentStatusDot } from "@/components/ui/status/AgentStatusDot";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useHerdrState, useAskEvents, useReviewEvents } from "@/lib/HerdrStoreContext";
import { useHerdrStoreActions } from "@/lib/HerdrStoreContext";
import { useOpenWorktreeLocation } from "@/lib/openWorktreeLocation";
import { askEventMatchesRepo } from "@/lib/askEvent";
import { reviewEventMatchesRepo } from "@/lib/reviewEvent";
import { sendTargetsFor } from "@/lib/sendTargets";
import { normalizeTab, type ToolSearch, type ToolTab } from "@/router/search";

/** A sub-repo/submodule selection never gets its own `repoChangedTick` from
 * the server — the poller only watches the *focused* worktree (see
 * server/git/poller.ts) — so the diff/graph queries fall back to polling on
 * this interval while a non-root sub-repo is selected. */
const SUB_REPO_POLL_MS = 3000;

export type CommitRange = { from: string; to: string } | null;

const EMPTY_SEARCH: ToolSearch = {};

const routeApi = getRouteApi("/focus/$tab");

const TAB_LABEL: Record<ToolTab, string> = {
  files: "Files",
  graph: "Graph",
  diff: "Diff",
  notes: "Notes",
  decisions: "Decisions",
  process: "Process",
  compose: "Compose",
};

/** エージェント非依存の session 表示（ui-redesign.md D9）: `session <先頭4>…
 * <末尾4>` + コピーアイコン。コピーする文字列は session id そのもの
 * （コマンドは組み立てない）。 */
function SessionCopyButton({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false);
  const label = `session ${sessionId.slice(0, 4)}…${sessionId.slice(-4)}`;

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // クリップボード API が使えない環境では何もしない
    }
  }, [sessionId]);

  return (
    <Button type="button" size="xs" variant="outline" onClick={copy} className="gap-1">
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {label}
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
  const showSession = session?.kind === "id";

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-2 py-1 text-xs text-muted-foreground">
      {focusInfo.agent && (
        <span className="inline-flex items-center gap-1.5">
          {focusInfo.agentStatus && <AgentStatusDot status={focusInfo.agentStatus} />}
          {focusInfo.agent}
          {focusInfo.agentStatus ? ` · ${focusInfo.agentStatus}` : ""}
        </span>
      )}
      {showSession && <SessionCopyButton sessionId={session.value} />}
    </div>
  );
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

/** `/focus/$tab` の唯一の下で描画される — URL がタブ・比較範囲・選択サブ
 * リポジトリ・ジャンプ先・選択中の判断依頼の唯一の正になる（plan.md F2-4:
 * ピン留めは持たない）。このコンポーネント自身はローカル state を持たない
 * （送信ダイアログの開閉やエラー文言のような一時的な UI 状態を除く）。 */
export function ToolPane() {
  const params = routeApi.useParams();
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const state = useHerdrState();
  const { send } = useHerdrStoreActions();
  const { openLocation } = useOpenWorktreeLocation();

  const worktreeRoot = state.focus?.worktreeRoot ?? null;
  const repoKey = state.focus?.repoKey ?? null;
  const subRepo = state.focus?.subRepo ?? null;
  // §10.3: タブが実際に見る root/repoKey はサブリポジトリ選択中はそのサブ
  // リポジトリのもの。pane の送信先（agentPanesAt 系）や worktree セレクタは
  // 常にトップの worktreeRoot/repoKey を使う — pane はサブリポジトリとは
  // 無関係にトップの worktree で開かれる。Notes はリポジトリ単位の永続化
  // なので Select（サブリポジトリ選択）に追従せず、常にトップの repoKey
  // （`repoKey` そのもの、`hw notes list` と同じ）を使う。
  const effectiveRoot = subRepo?.root ?? worktreeRoot;
  const effectiveRepoKey = subRepo?.repoKey ?? repoKey;
  const tab: ToolTab = normalizeTab(params.tab);
  const repos = state.repos;
  const focusInfo = state.focus;
  const repoChangedTick = worktreeRoot ? (state.repoChanged[worktreeRoot]?.tick ?? 0) : 0;
  // Inbox の行クリックなどが同じ tick で別タブへの navigate を pending にした
  // まま、この後の自動 navigate（`root`/古い search を落とす）が `to` 無しで
  // 発行されると、まだコミットされていない旧タブを基準に組み立てられ、
  // pending 中の遷移ごと後勝ちで巻き戻す。router が idle（前の navigate が
  // commit 済み）になってから、現在の（解決済みの）タブを明示して発行する。
  const routerIdle = useRouterState({ select: (s) => s.status === "idle" });

  // 別 worktree のファイル位置を開く導線（ask の「対象ファイルを開く」、判断
  // 依頼の `location` Block）が付ける search の `root`: herdr の focus がまだ
  // その worktree に切り替わっていない間は、`path`/`line` を今表示中の
  // （無関係な）worktree に適用しない ゲート。focus が追いついたら消す。
  const intendedRoot = search.root ?? null;
  const rootPending = intendedRoot !== null && intendedRoot !== worktreeRoot;
  useEffect(() => {
    if (!routerIdle) return;
    if (intendedRoot !== null && intendedRoot === worktreeRoot) {
      void navigate({
        to: "/focus/$tab",
        params: (prev) => prev,
        search: (prev) => ({ ...prev, root: undefined }),
        replace: true,
      });
    }
  }, [intendedRoot, worktreeRoot, navigate, routerIdle]);

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
  const [trackedEffectiveRoot, setTrackedEffectiveRoot] = useState(effectiveRoot);
  const [searchCleared, setSearchCleared] = useState(false);
  if (trackedEffectiveRoot !== effectiveRoot) {
    // null（未解決）→ 実値は初回のフォーカス解決であって切り替えではない
    // （直接開き・リロードで herdr の focus がまだ届いていないだけ） — この
    // 遷移では search を落とさない。実値 A → 実値 B のときだけ切り替え扱いにする
    // （worktree の切り替えだけでなく、サブリポジトリ/サブ worktree の切り替え
    // も同じ扱い — ui-redesign.md §10.5）。
    const wasResolved = trackedEffectiveRoot !== null;
    setTrackedEffectiveRoot(effectiveRoot);
    if (wasResolved && intendedRoot !== worktreeRoot) {
      setSearchCleared(true);
    }
  } else if (searchCleared && Object.keys(search).length === 0) {
    setSearchCleared(false);
  }
  const effectiveSearch = searchCleared ? EMPTY_SEARCH : search;
  useEffect(() => {
    if (!routerIdle) return;
    if (searchCleared) {
      void navigate({
        to: "/focus/$tab",
        params: (prev) => prev,
        search: () => ({}),
        replace: true,
      });
    }
  }, [searchCleared, navigate, routerIdle]);

  // Files のファイルタブ列（fileTabs.ts）は repoKey 単位で FilesPanel 側が
  // 持ち、`selectedPath` が null のとき、その repoKey のタブ列の `active` を
  // 自分で URL へ書き戻す（FilesPanel.tsx 参照）。ここではその書き戻しを
  // 抑止すべきタイミングだけを教える: `rootPending`（別 worktree への意図した
  // ジャンプの path 適用待ち）と `searchCleared`（worktree 切り替えで search を
  // 空にする navigate がまだ commit していない）の間は、FilesPanel が自分の
  // 判断で path を書き戻すと、この直後/同時に発行される上の navigate と
  // 競合する（同一 tick の二重 navigate、または無関係な path の上書き）。
  const filesRestoreSuppressed = rootPending || searchCleared;

  const comparison: CommitRange =
    effectiveSearch.from && effectiveSearch.to
      ? { from: effectiveSearch.from, to: effectiveSearch.to }
      : null;
  const initialLocation: DiffInitialLocation | null =
    tab === "diff" && !rootPending && effectiveSearch.path
      ? {
          path: effectiveSearch.path,
          ...(effectiveSearch.line !== undefined
            ? { line: effectiveSearch.line, side: effectiveSearch.side ?? "new" }
            : {}),
        }
      : null;
  const filesSelectedPath = tab === "files" && !rootPending ? (effectiveSearch.path ?? null) : null;
  const filesMdMode = effectiveSearch.md ?? "preview";
  const filesInitialLocation =
    tab === "files" && !rootPending && effectiveSearch.path && effectiveSearch.line
      ? { path: effectiveSearch.path, line: effectiveSearch.line }
      : null;
  const decisionId = tab === "decisions" ? (effectiveSearch.id ?? null) : null;
  const notesSelectedId = tab === "notes" ? (effectiveSearch.id ?? null) : null;

  const handleTabChange = useCallback(
    (nextTab: string) => {
      void navigate({
        params: (prev) => ({ ...prev, tab: nextTab }),
        search: (prev) => ({
          ...prev,
          path: undefined,
          line: undefined,
          side: undefined,
          root: undefined,
          id: undefined,
        }),
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

  const openFileInDiff = useCallback(
    (range: { from?: string; to: string }, path: string) => {
      // `from` 無し（ルートコミットの file 行）は、サーバーが空木を commit
      // として受け付けないため意味のある比較を組めない — GraphRow 側で
      // クリック自体を止めているが、ここでも二重に弾く（M16 レビュー指摘:
      // 弾かないと Diff が黙って WORKTREE vs HEAD にすり替わる）。
      if (range.from === undefined) return;
      void navigate({
        params: (prev) => ({ ...prev, tab: "diff" }),
        search: (prev) => ({ ...prev, from: range.from, to: range.to, path, line: undefined }),
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

  const handleSelectDecision = useCallback(
    (id: string) => {
      void navigate({ search: (prev) => ({ ...prev, id }) });
    },
    [navigate],
  );

  const handleCloseDecision = useCallback(() => {
    void navigate({ search: (prev) => ({ ...prev, id: undefined }) });
  }, [navigate]);

  const handleSelectNote = useCallback(
    (id: string) => {
      void navigate({ search: (prev) => ({ ...prev, id }) });
    },
    [navigate],
  );

  const handleFocusDecisionPane = useCallback(
    (pane: string) => send({ type: "focus-pane", pane }),
    [send],
  );

  const handleOpenDecisionLocation: OpenLocation = useCallback(
    (location) =>
      openLocation({
        worktreeRoot: location.worktreeRoot,
        path: location.path,
        line: location.lines ? location.lines[0] : 1,
      }),
    [openLocation],
  );

  // §10.3: repoKey にも選択中のサブリポジトリを反映する（サーバーが
  // `focus.subRepo.repoKey` として解決済みの値を渡してくる — サブリポジトリの
  // git-common-dir をクライアント側で都度解決する必要はない）。
  const resolvedRepoKey = effectiveRepoKey;
  const resolvedRoot = effectiveRoot ?? "";
  // サブリポジトリ選択中は repoChangedTick が来ない（サーバの poller はフォーカス
  // 中の worktree しか見ていない — server/git/poller.ts）ため、diff/graph の
  // クエリをこの間隔でポーリングして代替する。
  const subRepoPollMs = subRepo !== null ? SUB_REPO_POLL_MS : undefined;
  const repoName = worktreeRoot
    ? (repos.find((r) => r.key === repoKey)?.name ?? basename(worktreeRoot))
    : null;

  // git-graph の review 件数バッジ + Diff タブの送信ボタン（F5-10）。review WS
  // イベントと repoChangedTick の両方で tick を上げ、`staleTime: Infinity` の
  // クエリを明示的に再フェッチする（useGraph/useReviewList と同じ流儀）。
  const [reviewTick, setReviewTick] = useState(0);
  const reviewCountsQuery = useReviewCounts(
    resolvedRepoKey && resolvedRoot ? { repo: resolvedRepoKey, worktree: resolvedRoot } : null,
    reviewTick + repoChangedTick,
  );
  const reviewCounts = reviewCountsQuery.data ?? null;
  const pendingDrafts = reviewCounts?.pendingDrafts ?? 0;

  useReviewEvents(
    useCallback(
      (event) => {
        if (reviewEventMatchesRepo(event, resolvedRepoKey)) setReviewTick((t) => t + 1);
      },
      [resolvedRepoKey],
    ),
  );

  // Files タブの通知バッジ（ui-redesign.md §5.4: replied な質問の件数）。
  // FilesPanel が ask 作成/for-file に使う組（`repoKey` + `resolvedRoot` —
  // FilesPanel の `worktreeRoot: repo` prop）と揃える。worktreeRoot をそのまま
  // 渡すとサブリポジトリ選択中はサーバー側の完全一致で絞られ、常に 0 になる。
  const [askTick, setAskTick] = useState(0);
  const askCountsQuery = useAskCounts(
    resolvedRepoKey && resolvedRoot ? { repo: resolvedRepoKey, worktree: resolvedRoot } : null,
    askTick + repoChangedTick,
  );
  const askReplied = askCountsQuery.data?.replied ?? 0;

  useAskEvents(
    useCallback(
      (event) => {
        if (askEventMatchesRepo(event, resolvedRepoKey)) setAskTick((t) => t + 1);
      },
      [resolvedRepoKey],
    ),
  );

  // Decisions タブの通知バッジ（フォーカス中の worktree の open 件数、
  // ui-redesign.md §5.4）。
  const decisionCountsQuery = useDecisionCounts(worktreeRoot);
  const decisionTotal = decisionCountsQuery.data?.total ?? 0;

  // 送信先候補は実効 root/repoKey（サブリポジトリ選択中はそのもの）に紐付く
  // — サーバーの通知宛先探索（herdr-notifier.ts）と同じスコープにするため、
  // SendDraftsButton 自身に渡す worktreeRoot/repoKey（= resolvedRoot/
  // resolvedRepoKey）と揃える。§10.6: 実効 root に 0 件なら同じリポジトリの
  // 他 worktree にフォールバックする。
  const agentPanes = useMemo(
    () =>
      resolvedRepoKey && resolvedRoot ? sendTargetsFor(repos, resolvedRoot, resolvedRepoKey) : [],
    [repos, resolvedRoot, resolvedRepoKey],
  );

  const handleDraftsSent = useCallback(() => setReviewTick((t) => t + 1), []);

  return (
    <div className="flex h-full w-full flex-col">
      <header
        data-testid="tool-header"
        style={{ borderLeft: `3px solid ${worktreeRoot ? "var(--focus)" : "transparent"}` }}
        className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5"
      >
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          {worktreeRoot ? (
            <>
              <span className="shrink-0 text-sm font-semibold">{repoName}</span>
              {focusInfo?.workspace && repoKey && (
                <WorktreeSelect
                  workspaceId={focusInfo.workspace}
                  repoKey={repoKey}
                  worktreeRoot={worktreeRoot}
                  subRepo={subRepo}
                  repoChangedTick={repoChangedTick}
                />
              )}
              <span
                className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
                title={resolvedRoot}
              >
                {resolvedRoot}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">herdr 未接続 / worktree 未選択</span>
          )}
        </div>
      </header>

      {focusInfo && <FocusInfoBar focusInfo={focusInfo} />}

      <Tabs value={tab} onValueChange={handleTabChange} className="min-h-0 flex-1">
        <TabsList className="mx-2 mt-2 w-fit">
          <TabsTrigger value="files">
            {TAB_LABEL.files}
            <TabBadge count={askReplied} />
          </TabsTrigger>
          <TabsTrigger value="graph">
            {TAB_LABEL.graph}
            <TabBadge count={reviewCounts?.replied.commit ?? 0} />
          </TabsTrigger>
          <TabsTrigger value="diff">
            {TAB_LABEL.diff}
            <TabBadge count={reviewCounts?.replied.worktree ?? 0} />
          </TabsTrigger>
          <TabsTrigger value="notes">{TAB_LABEL.notes}</TabsTrigger>
          <TabsTrigger value="decisions">
            {TAB_LABEL.decisions}
            <TabBadge count={decisionTotal} />
          </TabsTrigger>
          <TabsTrigger value="process">{TAB_LABEL.process}</TabsTrigger>
          <TabsTrigger value="compose">{TAB_LABEL.compose}</TabsTrigger>
        </TabsList>

        <TabsContent value="files" className="min-h-0 flex-1 overflow-hidden">
          {worktreeRoot ? (
            <FilesPanel
              key={resolvedRoot}
              repo={resolvedRoot}
              repoChangedTick={repoChangedTick}
              pollMs={subRepoPollMs}
              repoKey={resolvedRepoKey}
              repos={repos}
              selectedPath={filesSelectedPath}
              onSelectedPathChange={handleFilesSelectedPathChange}
              restoreSuppressed={filesRestoreSuppressed}
              mdMode={filesMdMode}
              onMdModeChange={handleFilesMdModeChange}
              initialLocation={filesInitialLocation}
              onInitialLocationConsumed={handleFilesInitialLocationConsumed}
            />
          ) : (
            <EmptyWorktreeNotice />
          )}
        </TabsContent>

        <TabsContent value="graph" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {worktreeRoot ? (
            <>
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
                  repo={resolvedRoot}
                  repoChangedTick={repoChangedTick}
                  pollMs={subRepoPollMs}
                  onSelectCommit={handleSelectCommit}
                  onOpenDiff={openDiffFor}
                  onOpenFile={openFileInDiff}
                  reviewCounts={reviewCounts}
                />
              </div>
            </>
          ) : (
            <EmptyWorktreeNotice />
          )}
        </TabsContent>

        <TabsContent value="diff" className="min-h-0 flex-1 overflow-hidden">
          {worktreeRoot ? (
            <>
              <DiffPanel
                key={`${resolvedRoot}|${comparison?.from ?? ""}|${comparison?.to ?? ""}`}
                repo={resolvedRoot}
                repoKey={resolvedRepoKey}
                from={comparison?.from}
                to={comparison?.to}
                repoChangedTick={repoChangedTick}
                pollMs={subRepoPollMs}
                initialLocation={initialLocation}
                onInitialLocationConsumed={handleInitialLocationConsumed}
                onOpenGraph={() => handleTabChange("graph")}
                compareRangeActive={!!comparison}
                onResetToWorktree={resetToWorktree}
                sendButton={
                  <SendDraftsButton
                    repoKey={resolvedRepoKey}
                    worktreeRoot={resolvedRoot}
                    pendingDrafts={pendingDrafts}
                    agentPanes={agentPanes}
                    onSent={handleDraftsSent}
                  />
                }
              />
            </>
          ) : (
            <EmptyWorktreeNotice />
          )}
        </TabsContent>

        <TabsContent value="notes" className="min-h-0 flex-1 overflow-hidden">
          <NotesPanel
            key={repoKey ?? "none"}
            repoKey={repoKey}
            selectedId={notesSelectedId}
            onSelectId={handleSelectNote}
          />
        </TabsContent>

        <TabsContent value="decisions" className="min-h-0 flex-1 overflow-hidden">
          {decisionId ? (
            <DecisionView
              id={decisionId}
              onClose={handleCloseDecision}
              onFocusPane={handleFocusDecisionPane}
              onOpenLocation={handleOpenDecisionLocation}
            />
          ) : worktreeRoot ? (
            <DecisionListView worktreeRoot={worktreeRoot} onSelect={handleSelectDecision} />
          ) : (
            <EmptyWorktreeNotice />
          )}
        </TabsContent>

        <TabsContent value="process" className="min-h-0 flex-1 overflow-hidden">
          {worktreeRoot ? (
            <ProcessPanel key={resolvedRoot} root={resolvedRoot} />
          ) : (
            <EmptyWorktreeNotice />
          )}
        </TabsContent>

        <TabsContent value="compose" className="min-h-0 flex-1 overflow-hidden">
          {worktreeRoot ? (
            <ComposePanel key={resolvedRoot} root={resolvedRoot} />
          ) : (
            <EmptyWorktreeNotice />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
