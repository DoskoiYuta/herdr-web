// Syntax-highlighted single-file view for the Files tab. Uses @pierre/diffs/
// react's `CodeView` (the same component DiffView.tsx wraps) with a single
// `CodeViewFileItem`, rather than the simpler `File` component this used
// before F10 — line selection + `renderAnnotation` (the ask composer/thread
// mechanism, mirroring diff/reviewAnnotations.ts) only exist on CodeView;
// `File` has no selection or annotation slot at all (see
// node_modules/@pierre/diffs/dist/components/File.d.ts).
import { CodeView, EditProvider } from "@pierre/diffs/react";
import type { CodeViewLineSelection, FileContents, LineAnnotation } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/edit";
import type {
  CodeViewFileItem,
  CodeViewHandle,
  CodeViewItem,
  CodeViewReactOptions,
} from "@pierre/diffs/react";
import type { CSSProperties, ReactNode, Ref } from "react";
import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import { fontMetrics } from "@/lib/codeFont";
import { useIsDark } from "@/lib/useIsDark";

export interface CodeFileViewProps<T = undefined> {
  path: string;
  contents: string;
  fontSize: number;
  /** F10: current line/range selection (ask composer target). */
  selectedLines?: CodeViewLineSelection | null;
  onSelectedLinesChange?: (selection: CodeViewLineSelection | null) => void;
  /** Mouse-drag lifecycle: `onSelectedLinesChange` fires from the first
   * mousedown on — callers wait for `onLineSelectionEnd` before opening a
   * composer, same as DiffView. */
  onLineSelectionStart?: () => void;
  onLineSelectionEnd?: () => void;
  annotations?: LineAnnotation<T>[];
  renderAnnotation?: (annotation: LineAnnotation<T>, item: CodeViewItem<T>) => ReactNode;
  /** Scroll position to restore for this `path` (fileScroll.ts). Applied once
   * per `path` change, not on every value change — see the effect below. */
  scrollTop?: number;
  onScrollTopChange?: (top: number) => void;
  /** Turns on `@pierre/diffs`' built-in editor for this item (mounts
   * `EditProvider`, which rebuilds the underlying `CodeView` — scroll
   * position and selection are lost across a toggle). Undefined/false
   * behaves exactly like before this prop existed. */
  editable?: boolean;
  /** Fires on every keystroke and when the editor commits a pending edit;
   * both are treated the same by callers (draft tracking only cares about
   * current text, not which event produced it). */
  onEditChange?: (contents: string) => void;
}

/** F10 (質問セッションの「対象ファイルを開く」): imperative scroll-to-line, mirroring
 * DiffView.tsx's `DiffViewHandle`. Files have a single side (`ITEM_ID`), so no
 * `side` selector is needed. */
export interface CodeFileViewHandle {
  scrollToLine(lineNumber: number): void;
}

const ITEM_ID = "file";

function CodeFileViewInner<T = undefined>(
  {
    path,
    contents,
    fontSize,
    selectedLines = null,
    onSelectedLinesChange,
    onLineSelectionStart,
    onLineSelectionEnd,
    annotations = [],
    renderAnnotation,
    scrollTop,
    onScrollTopChange,
    editable = false,
    onEditChange,
  }: CodeFileViewProps<T>,
  ref: Ref<CodeFileViewHandle>,
) {
  const codeViewRef = useRef<CodeViewHandle<T>>(null);
  useImperativeHandle(
    ref,
    () => ({
      scrollToLine(lineNumber: number) {
        codeViewRef.current?.scrollTo({ type: "line", id: ITEM_ID, lineNumber, align: "center" });
      },
    }),
    [],
  );

  // Restores this path's saved position once per `path` change, not on every
  // `scrollTop` change (a user's own scrolling reports new values via
  // `onScrollTopChange`, which must not trigger a re-jump). Runs as a layout
  // effect — after CodeView's React wrapper has swapped `items` in its own
  // layout effect but before paint — so it lands on the new file's height
  // instead of the previous file's.
  const restoredPathRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    codeViewRef.current?.scrollTo({
      type: "position",
      position: scrollTop ?? 0,
      behavior: "instant",
    });
    restoredPathRef.current = path;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const isDark = useIsDark();
  const metrics = fontMetrics(fontSize);

  // CodeView only rebuilds an item's annotation portals when its `id:version`
  // changes (see DiffPanel.tsx's identical comment) — content changes (a new
  // file, or a poll picking up an edit) and annotation-set changes both need
  // to bump this, so track a signature of both.
  const contentRev = useRef(0);
  const lastContent = useRef<string | null>(null);
  const contentSig = `${path}\n${contents}\n${editable}`;
  if (lastContent.current !== contentSig) {
    lastContent.current = contentSig;
    contentRev.current += 1;
  }
  const annotationSig = useMemo(
    () => annotations.map((a) => `${a.lineNumber}:${JSON.stringify(a.metadata)}`).join("\n"),
    [annotations],
  );
  const annotationRev = useRef({ sig: annotationSig, rev: 0 });
  if (annotationRev.current.sig !== annotationSig) {
    annotationRev.current = { sig: annotationSig, rev: annotationRev.current.rev + 1 };
  }
  const version = contentRev.current * 1_000_000 + (annotationRev.current.rev % 1_000_000);

  const item: CodeViewFileItem<T> = useMemo(
    () => ({
      id: ITEM_ID,
      type: "file",
      file: { name: path, contents },
      annotations,
      version,
      edit: editable,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, contents, annotationSig, version, editable],
  );

  const style: CSSProperties = {
    ["--diffs-font-size" as string]: `${metrics.fontSize}px`,
    ["--diffs-line-height" as string]: `${metrics.lineHeight}px`,
  };

  const options: CodeViewReactOptions<T> = useMemo(
    () => ({
      theme: { dark: "pierre-dark", light: "pierre-light" },
      themeType: isDark ? "dark" : "light",
      overflow: "scroll",
      enableLineSelection: true,
      onLineSelectionStart: () => onLineSelectionStart?.(),
      onLineSelectionEnd: () => onLineSelectionEnd?.(),
      itemMetrics: { lineHeight: metrics.lineHeight, diffHeaderHeight: metrics.diffHeaderHeight },
    }),
    [
      isDark,
      metrics.lineHeight,
      metrics.diffHeaderHeight,
      onLineSelectionStart,
      onLineSelectionEnd,
    ],
  );

  const codeView = (
    <CodeView
      ref={codeViewRef}
      className="h-full min-h-0 flex-1 overflow-y-auto"
      style={style}
      items={[item]}
      options={options}
      selectedLines={selectedLines}
      onSelectedLinesChange={onSelectedLinesChange}
      renderAnnotation={renderAnnotation}
      onItemEditChange={(_item, file: FileContents) => onEditChange?.(file.contents)}
      onItemEditComplete={(_item, file: FileContents) => onEditChange?.(file.contents)}
      onScroll={(top) => {
        // Swapping `items` for a new path can fire onScroll with the old
        // file's (clamped) position before the restoring effect above has
        // run for the new path — drop reports until this path is restored.
        if (restoredPathRef.current !== path) return;
        onScrollTopChange?.(top);
      }}
    />
  );

  // `EditProvider` is only mounted while this item is editable, so the
  // (much more common) read-only path never pays for it, and mounting/
  // unmounting it rebuilds `CodeView` — expected to reset scroll/selection.
  if (!editable) return codeView;
  return <EditProvider createEditor={(opts) => new Editor(opts)}>{codeView}</EditProvider>;
}

// forwardRef erases the function's own generic parameter, so this re-casts
// the wrapped component back to a generic-preserving signature — the same
// pattern @pierre/diffs' own CodeView uses (see CodeViewComponent in
// node_modules/@pierre/diffs/dist/react/CodeView.d.ts).
export const CodeFileView = forwardRef(CodeFileViewInner) as <T = undefined>(
  props: CodeFileViewProps<T> & { ref?: Ref<CodeFileViewHandle> },
) => ReturnType<typeof CodeFileViewInner>;

export default CodeFileView;
