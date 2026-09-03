import { useCallback, useState } from "react";
import { ResizeHandle } from "@/components/terminal/ResizeHandle";
import { Terminal } from "@/components/terminal/Terminal";
import { ToolPane } from "@/components/tool/ToolPane";
import {
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
  readLayout,
  TOOL_MAX_WIDTH,
  TOOL_MIN_WIDTH,
  writeLayout,
} from "@/lib/layout";

function loadInitialLayout() {
  try {
    return readLayout(localStorage.getItem(LAYOUT_STORAGE_KEY));
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function App() {
  const [layout, setLayout] = useState(loadInitialLayout);
  // ドラッグ中のライブ幅。ドラッグ確定（onResizeEnd）で layout.toolWidth と
  // 一致するため、外部からの再同期用エフェクトは不要（初期値のみ layout から取る）。
  const [liveToolWidth, setLiveToolWidth] = useState(layout.toolWidth);

  // フォーカス追従（F2）はまだ配線されていないため、手動オープンのみをサポートする。
  const [worktreeRoot, setWorktreeRoot] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  // repo-changed イベント配信（events WS）はまだ配線されていない。0 のまま。
  const [repoChangedTick] = useState(0);

  const persist = useCallback((next: typeof layout) => {
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

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <aside className="w-60 shrink-0 border-r border-border p-2 text-sm text-muted-foreground">
        サイドバー
      </aside>

      <main className="min-w-0 flex-1">
        <Terminal className="h-full w-full" />
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
            pinned={pinned}
            onPinToggle={() => setPinned((p) => !p)}
            repoChangedTick={repoChangedTick}
            onOpenPath={setWorktreeRoot}
          />
        )}
      </aside>
    </div>
  );
}
