// Composition root for the diff viewer (M3). Built fresh rather than ported
// from terminal-diff's App.tsx: that file also owned SSE, the "instance"
// concept, repo-select, quit and the notReady path, none of which exist
// here. DiffPanel does NOT own comparison state (`from`/`to`) — that's
// lifted to the parent ToolPane, which passes them down as props.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parsePatchFiles } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";
import type { CodeViewDiffItem } from "@pierre/diffs/react";
import { ResizeHandle } from "@/components/terminal/ResizeHandle";
import type { PatchResponse } from "@contract/git";
import Banners from "./Banners.tsx";
import DiffView from "./DiffView.tsx";
import type { DiffViewHandle } from "./DiffView.tsx";
import FileTree from "./FileTree.tsx";
import { usePatch } from "./hooks/usePatch.ts";
import { reconcile, summarize } from "./reconcile.ts";
import type { FileMap } from "./reconcile.ts";
import {
  DEFAULT_SETTINGS,
  initialBannerState,
  MAX_TREE_WIDTH,
  MIN_TREE_WIDTH,
  reduceBanner,
  updateBanner as deriveUpdateBanner,
  validateSettings,
} from "./state.ts";
import type { BannerState, Settings } from "./state.ts";
import StatusLine from "./StatusLine.tsx";
import { buildTree, fileStats, fileStatus } from "./tree.ts";
import Toolbar from "./Toolbar.tsx";

const SETTINGS_KEY = "herdr-web:diff-settings";
/** A scrollTop at or below this is "at the top" for auto-apply purposes. */
const NEAR_TOP_PX = 4;

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return validateSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore — settings just won't persist across reloads
  }
}

function buildHashMap(files: PatchResponse["files"] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of files ?? []) map.set(f.name, f.hash);
  return map;
}

function buildUntrackedMap(files: PatchResponse["files"] | undefined): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const f of files ?? []) map.set(f.name, !!f.untracked);
  return map;
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

/** Renders "WORKTREE vs HEAD" / "INDEX vs HEAD" / "<hash7> vs <hash7>" from the from/to props. */
export function comparisonLabel(from: string | undefined, to: string | undefined): string {
  const fromLabel = from ?? "HEAD";
  const toLabel = to ?? "WORKTREE";
  const shorten = (x: string) =>
    x === "HEAD" || x === "WORKTREE" || x === "INDEX" ? x : x.slice(0, 7);
  return `${shorten(toLabel)} vs ${shorten(fromLabel)}`;
}

export interface DiffPanelProps {
  repo: string;
  from?: string;
  to?: string;
  /** Bumped by the parent whenever this repo's git state is known to have changed. */
  repoChangedTick: number;
}

export function DiffPanel({ repo, from, to, repoChangedTick }: DiffPanelProps) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  useEffect(() => saveSettings(settings), [settings]);

  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const treeWidth = dragWidth ?? settings.treeWidth;
  const handleTreeResize = useCallback((width: number) => setDragWidth(width), []);
  const handleTreeResizeEnd = useCallback((width: number) => {
    setDragWidth(null);
    setSettings((s) => ({ ...s, treeWidth: width }));
  }, []);

  const fileMapRef = useRef<FileMap>(new Map());
  const [items, setItems] = useState<CodeViewDiffItem[]>([]);
  const [parsedFiles, setParsedFiles] = useState<FileDiffMetadata[]>([]);
  const [untrackedByName, setUntrackedByName] = useState<Map<string, boolean>>(new Map());
  const [untrackedTruncated, setUntrackedTruncated] = useState(false);
  const [untrackedErrors, setUntrackedErrors] = useState(0);
  const [untrackedCount, setUntrackedCount] = useState(0);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diffViewRef = useRef<DiffViewHandle>(null);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const toggleDir = useCallback((path: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // -------------------------------------------------------------------
  // Update-available banner state (state.ts's trimmed reducer) plus
  // scroll-position tracking, to decide auto-apply vs. banner.
  // -------------------------------------------------------------------
  const [bannerState, setBannerState] = useState<BannerState>(initialBannerState());
  const scrollTopRef = useRef(0);
  const handleScrollTopChange = useCallback((top: number) => {
    scrollTopRef.current = top;
  }, []);

  const applyPatchResponse = useCallback((data: PatchResponse) => {
    setGeneratedAt(data.generatedAt);
    setUntrackedByName(buildUntrackedMap(data.files));
    setUntrackedTruncated(!!data.untrackedTruncated);
    setUntrackedErrors(data.untrackedErrors ?? 0);

    const parsed = parsePatchFiles(data.patch, data.hash);
    const files = parsed[0]?.files ?? [];
    const hashes = buildHashMap(data.files);

    const { items: nextItems, next } = reconcile(fileMapRef.current, files, hashes);
    fileMapRef.current = next;
    setItems(nextItems);
    setParsedFiles(files);
    setUntrackedCount(data.untrackedCount ?? 0);

    setBannerState((s) => reduceBanner(s, { type: "applied", hash: data.hash }));
  }, []);

  const patchQuery = usePatch({ repo, from, to, repoChangedTick });

  const appliedHashRef = useRef<string | null>(null);
  // Mirrors `appliedHashRef.current === null` as state, for the one place
  // (deriving `errorText` below) that needs this during render — reading a
  // ref's `.current` during render is a react(refs) lint error, so that
  // check goes through state instead of the ref itself.
  const [hasEverApplied, setHasEverApplied] = useState(false);
  useEffect(() => {
    if (!patchQuery.isSuccess || !patchQuery.data) return;
    const data = patchQuery.data;
    if (appliedHashRef.current === data.hash) return;

    setBannerState((s) => reduceBanner(s, { type: "fetched", hash: data.hash }));

    const isEmpty = appliedHashRef.current === null || items.length === 0;
    const isNearTop = scrollTopRef.current <= NEAR_TOP_PX;
    if (isEmpty || isNearTop) {
      appliedHashRef.current = data.hash;
      setHasEverApplied(true);
      applyPatchResponse(data);
    }
  }, [patchQuery.isSuccess, patchQuery.data, applyPatchResponse, items.length]);

  const applyPending = useCallback(() => {
    const data = patchQuery.data;
    if (!data) return;
    appliedHashRef.current = data.hash;
    setHasEverApplied(true);
    applyPatchResponse(data);
  }, [patchQuery.data, applyPatchResponse]);

  // -------------------------------------------------------------------
  // File selection follows the rendered items. Adjusted during render
  // (React's documented pattern for "state that depends on a prop/derived
  // value changing"), not in an effect: an effect here would setState
  // synchronously on every `items` change and force an extra commit.
  // -------------------------------------------------------------------
  const [prevItemsForSelection, setPrevItemsForSelection] = useState(items);
  if (items !== prevItemsForSelection) {
    setPrevItemsForSelection(items);
    const next =
      items.length === 0
        ? null
        : selectedId && items.some((item) => item.id === selectedId)
          ? selectedId
          : items[0]!.id;
    if (next !== selectedId) setSelectedId(next);
  }

  const jumpToIndex = useCallback(
    (index: number) => {
      if (items.length === 0) return;
      const clamped = Math.max(0, Math.min(items.length - 1, index));
      const id = items[clamped]!.id;
      setSelectedId(id);
      diffViewRef.current?.scrollToItem(id);
    },
    [items],
  );

  const selectFile = useCallback((id: string) => {
    setSelectedId(id);
    diffViewRef.current?.scrollToItem(id);
  }, []);

  const handleTopItemChange = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? prev : id));
  }, []);

  // -------------------------------------------------------------------
  // Keyboard: j/k to move between files, r to apply a pending update.
  // -------------------------------------------------------------------
  const selectedIndexRef = useRef(0);
  useEffect(() => {
    selectedIndexRef.current = items.findIndex((item) => item.id === selectedId);
  }, [items, selectedId]);

  useEffect(() => {
    function onKeydown(event: KeyboardEvent) {
      if (isTypingTarget(document.activeElement)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "j") {
        event.preventDefault();
        jumpToIndex(selectedIndexRef.current + 1);
      } else if (event.key === "k") {
        event.preventDefault();
        jumpToIndex(selectedIndexRef.current - 1);
      } else if (event.key === "r") {
        event.preventDefault();
        applyPending();
      }
    }
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }, [jumpToIndex, applyPending]);

  // -------------------------------------------------------------------
  // Derived
  // -------------------------------------------------------------------
  const banner = useMemo(() => deriveUpdateBanner(bannerState), [bannerState]);
  const errorText =
    patchQuery.isError && !hasEverApplied
      ? patchQuery.error instanceof Error
        ? patchQuery.error.message
        : String(patchQuery.error)
      : null;
  const summary = useMemo(() => summarize(parsedFiles), [parsedFiles]);
  const label = comparisonLabel(from, to);

  const treeNodes = useMemo(() => {
    const entries = items.map((item) => {
      const fileDiff = item.fileDiff;
      const untracked = !!untrackedByName.get(fileDiff.name);
      const stats = fileStats(fileDiff);
      return {
        id: item.id,
        name: fileDiff.name,
        status: fileStatus(fileDiff, untracked),
        additions: stats.additions,
        deletions: stats.deletions,
      };
    });
    return buildTree(entries);
  }, [items, untrackedByName]);

  return (
    <div id="diff-panel" className="flex h-full min-h-0 flex-col">
      <Toolbar
        settings={settings}
        onToggleTree={() => setSettings((s) => ({ ...s, showTree: !s.showTree }))}
        onToggleDiffStyle={() =>
          setSettings((s) => ({ ...s, diffStyle: s.diffStyle === "split" ? "unified" : "split" }))
        }
        onToggleOverflow={() =>
          setSettings((s) => ({ ...s, overflow: s.overflow === "wrap" ? "scroll" : "wrap" }))
        }
        onFontDec={() => setSettings((s) => ({ ...s, fontSize: Math.max(10, s.fontSize - 1) }))}
        onFontInc={() => setSettings((s) => ({ ...s, fontSize: Math.min(24, s.fontSize + 1) }))}
        onRefresh={applyPending}
        disabled={false}
      />
      <div className="border-b border-border px-2 py-1 text-xs text-muted-foreground">{label}</div>
      <div className="flex min-h-0 flex-1">
        {settings.showTree && (
          <>
            <FileTree
              nodes={treeNodes}
              activeId={selectedId}
              onSelect={selectFile}
              collapsed={collapsedDirs}
              onToggleDir={toggleDir}
              width={treeWidth}
            />
            <ResizeHandle
              width={treeWidth}
              min={MIN_TREE_WIDTH}
              max={MAX_TREE_WIDTH}
              defaultWidth={DEFAULT_SETTINGS.treeWidth}
              onResize={handleTreeResize}
              onResizeEnd={handleTreeResizeEnd}
            />
          </>
        )}
        <div id="main" className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Banners
            updateBanner={banner}
            errorText={errorText}
            untrackedTruncated={untrackedTruncated}
            onUpdate={applyPending}
          />
          <StatusLine
            summary={summary}
            generatedAt={generatedAt}
            untrackedCount={untrackedCount}
            untrackedErrors={untrackedErrors}
          />
          <div className="min-h-0 flex-1">
            <DiffView
              ref={diffViewRef}
              items={items}
              settings={settings}
              repo={repo}
              onToast={showToast}
              onTopItemChange={handleTopItemChange}
              onScrollTopChange={handleScrollTopChange}
            />
          </div>
        </div>
      </div>
      {toast != null && (
        <div
          id="toast"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

export default DiffPanel;
