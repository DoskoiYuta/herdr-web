import { useCallback, useEffect, useMemo, useState } from "react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { ResizeHandle } from "@/components/terminal/ResizeHandle";
import { useQuery } from "@tanstack/react-query";
import { Terminal } from "@/components/terminal/Terminal";
import { configApi } from "@/lib/api";
import { ToolPane } from "@/components/tool/ToolPane";
import { createHerdrStore, useHerdrStore } from "@/lib/herdrStore";
import type { AskFileLocation } from "@/components/sidebar/AskSessionGroup";
import type { FilesInitialLocation } from "@/components/files/FilesPanel";
import {
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
  readLayout,
  TOOL_MAX_WIDTH,
  TOOL_MIN_WIDTH,
  writeLayout,
  type Layout,
} from "@/lib/layout";

function loadInitialLayout() {
  try {
    return readLayout(localStorage.getItem(LAYOUT_STORAGE_KEY));
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function App() {
  const { data: clientConfig } = useQuery({
    queryKey: ["client-config"],
    queryFn: configApi.get,
    staleTime: Infinity,
  });
  const [layout, setLayout] = useState(loadInitialLayout);
  // ドラッグ中のライブ幅。ドラッグ確定（onResizeEnd）で layout.toolWidth と
  // 一致するため、外部からの再同期用エフェクトは不要（初期値のみ layout から取る）。
  const [liveToolWidth, setLiveToolWidth] = useState(layout.toolWidth);

  // レイジー初期化（useState(() => ...)）を使う: `useRef(createHerdrStore())` は
  // 引数を毎レンダーで評価してしまい、破棄される store ごとに /ws/events への
  // 接続が張られてしまう。
  const [store] = useState(() => createHerdrStore({ autoOpen: false }));
  useEffect(() => {
    store.open();
    return () => store.close();
  }, [store]);
  const state = useHerdrStore(store);

  // ピン留めのローカルフラグ（ボタンの見た目用）。実際に表示する worktree は
  // サーバーが送り返す focus.worktreeRoot に従う（plan.md F2-4 / §6.4-6）。
  const [pinned, setPinned] = useState(false);
  // herdr 未接続時に手動で開いた worktree（focus が無いときのフォールバック表示）。
  const [manualWorktreeRoot, setManualWorktreeRoot] = useState<string | null>(null);

  const worktreeRoot = state.focus?.worktreeRoot ?? manualWorktreeRoot;

  const focusInfo = state.focus
    ? {
        agent: state.focus.agent,
        agentStatus: state.focus.agentStatus,
        agentSession: state.focus.agentSession,
      }
    : null;

  const repoKey = state.focus?.repoKey ?? null;

  const repoChangedTick = useMemo(() => {
    if (!worktreeRoot) return 0;
    return state.repoChanged[worktreeRoot]?.tick ?? 0;
  }, [worktreeRoot, state.repoChanged]);

  const persist = useCallback((next: Layout) => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, writeLayout(next));
    } catch {
      // localStorage が使えない環境（プライベートモード等）では永続化を諦める
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    persist({ ...layout, toolCollapsed: !layout.toolCollapsed });
  }, [layout, persist]);

  const handlePinToggle = useCallback(() => {
    const next = !pinned;
    setPinned(next);
    // Unpinning drops the manual open-path fallback too: it exists only to
    // give a worktree to pin while herdr isn't connected/focused, and
    // leaving it set after unpin would keep `worktreeRoot` pointing at it
    // while `repoKey` (which only ever comes from `state.focus`) reverts to
    // null — a worktree shown with no resolvable repo key.
    if (!next) setManualWorktreeRoot(null);
    store.send({ type: "pin", worktreeRoot: next ? worktreeRoot : null });
  }, [pinned, worktreeRoot, store]);

  const handleOpenPath = useCallback(
    (root: string) => {
      setManualWorktreeRoot(root);
      setPinned(true);
      store.send({ type: "pin", worktreeRoot: root });
    },
    [store],
  );

  const handleSelectPane = useCallback(
    (pane: string) => {
      store.send({ type: "focus-pane", pane });
    },
    [store],
  );

  // F10: 質問セッション行「対象ファイルを開く」。ask の worktree がツールペインの
  // 現在の worktree と違えば、手動パスフォームと同じ `handleOpenPath` 経路
  // （pin して worktree を切り替える）でその worktree をまず表示させる。
  const [filesInitialLocation, setFilesInitialLocation] = useState<FilesInitialLocation | null>(
    null,
  );
  const handleOpenAskFile = useCallback(
    (location: AskFileLocation) => {
      if (location.worktreeRoot !== worktreeRoot) {
        handleOpenPath(location.worktreeRoot);
      }
      setFilesInitialLocation({ path: location.path, line: location.line });
    },
    [worktreeRoot, handleOpenPath],
  );
  const handleFilesInitialLocationConsumed = useCallback(() => {
    setFilesInitialLocation(null);
  }, []);

  const sidebarLayout = layout.sidebar ?? DEFAULT_LAYOUT.sidebar!;
  const handleSidebarLayoutChange = useCallback(
    (next: { width: number; collapsed: boolean }) => {
      persist({ ...layout, sidebar: next });
    },
    [layout, persist],
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        repos={state.repos}
        herdrConnected={state.herdr.connected}
        connection={state.connection}
        pinnedWorktreeRoot={pinned ? worktreeRoot : null}
        focusedWorkspaceId={state.focus?.workspace ?? null}
        onSelectPane={handleSelectPane}
        layout={sidebarLayout}
        onLayoutChange={handleSidebarLayoutChange}
        onOpenAskFile={handleOpenAskFile}
        subscribeAskEvents={store.subscribeAskEvents}
      />

      <main className="min-w-0 flex-1">
        <Terminal
          className="h-full w-full"
          fontFamily={clientConfig?.terminal.fontFamily}
          fontSize={clientConfig?.terminal.fontSize}
          lineHeight={clientConfig?.terminal.lineHeight}
        />
      </main>

      {!layout.toolCollapsed && (
        <ResizeHandle
          width={liveToolWidth}
          min={TOOL_MIN_WIDTH}
          max={TOOL_MAX_WIDTH}
          defaultWidth={DEFAULT_LAYOUT.toolWidth}
          direction="left"
          onResize={setLiveToolWidth}
          onResizeEnd={(toolWidth) => persist({ ...layout, toolWidth })}
        />
      )}

      <aside
        className="relative shrink-0 border-l border-border text-sm text-muted-foreground"
        style={{ width: layout.toolCollapsed ? 0 : liveToolWidth }}
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          className="absolute -left-6 top-2 rounded-md border border-border bg-background px-1 py-0.5 text-xs"
          aria-label={layout.toolCollapsed ? "ツール領域を開く" : "ツール領域を折りたたむ"}
        >
          {layout.toolCollapsed ? "«" : "»"}
        </button>
        {!layout.toolCollapsed && (
          <ToolPane
            worktreeRoot={worktreeRoot}
            repoKey={worktreeRoot ? repoKey : null}
            repos={state.repos}
            pinned={pinned}
            onPinToggle={handlePinToggle}
            repoChangedTick={repoChangedTick}
            onOpenPath={handleOpenPath}
            focusInfo={worktreeRoot ? focusInfo : null}
            subscribeReviewEvents={store.subscribeReviewEvents}
            subscribeAskEvents={store.subscribeAskEvents}
            filesInitialLocation={filesInitialLocation}
            onFilesInitialLocationConsumed={handleFilesInitialLocationConsumed}
          />
        )}
      </aside>
    </div>
  );
}
