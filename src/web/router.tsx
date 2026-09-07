/**
 * Code-defined route tree. `/focus/$tab` follows herdr's current focus —
 * the only tool route (plan.md F2-4: no pinning). `/decisions` and
 * `/decisions/$id` are sibling routes to it so the tool area's own route
 * (and everything URL-derived inside it — tab, comparison, selected file)
 * survives a visit to the decision UI and back.
 */
import { useCallback, useEffect, useState } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useParams,
  useRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { ResizeHandle } from "@/components/terminal/ResizeHandle";
import { Terminal } from "@/components/terminal/Terminal";
import { configApi } from "@/lib/api";
import { ToolPane } from "@/components/tool/ToolPane";
import { useHerdrState, useHerdrStoreActions } from "@/lib/HerdrStoreContext";
import type { AskFileLocation } from "@/components/sidebar/AskSessionGroup";
import { DecisionListView } from "@/components/decision/DecisionListView";
import { DecisionView } from "@/components/decision/DecisionView";
import type { OpenLocation } from "@/components/decision/BlockView";
import { firstPaneAt } from "@/lib/sendTargets";
import {
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
  readLayout,
  TOOL_MAX_WIDTH,
  TOOL_MIN_WIDTH,
  writeLayout,
  type Layout,
} from "@/lib/layout";
import { parseToolSearch } from "@/router/search";

function loadInitialLayout() {
  try {
    return readLayout(localStorage.getItem(LAYOUT_STORAGE_KEY));
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/** ブラウザの戻る/進むで復元される「判断依頼を閉じたら戻る先」の既定値。
 * 直前の worktree ルートを覚えておく手間をかけるほどの価値がないので固定にする。 */
const CLOSE_DECISION_FALLBACK = { to: "/focus/$tab", params: { tab: "diff" } } as const;

/**
 * 別 worktree のファイル位置を開く（ask の「対象ファイルを開く」、判断依頼の
 * `location` Block 共通）。対象が現在の focus worktree と同じなら
 * `/focus/files` へ直接 navigate する。違えば、その worktree に属する pane
 * (`sendTargets.firstPaneAt`) へ herdr のフォーカスを移してから navigate する
 * ——フォーカス切り替えは WS 経由で非同期に届くため、navigate 時点ではまだ
 * 古い worktree が表示中のことがある。ToolPane はここで付ける search の
 * `root` を見て、その worktree に実際に切り替わるまで `path`/`line` を
 * 適用しない（plan.md F14-4）。対象 worktree に pane が無ければ、navigate
 * せずに一時メッセージを返す。
 */
function useOpenWorktreeLocation() {
  const state = useHerdrState();
  const { send } = useHerdrStoreActions();
  const navigate = useNavigate();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  const openLocation = useCallback(
    (location: { worktreeRoot: string; path: string; line: number }) => {
      setMessage(null);
      if (state.focus?.worktreeRoot === location.worktreeRoot) {
        void navigate({
          to: "/focus/$tab",
          params: { tab: "files" },
          search: { path: location.path, line: location.line },
        });
        return;
      }
      const pane = firstPaneAt(state.repos, location.worktreeRoot);
      if (!pane) {
        setMessage("この worktree の pane が herdr にありません");
        return;
      }
      send({ type: "focus-pane", pane });
      void navigate({
        to: "/focus/$tab",
        params: { tab: "files" },
        search: { path: location.path, line: location.line, root: location.worktreeRoot },
      });
    },
    [state.focus, state.repos, send, navigate],
  );

  return { openLocation, message };
}

function RootLayout() {
  const { data: clientConfig } = useQuery({
    queryKey: ["client-config"],
    queryFn: configApi.get,
    staleTime: Infinity,
  });
  const [layout, setLayout] = useState(loadInitialLayout);
  // ドラッグ中のライブ幅。ドラッグ確定（onResizeEnd）で layout.toolWidth と
  // 一致するため、外部からの再同期用エフェクトは不要（初期値のみ layout から取る）。
  const [liveToolWidth, setLiveToolWidth] = useState(layout.toolWidth);

  const state = useHerdrState();
  const { send } = useHerdrStoreActions();
  const navigate = useNavigate();
  const { openLocation, message: openLocationMessage } = useOpenWorktreeLocation();

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

  const handleSelectPane = useCallback(
    (pane: string) => {
      send({ type: "focus-pane", pane });
    },
    [send],
  );

  // 質問セッション行「対象ファイルを開く」。
  const handleOpenAskFile = useCallback(
    (location: AskFileLocation) => openLocation(location),
    [openLocation],
  );

  const handleSelectDecisions = useCallback(() => {
    void navigate({ to: "/decisions" });
  }, [navigate]);

  const sidebarLayout = layout.sidebar ?? DEFAULT_LAYOUT.sidebar!;
  const handleSidebarLayoutChange = useCallback(
    (next: { width: number; collapsed: boolean }) => {
      persist({ ...layout, sidebar: next });
    },
    [layout, persist],
  );

  return (
    <div className="relative flex h-screen w-screen overflow-hidden">
      {openLocationMessage && (
        <div className="absolute inset-x-0 top-0 z-10 mx-auto w-fit rounded-b-md bg-destructive px-3 py-1 text-xs text-destructive-foreground">
          {openLocationMessage}
        </div>
      )}
      <Sidebar
        repos={state.repos}
        herdrConnected={state.herdr.connected}
        connection={state.connection}
        focusedWorkspaceId={state.focus?.workspace ?? null}
        onSelectPane={handleSelectPane}
        layout={sidebarLayout}
        onLayoutChange={handleSidebarLayoutChange}
        onOpenAskFile={handleOpenAskFile}
        onSelectDecisions={handleSelectDecisions}
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
        <div hidden={layout.toolCollapsed} className="h-full">
          <Outlet />
        </div>
      </aside>
    </div>
  );
}

/** 判断依頼の一覧/詳細を閉じる。この画面に遷移する前の履歴に戻れるならそこへ
 * 戻し（タブ・比較範囲がそのまま残る）、無ければ（`/decisions/<id>` を直接
 * 開いた場合など）既定のフォールバック先へ遷移する。 */
function useCloseDecision(): () => void {
  const navigate = useNavigate();
  const router = useRouter();
  return useCallback(() => {
    if (router.history.canGoBack()) {
      router.history.back();
    } else {
      void navigate(CLOSE_DECISION_FALLBACK);
    }
  }, [navigate, router]);
}

function DecisionsListRoute() {
  const navigate = useNavigate();
  const onClose = useCloseDecision();
  return (
    <DecisionListView
      onSelect={(id) => void navigate({ to: "/decisions/$id", params: { id } })}
      onClose={onClose}
    />
  );
}

function DecisionRoute() {
  const { id } = useParams({ from: decisionRoute.id });
  const onClose = useCloseDecision();
  const { send } = useHerdrStoreActions();
  const { openLocation, message: openLocationMessage } = useOpenWorktreeLocation();
  const onOpenLocation: OpenLocation = useCallback(
    (location) =>
      openLocation({
        worktreeRoot: location.worktreeRoot,
        path: location.path,
        line: location.lines ? location.lines[0] : 1,
      }),
    [openLocation],
  );
  return (
    <>
      {openLocationMessage && (
        <p className="border-b border-border px-2 py-1 text-xs text-destructive">
          {openLocationMessage}
        </p>
      )}
      <DecisionView
        id={id}
        onClose={onClose}
        onFocusPane={(pane) => send({ type: "focus-pane", pane })}
        onOpenLocation={onOpenLocation}
      />
    </>
  );
}

function NotFoundView() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
      <p>ページが見つかりません</p>
      <Link to="/focus/$tab" params={{ tab: "diff" }} className="underline">
        Diff に戻る
      </Link>
    </div>
  );
}

export const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundView,
});

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/focus/$tab", params: { tab: "diff" } });
  },
});

export const focusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/focus/$tab",
  validateSearch: parseToolSearch,
  component: ToolPane,
});

export const decisionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/decisions",
  component: DecisionsListRoute,
});

export const decisionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/decisions/$id",
  component: DecisionRoute,
});

const routeTree = rootRoute.addChildren([indexRoute, focusRoute, decisionsRoute, decisionRoute]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history, defaultPreload: false });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
