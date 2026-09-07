/**
 * Code-defined route tree. `/focus/$tab` follows herdr's current focus;
 * `/w/$root/$tab` pins to a fixed worktree root. `/decisions` and
 * `/decisions/$id` are sibling routes to the tool routes so the tool area's
 * own route (and everything URL-derived inside it — tab, comparison,
 * selected file) survives a visit to the decision UI and back.
 */
import { useCallback, useEffect, useState } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
  useMatch,
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

/** `/w/<root>/...` のときだけ root を返す。サイドバーのピン留め表示と、ask/decision
 * の「対象ファイルを開く」が既存の worktree を differentiate するのに使う。
 * TanStack はマッチ時点で pathname をすでに `decodeURI` 済みなので、params から
 * 読む（正規表現で pathname を切って自前で `decodeURIComponent` すると、root に
 * `%` を含むパスで二重デコードになり `URIError` になる）。 */
function usePinnedWorktreeRoot(): string | null {
  const match = useMatch({ from: wRoute.id, shouldThrow: false });
  return match?.params.root ?? null;
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
  const pinnedWorktreeRoot = usePinnedWorktreeRoot();

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

  // 質問セッション行「対象ファイルを開く」。常に /w/<root>/files へ遷移する —
  // 現在表示中の worktree と同じでも構わない、routing が冪等に同じ画面へ
  // 着地する。
  const handleOpenAskFile = useCallback(
    (location: AskFileLocation) => {
      void navigate({
        to: "/w/$root/$tab",
        params: { root: location.worktreeRoot, tab: "files" },
        search: { path: location.path, line: location.line },
      });
    },
    [navigate],
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
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        repos={state.repos}
        herdrConnected={state.herdr.connected}
        connection={state.connection}
        pinnedWorktreeRoot={pinnedWorktreeRoot}
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
        {/* `hidden` (not conditional rendering) keeps the tool route mounted while
            collapsed — unmounting it would tear down `/w/$root`'s pin effect and
            send `pin: null` just because the panel is hidden, not because the
            worktree was actually left. */}
        <div hidden={layout.toolCollapsed} className="h-full">
          <Outlet />
        </div>
      </aside>
    </div>
  );
}

/** `/w/<root>/...` に入っている間だけ、そのルートを herdr へピン留めする。
 * WS 未接続時の送信は黙って捨てられる（eventsSocket.ts）ので、接続が open に
 * なるたびに送り直す — 切断中にマウントされた場合や再接続後も pin が
 * 確実に herdr 側へ届くようにする。アンマウント（他ルートへ移動）時には
 * `null` を送って解除する。 */
function useSendPin(worktreeRoot: string) {
  const { send } = useHerdrStoreActions();
  const isConnected = useHerdrState().connection === "open";
  useEffect(() => {
    if (!isConnected) return;
    send({ type: "pin", worktreeRoot });
    return () => send({ type: "pin", worktreeRoot: null });
  }, [send, worktreeRoot, isConnected]);
}

function WToolPaneRoute() {
  const { root } = useParams({ from: wRoute.id });
  useSendPin(root);
  return <ToolPane />;
}

/** 判断依頼の一覧/詳細を閉じる。この画面に遷移する前の履歴に戻れるならそこへ
 * 戻し（ピン留め・タブ・比較範囲がそのまま残る）、無ければ（`/decisions/<id>`
 * を直接開いた場合など）既定のフォールバック先へ遷移する。 */
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
  const navigate = useNavigate();
  const onClose = useCloseDecision();
  const { send } = useHerdrStoreActions();
  const onOpenLocation: OpenLocation = useCallback(
    (location) => {
      void navigate({
        to: "/w/$root/$tab",
        params: { root: location.worktreeRoot, tab: "files" },
        search: { path: location.path, line: location.lines ? location.lines[0] : 1 },
      });
    },
    [navigate],
  );
  return (
    <DecisionView
      id={id}
      onClose={onClose}
      onFocusPane={(pane) => send({ type: "focus-pane", pane })}
      onOpenLocation={onOpenLocation}
    />
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

export const wRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$root/$tab",
  validateSearch: parseToolSearch,
  // Switching the `tab` param alone must not remount ToolPane's effects —
  // navigate() would immediately have its own new `path`/`line` search wiped
  // by the "worktree changed" effect. Only `root` changing should remount.
  remountDeps: ({ params }) => params.root,
  component: WToolPaneRoute,
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

const routeTree = rootRoute.addChildren([
  indexRoute,
  focusRoute,
  wRoute,
  decisionsRoute,
  decisionRoute,
]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history, defaultPreload: false });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
