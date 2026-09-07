/**
 * Code-defined route tree. `/focus/$tab` follows herdr's current focus —
 * the only tool route (plan.md F2-4: no pinning). `/decisions` and
 * `/decisions/$id` (the URL `hw decision request` hands back, plan.md
 * F13-8/decision.md §7 Q5) redirect into the `decisions` tab so the tool
 * area's own route (and everything URL-derived inside it — tab, comparison,
 * selected file) survives a visit to the decision UI and back.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useSearch,
  type RouterHistory,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Maximize2, Minimize2, PanelRightClose, PanelRightOpen, TerminalIcon } from "lucide-react";
import { InboxDialog } from "@/components/inbox/InboxDialog";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { STATUS_META } from "@/components/ui/status/AgentStatusDot";
import { ResizeHandle } from "@/components/terminal/ResizeHandle";
import { Terminal } from "@/components/terminal/Terminal";
import { configApi } from "@/lib/api";
import { ToolPane } from "@/components/tool/ToolPane";
import { useHerdrState, useHerdrStoreActions } from "@/lib/HerdrStoreContext";
import { useOpenWorktreeLocation } from "@/lib/openWorktreeLocation";
import type { AskFileLocation } from "@/components/sidebar/AskSessionRow";
import { isInboxToggleKey, isMaximizeToggleKey } from "@/lib/termKeys";
import { cn } from "@/lib/utils";
import {
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
  readLayout,
  TOOL_MAX_WIDTH,
  TOOL_MIN_WIDTH,
  writeLayout,
  type Layout,
  type Maximized,
} from "@/lib/layout";
import { parseToolSearch } from "@/router/search";

function loadInitialLayout() {
  try {
    return readLayout(localStorage.getItem(LAYOUT_STORAGE_KEY));
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "SELECT" ||
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    (el as HTMLElement).isContentEditable
  );
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
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
  // D7: 「最後に最大化した側」— キーボードトグルが null から戻す先。ページ内
  // での操作の記憶だけでよく、永続化は不要（既定は tool 側）。
  const lastMaximizedRef = useRef<Exclude<Maximized, null>>("tool");

  const state = useHerdrState();
  const { send } = useHerdrStoreActions();
  const navigate = useNavigate();
  const { openLocation } = useOpenWorktreeLocation();
  // Inbox の開閉は search `inbox`（`/focus/$tab` の一部）が正 — リロードで復元、
  // 戻るで閉じる（ui-redesign.md §5.4）。
  const inboxSearch = useSearch({ strict: false, select: (s) => s.inbox });
  const inboxOpen = inboxSearch === 1;
  const setInboxOpen = useCallback(
    (nextOpen: boolean) => {
      // `to`/`params` を指定しない — 現在のルートに留まる。タブをクロージャで
      // 捕まえて明示指定すると、Inbox の行クリックで先に別タブへ navigate
      // した直後にこれが呼ばれたとき、古いタブへ後勝ちで戻ってしまう。
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, inbox: nextOpen ? 1 : undefined }),
      });
    },
    [navigate],
  );
  const toggleInbox = useCallback(() => setInboxOpen(!inboxOpen), [inboxOpen, setInboxOpen]);
  const toggleInboxRef = useRef(toggleInbox);
  useEffect(() => {
    toggleInboxRef.current = toggleInbox;
  }, [toggleInbox]);

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

  const setMaximized = useCallback(
    (next: Maximized) => {
      if (next) lastMaximizedRef.current = next;
      persist({ ...layout, maximized: next });
    },
    [layout, persist],
  );

  const toggleMaximized = useCallback(
    (side: Exclude<Maximized, null>) => {
      setMaximized(layout.maximized === side ? null : side);
    },
    [layout.maximized, setMaximized],
  );

  const toggleLastMaximized = useCallback(() => {
    setMaximized(layout.maximized !== null ? null : lastMaximizedRef.current);
  }, [layout.maximized, setMaximized]);

  // グローバルの keydown リスナーは 1 回だけ登録する（Terminal.tsx の
  // `onToggleMaximizeRef` と同じやり方）— `toggleLastMaximized` は `layout`
  // が変わるたびに新しい関数になるので、依存配列に積むとリスナーが
  // 張り直され続ける。
  const toggleLastMaximizedRef = useRef(toggleLastMaximized);
  useEffect(() => {
    toggleLastMaximizedRef.current = toggleLastMaximized;
  }, [toggleLastMaximized]);

  useEffect(() => {
    function onKeydown(event: KeyboardEvent) {
      if (isTypingTarget(document.activeElement)) return;
      if (isMaximizeToggleKey(event)) {
        event.preventDefault();
        toggleLastMaximizedRef.current();
        return;
      }
      if (isInboxToggleKey(event)) {
        event.preventDefault();
        toggleInboxRef.current();
      }
    }
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }, []);

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

  // Workspace 行の右クリック「Diff を開く」(ui-redesign.md §5.2): まず
  // フォーカスを移し、通常のタブ切替と同じくタブ専用の search（sub/from/to）
  // だけ落として `/focus/diff` へ遷移する。
  const handleOpenDiff = useCallback(
    (pane: string) => {
      handleSelectPane(pane);
      void navigate({
        to: "/focus/$tab",
        params: { tab: "diff" },
        search: (prev) => ({ ...prev, sub: undefined, from: undefined, to: undefined }),
      });
    },
    [handleSelectPane, navigate],
  );

  const handleOpenInbox = useCallback(() => setInboxOpen(true), [setInboxOpen]);

  const sidebarLayout = layout.sidebar ?? DEFAULT_LAYOUT.sidebar!;
  const handleSidebarLayoutChange = useCallback(
    (next: { width: number; collapsed: boolean }) => {
      persist({ ...layout, sidebar: next });
    },
    [layout, persist],
  );

  const toolMaximized = layout.maximized === "tool";
  // aside の幅: tool 最大化中は flex-1（style で幅を指定しない）、terminal
  // 最大化中は 0（toolCollapsed と同じ扱いだが独立した状態）、それ以外は
  // 既存どおり。`maximized` が toolCollapsed より優先する。
  const asideWidth =
    layout.maximized === "tool" ? undefined : layout.maximized === "terminal" ? 0 : liveToolWidth;
  const asideContentHidden =
    layout.maximized === "terminal" || (layout.maximized === null && layout.toolCollapsed);

  const focusAgentStatus = state.focus?.agentStatus ?? null;
  const terminalHeaderLabel = state.focus
    ? `${state.focus.worktreeRoot ? basename(state.focus.worktreeRoot) : "?"} · ${
        state.focus.agent ?? "no agent"
      }`
    : "未接続";

  return (
    <div className="relative flex h-screen w-screen overflow-hidden">
      <Sidebar
        repos={state.repos}
        herdrConnected={state.herdr.connected}
        connection={state.connection}
        protocol={state.herdr.protocol}
        focusedWorkspaceId={state.focus?.workspace ?? null}
        focusedPaneId={state.focus?.pane ?? null}
        focusedAgentSessionId={state.focus?.agentSession?.value ?? null}
        onSelectPane={handleSelectPane}
        layout={sidebarLayout}
        onLayoutChange={handleSidebarLayoutChange}
        onOpenAskFile={handleOpenAskFile}
        onOpenDiff={handleOpenDiff}
        onOpenInbox={handleOpenInbox}
      />

      <main
        className={cn("flex min-h-0 flex-col", toolMaximized ? "w-9 shrink-0" : "min-w-0 flex-1")}
      >
        {toolMaximized && (
          <div className="flex h-full flex-col items-center gap-2 py-2">
            <button
              type="button"
              onClick={() => toggleMaximized("tool")}
              aria-label="ターミナルに戻す"
              className="rounded-md p-1 hover:bg-muted"
            >
              <Minimize2 className="size-4" />
            </button>
            {focusAgentStatus &&
              (() => {
                const StatusIcon = STATUS_META[focusAgentStatus].icon;
                return (
                  <StatusIcon
                    className={cn(
                      "size-3.5",
                      STATUS_META[focusAgentStatus].className,
                      STATUS_META[focusAgentStatus].spin && "animate-spin",
                    )}
                  />
                );
              })()}
            <TerminalIcon className="size-4 text-muted-foreground" />
          </div>
        )}
        {/* `hidden`（display:none）で隠すだけで Terminal はアンマウントしない —
         * PTY 接続を切らないため（D7）。復帰時、コンテナのボックスサイズが
         * 変わる（0 → 実寸）ことで xterm の ResizeObserver が発火し、fit() が
         * 再計算される。 */}
        <div hidden={toolMaximized} className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border px-2 text-xs text-muted-foreground">
            <TerminalIcon className="size-3.5 shrink-0" />
            <span className="truncate">herdr · {terminalHeaderLabel}</span>
            <span className="flex-1" />
            {layout.maximized === "terminal" ? (
              <button
                type="button"
                onClick={() => toggleMaximized("terminal")}
                aria-label="元に戻す"
                className="rounded-md p-1 hover:bg-muted"
              >
                <Minimize2 className="size-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => toggleMaximized("terminal")}
                aria-label="ターミナルを最大化"
                className="rounded-md p-1 hover:bg-muted"
              >
                <Maximize2 className="size-3.5" />
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1">
            <Terminal
              className="h-full w-full"
              fontFamily={clientConfig?.terminal.fontFamily}
              fontSize={clientConfig?.terminal.fontSize}
              lineHeight={clientConfig?.terminal.lineHeight}
              onToggleMaximize={toggleLastMaximized}
              onToggleInbox={toggleInbox}
            />
          </div>
        </div>
      </main>

      {!layout.toolCollapsed && layout.maximized === null && (
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
        className={cn(
          "relative flex shrink-0 flex-col border-l border-border text-sm text-muted-foreground",
          toolMaximized && "flex-1",
        )}
        style={{ width: asideWidth }}
      >
        <div className="flex h-7 shrink-0 items-center justify-end gap-1 border-b border-border px-1">
          {toolMaximized ? (
            <button
              type="button"
              onClick={() => toggleMaximized("tool")}
              aria-label="元に戻す"
              className="rounded-md p-1 hover:bg-muted"
            >
              <Minimize2 className="size-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => toggleMaximized("tool")}
              aria-label="ツール領域を最大化"
              className="rounded-md p-1 hover:bg-muted"
            >
              <Maximize2 className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={layout.toolCollapsed ? "ツール領域を開く" : "ツール領域を折りたたむ"}
            className="rounded-md p-1 hover:bg-muted"
          >
            {layout.toolCollapsed ? (
              <PanelRightOpen className="size-3.5" />
            ) : (
              <PanelRightClose className="size-3.5" />
            )}
          </button>
        </div>
        <div hidden={asideContentHidden} className="min-h-0 flex-1">
          <Outlet />
        </div>
      </aside>

      <InboxDialog open={inboxOpen} onOpenChange={setInboxOpen} />
    </div>
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

/** `hw decision request` が返す URL（plan.md §9.w、ui-redesign.md §7 Q5）はこの
 * まま変えない — decisions タブへリダイレクトするだけ。 */
export const decisionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/decisions",
  beforeLoad: () => {
    throw redirect({ to: "/focus/$tab", params: { tab: "decisions" } });
  },
});

export const decisionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/decisions/$id",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/focus/$tab", params: { tab: "decisions" }, search: { id: params.id } });
  },
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
