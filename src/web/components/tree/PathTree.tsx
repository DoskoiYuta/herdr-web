// Generic wrapper of @pierre/trees/react, shared by the Files tab, the Diff
// file tree and the Graph commit-detail file tree. Grown out of the old
// files/FilesTree.tsx — see treeDiff.ts for the incremental sync rationale.
//
// `useFileTree` only reads its `options` on the very first render (see
// node_modules/@pierre/trees/dist/react/useFileTree.js — the model is
// created once via a `useState` initializer), so any prop that can change
// after mount (`paths`, `gitStatus`, `decorations`) can't just be passed
// through: the model would silently stop following it after mount. Instead
// this component tracks the previously-applied path list and pushes only
// the delta (treeDiff.ts) through `model.batch()`, pushes `gitStatus`
// through `model.setGitStatus()`, and reads `decorations` through a ref from
// inside the (constructor-only) `renderRowDecoration` callback — see the
// comment on that effect below for how a decoration-only change still
// reaches the screen.

import { FileTree, useFileTree } from "@pierre/trees/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { FILE_TREE_DEFAULT_ITEM_HEIGHT } from "@pierre/trees";
import type { ContextMenuItem, ContextMenuOpenContext, GitStatus } from "@pierre/trees";
import { cn } from "@/lib/utils";
import { HIDE_BUILT_IN_FILE_GIT_STATUS_CSS } from "./gitStatusDecoration";
import { diffPaths } from "./treeDiff";

/**
 * Row height (px) @pierre/trees actually renders at. PathTree never passes
 * `density`/`itemHeight` to `useFileTree`, so the library's own default
 * applies — re-exported here as the single place a caller that needs to
 * pre-compute a pixel height (e.g. Graph's commit detail, which sizes its
 * tree to content instead of a scrolling box — see CommitDetail.tsx) reads
 * it from, rather than hardcoding it.
 */
export const PATH_TREE_ROW_HEIGHT = FILE_TREE_DEFAULT_ITEM_HEIGHT;

/**
 * Row count @pierre/trees renders for `paths` under `initialExpansion="open"`:
 * every file plus every distinct ancestor directory. Overcounts slightly
 * versus the library's own render when it flattens a chain of single-child
 * directories into one row — acceptable here because callers only use this
 * to sum a pixel height up front, not to assert an exact row count.
 */
export function countFileTreeRows(paths: readonly string[]): number {
  const directories = new Set<string>();
  for (const path of paths) {
    const segments = path.replace(/\/$/, "").split("/");
    for (let i = 1; i < segments.length; i++) {
      directories.add(segments.slice(0, i).join("/"));
    }
  }
  return paths.length + directories.size;
}

export interface PathTreeDecoration {
  text: string;
  parts?: { text: string; color?: string }[];
  title?: string;
}

export interface PathTreeProps {
  /** Trailing `/` marks a directory node (see useLs.ts); a bare file path's
   * ancestor directories are inferred by the library from its segments, so
   * callers with a flat list of changed files (Diff, Graph) don't need to
   * list directories explicitly. */
  paths: string[];
  gitStatus?: { path: string; status: GitStatus }[];
  initialExpansion: "open" | "closed";
  selectedPath: string | null;
  onSelectFile?(path: string): void;
  /** Directories currently expanded in the tree. Called only when the set
   * actually changed. */
  onExpandedDirsChange?(dirs: string[]): void;
  /** Per-file row decoration (e.g. `+n`/`-n` stats), looked up by path. */
  decorations?: Map<string, PathTreeDecoration>;
  flattenEmptyDirectories?: boolean;
  /** Search box above the rows (default on). */
  search?: boolean;
  /** Row label font size in px (mirrors the code viewer's `fontSize`). */
  fontSize?: number;
  className?: string;
  style?: CSSProperties;
  /** Right-click menu entries for a row (Files tab only — omit elsewhere).
   * Presence/absence is read once at construction (see the module comment):
   * a caller either always passes this or never does. */
  contextMenuItems?: (item: {
    path: string;
    kind: "file" | "directory";
  }) => { label: string; onSelect: () => void }[];
  /** OS file/folder drop onto a row. `target.dir` is the hovered directory
   * (its own path for a directory row, the parent for a file row, `""` for
   * no row / root). Only fires for a native OS drag (`dataTransfer.types`
   * includes `"Files"`) — the library's own internal drag-to-move only acts
   * when it started an internal drag session, so this never fires for it. */
  onExternalDrop?: (target: { dir: string }, dataTransfer: DataTransfer) => void;
  /** Fired while an OS drag hovers the tree, with the directory a drop would
   * land in right now (`null` once the drag leaves). ui-redesign.md §5.4:
   * lets the caller show a "<dir>/ にドロップして取り込む" hint below the
   * tree. Only fires alongside `onExternalDrop`. */
  onExternalDragOver?: (dir: string | null) => void;
}

function targetDirFromRow(row: Element | null): string {
  if (!(row instanceof HTMLElement)) return "";
  const path = row.dataset.itemPath;
  if (!path) return "";
  if (path.endsWith("/")) return path.slice(0, -1);
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function hasFilesPayload(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer != null && Array.from(dataTransfer.types).includes("Files");
}

const TREE_THEME_STYLE: CSSProperties = {
  ["--trees-bg-override" as string]: "var(--background)",
  ["--trees-fg-override" as string]: "var(--foreground)",
  // Not mapped to shadcn's --accent: @pierre/trees derives selection/hover backgrounds by
  // mixing --trees-accent 12-15% into --trees-bg, and shadcn's --accent is nearly the same
  // grey as --background, so the mix is invisible. Keep the library's own accent (#009fff).
  ["--trees-selected-fg-override" as string]: "var(--foreground)",
  ["--trees-border-color-override" as string]: "var(--border)",
  height: "100%",
};

export function PathTree({
  paths,
  gitStatus,
  initialExpansion,
  selectedPath,
  onSelectFile,
  onExpandedDirsChange,
  decorations,
  flattenEmptyDirectories,
  search = true,
  fontSize,
  className,
  style,
  contextMenuItems,
  onExternalDrop,
  onExternalDragOver,
}: PathTreeProps) {
  const onSelectFileRef = useRef(onSelectFile);
  useLayoutEffect(() => {
    onSelectFileRef.current = onSelectFile;
  });
  const onExpandedDirsChangeRef = useRef(onExpandedDirsChange);
  useLayoutEffect(() => {
    onExpandedDirsChangeRef.current = onExpandedDirsChange;
  });

  // A programmatic `.select()` (below, driven by the `selectedPath` prop)
  // fires the library's onSelectionChange the same as a user click does.
  // Without this guard, a caller that derives `selectedPath` from something
  // else the user is doing (e.g. Diff deriving it from scroll position) and
  // then reacts to `onSelectFile` (e.g. by scrolling) would loop: our own
  // programmatic select echoes back as if the user had clicked the tree.
  const programmaticSelectRef = useRef(false);

  const decorationsRef = useRef(decorations);
  useLayoutEffect(() => {
    decorationsRef.current = decorations;
  });

  const { model } = useFileTree({
    paths,
    initialExpansion,
    flattenEmptyDirectories,
    search,
    gitStatus,
    // design.pen: monochrome folder/file outlines, not per-language colored icons.
    icons: { set: "minimal", colored: false },
    // design.pen colors the trailing git-status letter per status and spells
    // untracked "?" rather than the library's fixed, uncolored "U" — hide
    // its built-in letter (directories' "contains a change" dot is
    // untouched) and show our own via `decorations` instead.
    unsafeCSS: HIDE_BUILT_IN_FILE_GIT_STATUS_CSS,
    // Read once at construction (module comment) — a plain-button trigger
    // lane would otherwise appear on hover even before any menu content is
    // supplied. `enabled` itself is set by the React wrapper (FileTree.js)
    // whenever `renderContextMenu` is non-null, so only `triggerMode` needs
    // setting here.
    composition: contextMenuItems ? { contextMenu: { triggerMode: "right-click" } } : undefined,
    onSelectionChange: (selectedPaths) => {
      if (programmaticSelectRef.current) return;
      const path = selectedPaths[0];
      if (!path) return;
      if (model.getItem(path)?.isDirectory()) return;
      onSelectFileRef.current?.(path);
    },
    // Read live through the ref: this callback is only ever registered once
    // (see the module comment), so it must not close over the `decorations`
    // prop directly.
    renderRowDecoration: ({ item }) => {
      const dec = decorationsRef.current?.get(item.path);
      if (!dec) return null;
      return { text: dec.text, parts: dec.parts, title: dec.title };
    },
  });

  const appliedPathsRef = useRef(paths);
  useEffect(() => {
    const { added, removed } = diffPaths(appliedPathsRef.current, paths);
    appliedPathsRef.current = paths;
    if (added.length === 0 && removed.length === 0) return;
    // Removals go deepest-first and recursive: a directory that vanished on
    // disk still holds its previously listed children in the model, and the
    // store refuses to drop a non-empty directory otherwise.
    const removals = [...removed].sort((a, b) => b.length - a.length);
    model.batch([
      ...added.map((path) => ({ type: "add" as const, path })),
      ...removals.map((path) => ({ type: "remove" as const, path, recursive: true })),
    ]);
  }, [paths, model]);

  useEffect(() => {
    // renderRowDecoration has no dedicated setter (checked
    // FileTreeController.js / render/FileTree.js — only `setGitStatus`
    // mutates and triggers a re-render post-mount), so a decoration-only
    // change is nudged through by re-applying the same gitStatus: it's a
    // no-op semantically but still fires the mutation event rows re-render
    // on, and the decoration renderer above reads the fresh map via ref.
    model.setGitStatus(gitStatus ?? []);
    // `decorations` is intentionally listed so a decoration-only change
    // (gitStatus unchanged) still re-triggers this nudge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gitStatus, decorations, model]);

  useEffect(() => {
    if (selectedPath === null) return;
    const item = model.getItem(selectedPath);
    if (!item) return;
    programmaticSelectRef.current = true;
    item.select();
    programmaticSelectRef.current = false;
    model.scrollToPath(selectedPath, { offset: "nearest" });
  }, [selectedPath, model]);

  // The library has no dedicated expand/collapse event, so any mutation is
  // treated as "recompute expanded dirs" and only forwarded when the set
  // actually changed (subscribe fires on selection/search changes too).
  const lastExpandedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const scanExpandedDirs = () => {
      const rows = model.getVisibleRows(0, model.getVisibleCount());
      const dirs = rows
        .filter((row) => row.kind === "directory" && row.isExpanded)
        .map((row) => row.path.replace(/\/$/, ""));
      const key = [...dirs].sort().join("\0");
      if (key === lastExpandedKeyRef.current) return;
      lastExpandedKeyRef.current = key;
      onExpandedDirsChangeRef.current?.(dirs);
    };
    scanExpandedDirs();
    return model.subscribe(scanExpandedDirs);
  }, [model]);

  const renderContextMenu = useCallback(
    (item: ContextMenuItem, context: ContextMenuOpenContext): ReactNode => {
      const menuItems = contextMenuItems?.({ path: item.path, kind: item.kind }) ?? [];
      if (menuItems.length === 0) return null;
      return (
        <div
          role="menu"
          className="min-w-40 overflow-hidden rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md"
          onKeyDown={(e) => {
            if (e.key === "Escape") context.close();
          }}
        >
          {menuItems.map((mi) => (
            <button
              key={mi.label}
              type="button"
              role="menuitem"
              className="block w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                mi.onSelect();
                context.close();
              }}
            >
              {mi.label}
            </button>
          ))}
        </div>
      );
    },
    [contextMenuItems],
  );

  // Counts nested dragenter/dragleave so a child element's leave (fired
  // whenever the pointer crosses into a descendant) doesn't flicker the
  // drop-target highlight off before the outer dragleave arrives.
  const dragDepthRef = useRef(0);
  const [isDropTarget, setIsDropTarget] = useState(false);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLElement>) => {
    if (!hasFilesPayload(e.dataTransfer)) return;
    dragDepthRef.current += 1;
    setIsDropTarget(true);
  }, []);
  const lastDragOverDirRef = useRef<string | null>(null);
  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      if (!hasFilesPayload(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!onExternalDragOver) return;
      const row = e.currentTarget.shadowRoot
        ?.elementFromPoint(e.clientX, e.clientY)
        ?.closest('[data-type="item"]');
      const dir = targetDirFromRow(row ?? null);
      if (dir !== lastDragOverDirRef.current) {
        lastDragOverDirRef.current = dir;
        onExternalDragOver(dir);
      }
    },
    [onExternalDragOver],
  );
  const handleDragLeave = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      if (!hasFilesPayload(e.dataTransfer)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDropTarget(false);
        lastDragOverDirRef.current = null;
        onExternalDragOver?.(null);
      }
    },
    [onExternalDragOver],
  );
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      if (!hasFilesPayload(e.dataTransfer)) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDropTarget(false);
      lastDragOverDirRef.current = null;
      onExternalDragOver?.(null);
      // The host element is a custom element with its own shadow DOM, so a
      // plain `document.elementFromPoint` would only ever resolve back to
      // the host itself — reach through `shadowRoot` to hit the actual row.
      const row = e.currentTarget.shadowRoot
        ?.elementFromPoint(e.clientX, e.clientY)
        ?.closest('[data-type="item"]');
      onExternalDrop?.({ dir: targetDirFromRow(row ?? null) }, e.dataTransfer);
    },
    [onExternalDrop, onExternalDragOver],
  );

  return (
    <FileTree
      model={model}
      style={{
        ...TREE_THEME_STYLE,
        ...(fontSize !== undefined
          ? { ["--trees-font-size-override" as string]: `${fontSize}px` }
          : {}),
        ...style,
      }}
      className={cn(className ?? "h-full min-h-0", isDropTarget && "ring-2 ring-inset ring-ring")}
      renderContextMenu={contextMenuItems ? renderContextMenu : undefined}
      onDragEnter={onExternalDrop ? handleDragEnter : undefined}
      onDragOver={onExternalDrop ? handleDragOver : undefined}
      onDragLeave={onExternalDrop ? handleDragLeave : undefined}
      onDrop={onExternalDrop ? handleDrop : undefined}
    />
  );
}

export default PathTree;
