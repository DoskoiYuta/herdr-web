// Wraps @pierre/diffs/react's CodeView. Ported from terminal-diff's
// src/client/components/DiffView.tsx — keeps the --diffs-font-size /
// --diffs-line-height CSS custom property wiring (crossing the Shadow DOM
// boundary by inheritance, so they must land on CodeView's own scroll-root
// element), the itemMetrics <-> lineHeight sync, the ResizeObserver-driven
// split->unified auto-switch at narrow widths, and scrollToItem.
//
// Differences from tdiff's version:
//   - loadDiffFiles hydrates via gitApi.files() (the Hono RPC client) instead
//     of a raw fetch("/api/files?..."); 409/404/binary handling is dropped
//     since /api/git/files reports failures via FilesErrorCodeSchema, not
//     these tdiff-specific HTTP statuses (see FilesErrorCodeSchema in
//     src/contract/git.ts) — any load failure just toasts generically.
//   - `themeType` isn't a per-panel Settings field here (herdr-web's theme
//     is a single global `.dark` class on <html>); this component watches
//     that class itself via a MutationObserver.
//   - adds the Nerd Font monospace stack as --diffs-font-family (M3 spec).

import type {
  CodeView as CodeViewInstance,
  CodeViewLineSelection,
  DiffLineAnnotation,
  FileDiffLoadedFiles,
  FileDiffMetadata,
} from "@pierre/diffs";
import { CodeView } from "@pierre/diffs/react";
import type { CodeViewDiffItem, CodeViewHandle, CodeViewReactOptions } from "@pierre/diffs/react";
import type { ReactNode } from "react";
import type { ReviewAnnotationMeta } from "./reviewAnnotations.ts";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { gitApi } from "@/lib/api";
import { effectiveDiffStyle, fontMetrics } from "./reconcile.ts";
import type { Settings } from "./state.ts";

const ZERO_OBJECT_ID = /^0+$/;

export const DIFF_FONT_FAMILY = '"JetBrainsMono Nerd Font", ui-monospace, monospace';

export interface DiffViewHandle {
  scrollToItem(id: string): void;
  /** Scroll to a specific real per-side line number within an item (F5-8: Review タブからのジャンプ用). */
  scrollToLine(id: string, lineNumber: number, side: "deletions" | "additions"): void;
}

export interface DiffViewProps {
  items: readonly CodeViewDiffItem<ReviewAnnotationMeta>[];
  settings: Settings;
  /** worktree root passed through to gitApi.files() as `&repo=`. */
  repo: string;
  onToast(message: string): void;
  /** Reports the top-most visible item id on every scroll, to keep the
   * file tree / selector following scroll position. */
  onTopItemChange(id: string): void;
  /** Reports the raw scrollTop on every scroll — used by DiffPanel to decide
   * whether an incoming update should auto-apply (scrolled to top) or wait
   * behind a banner (scrolled away from top). */
  onScrollTopChange?(scrollTop: number): void;
  /** F3-6: current line/range selection (comment composer target). */
  selectedLines?: CodeViewLineSelection | null;
  onSelectedLinesChange?(selection: CodeViewLineSelection | null): void;
  /** Renders the composer / inline review thread for one DiffLineAnnotation (F3-6, F5-8). */
  renderAnnotation?(
    annotation: DiffLineAnnotation<ReviewAnnotationMeta>,
    item: CodeViewDiffItem<ReviewAnnotationMeta>,
  ): ReactNode;
}

function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useLayoutEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    const el = document.documentElement;
    const observer = new MutationObserver(() => setIsDark(el.classList.contains("dark")));
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

const DiffView = forwardRef<DiffViewHandle, DiffViewProps>(function DiffView(
  {
    items,
    settings,
    repo,
    onToast,
    onTopItemChange,
    onScrollTopChange,
    selectedLines,
    onSelectedLinesChange,
    renderAnnotation,
  },
  ref,
) {
  const codeViewRef = useRef<CodeViewHandle<ReviewAnnotationMeta>>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef(items);
  const onToastRef = useRef(onToast);
  const onTopItemChangeRef = useRef(onTopItemChange);
  const onScrollTopChangeRef = useRef(onScrollTopChange);
  const repoRef = useRef(repo);

  // Keep the "latest value" refs in sync after each render (not during it —
  // mutating a ref's `.current` while rendering is a React anti-pattern that
  // oxlint's react(refs) rule flags), so callbacks registered once with
  // @pierre/diffs (scroll handlers, the file loader) always see fresh props
  // without needing to be re-subscribed on every change.
  useLayoutEffect(() => {
    itemsRef.current = items;
    onToastRef.current = onToast;
    onTopItemChangeRef.current = onTopItemChange;
    onScrollTopChangeRef.current = onScrollTopChange;
    repoRef.current = repo;
  });

  const isDark = useIsDark();

  useImperativeHandle(
    ref,
    () => ({
      scrollToItem(id: string) {
        codeViewRef.current?.scrollTo({ type: "item", id, align: "start" });
      },
      scrollToLine(id: string, lineNumber: number, side: "deletions" | "additions") {
        codeViewRef.current?.scrollTo({ type: "line", id, lineNumber, side, align: "center" });
      },
    }),
    [],
  );

  const metrics = fontMetrics(settings.fontSize);

  // Responsive split->unified: observe the scroll root's width. jsdom has no
  // ResizeObserver, in which case the width stays unknown and the setting wins.
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    // Defer the state update to the next frame: setting state synchronously
    // inside the callback re-lays out CodeView (unified/split changes its
    // width), which the browser reports as "ResizeObserver loop completed
    // with undelivered notifications".
    let raf = 0;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w !== "number") return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setContainerWidth(w));
    });
    ro.observe(node);
    setContainerWidth(node.clientWidth);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);
  const diffStyle = effectiveDiffStyle(settings.diffStyle, containerWidth);

  // Custom properties cross the Shadow DOM boundary by inheritance — they
  // must be set directly on CodeView's own scroll-root element (the node
  // CodeView.setup() was called with), not via a stylesheet rule.
  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
    node?.setAttribute("id", "scroll-root");
  }, []);

  // containerRef is still null during the *first* render (the callback ref
  // above only fires after React commits the DOM node), so writing these
  // directly in the render body silently no-ops on mount. A layout effect
  // runs after the ref is attached — on mount and on every fontSize change
  // — so it both applies the vars once the container exists and keeps them
  // in sync thereafter, before paint.
  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    node.style.setProperty("--diffs-font-size", `${metrics.fontSize}px`);
    node.style.setProperty("--diffs-line-height", `${metrics.lineHeight}px`);
    node.style.setProperty("--diffs-font-family", DIFF_FONT_FAMILY);
  }, [metrics.fontSize, metrics.lineHeight]);

  const options: CodeViewReactOptions<ReviewAnnotationMeta> = useMemo(
    () => ({
      theme: { dark: "pierre-dark", light: "pierre-light" },
      themeType: isDark ? "dark" : "light",
      diffStyle,
      overflow: settings.overflow,
      diffIndicators: "bars",
      lineDiffType: "word-alt",
      hunkSeparators: "line-info",
      stickyHeaders: true,
      enableLineSelection: true,
      expansionLineCount: 100,
      layout: { paddingTop: 12, paddingBottom: 96, gap: 12 },
      // diffHeaderHeight must travel alongside lineHeight, or CodeView falls
      // back to its own default (44px) which drifts once the font size
      // changes — same scroll-jumping failure mode as an unsynced
      // lineHeight.
      itemMetrics: { lineHeight: metrics.lineHeight, diffHeaderHeight: metrics.diffHeaderHeight },
      async loadDiffFiles(fileDiff: FileDiffMetadata) {
        try {
          const oldHash =
            fileDiff.prevObjectId && !ZERO_OBJECT_ID.test(fileDiff.prevObjectId)
              ? fileDiff.prevObjectId
              : undefined;
          const newHash =
            fileDiff.newObjectId && !ZERO_OBJECT_ID.test(fileDiff.newObjectId)
              ? fileDiff.newObjectId
              : undefined;
          const loaded = await gitApi.files({
            repo: repoRef.current,
            path: fileDiff.name,
            type: fileDiff.type,
            ...(fileDiff.prevName != null ? { prev: fileDiff.prevName } : {}),
            ...(oldHash !== undefined ? { oldHash } : {}),
            ...(newHash !== undefined ? { newHash } : {}),
          });
          // FilesResponse's oldFile/newFile are nullable per the wire
          // contract (a "new"/"deleted" file has one side missing), while
          // @pierre/diffs' FileDiffLoadedFiles only special-cases the
          // pure-rename shape (oldFile: null) — the rest of its variants
          // assume both sides are present. The server only omits a side for
          // rename-pure, new, and deleted, matching CodeView's own handling
          // of those fileDiff.type values, so this is safe.
          if (fileDiff.type === "rename-pure") {
            return { oldFile: null, newFile: loaded.newFile } as FileDiffLoadedFiles;
          }
          return loaded as FileDiffLoadedFiles;
        } catch (err) {
          onToastRef.current("読み込みに失敗しました");
          throw err;
        }
      },
    }),
    [isDark, diffStyle, settings.overflow, metrics.lineHeight, metrics.diffHeaderHeight],
  );

  // CodeView's onScroll passes the underlying CodeView instance directly —
  // no need to route through getInstance().
  const handleScroll = useCallback(
    (scrollTop: number, viewer: CodeViewInstance<ReviewAnnotationMeta>) => {
      onScrollTopChangeRef.current?.(scrollTop);
      let candidateId: string | null = null;
      for (const item of itemsRef.current) {
        const top = viewer.getTopForItem(item.id);
        if (top === undefined) continue;
        if (top <= scrollTop) {
          candidateId = item.id;
        } else {
          // items are laid out in the same order as itemsRef.current
          break;
        }
      }
      if (candidateId) onTopItemChangeRef.current(candidateId);
    },
    [],
  );

  return (
    <CodeView
      ref={codeViewRef}
      containerRef={setContainerRef}
      className="scroll-root h-full min-h-0 flex-1 overflow-y-auto"
      items={items}
      options={options}
      onScroll={handleScroll}
      selectedLines={selectedLines}
      onSelectedLinesChange={onSelectedLinesChange}
      renderAnnotation={renderAnnotation}
    />
  );
});

export default DiffView;
