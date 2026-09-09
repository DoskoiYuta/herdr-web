// Files タブ（plan.md F9）で開いた各ファイルのスクロール位置。リポジトリ単位
// （`repoKey`）でパスごとに 1 エントリを持つ。`fileTabs.ts` と同じ流儀（1
// localStorage キーにまとめる、pure な状態遷移関数 + validate + hook）。

import { useCallback, useEffect, useRef } from "react";
import { createLocalStorageStore } from "./localStorageStore";

export type ScrollMode = "source" | "preview";

export interface FileScrollPositions {
  source?: number;
  preview?: number;
}

/** 1 リポジトリ分。オブジェクトのキー順を挿入順として扱う — 更新したパスは
 * delete してから再挿入し、「最近扱った順」を保つ（`fileTabs.ts` の
 * MAX_TABS_PER_REPO と同じ考え方）。 */
export type FileScrollEntry = Record<string, FileScrollPositions>;

export type FileScrollMap = Record<string, FileScrollEntry>;

const STORAGE_KEY = "herdr-web.fileScroll";

/** 1 リポジトリあたりのパス数の上限。超えたら最も古く扱ったパスを落とす。 */
export const MAX_SCROLL_ENTRIES_PER_REPO = 200;

function isValidPosition(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

function validatePositions(raw: unknown): FileScrollPositions {
  const out: FileScrollPositions = {};
  if (raw == null || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  if (isValidPosition(obj.source)) out.source = obj.source;
  if (isValidPosition(obj.preview)) out.preview = obj.preview;
  return out;
}

function validateEntry(raw: unknown): FileScrollEntry {
  const out: FileScrollEntry = {};
  if (raw == null || typeof raw !== "object") return out;
  for (const [path, positions] of Object.entries(raw as Record<string, unknown>)) {
    out[path] = validatePositions(positions);
  }
  return out;
}

export function validateFileScrollMap(raw: unknown): FileScrollMap {
  if (raw == null || typeof raw !== "object") return {};
  const out: FileScrollMap = {};
  for (const [repoKey, entry] of Object.entries(raw as Record<string, unknown>)) {
    out[repoKey] = validateEntry(entry);
  }
  return out;
}

const store = createLocalStorageStore<FileScrollMap>({
  key: STORAGE_KEY,
  defaultValue: {},
  validate: (raw) => validateFileScrollMap(raw),
});

// ---------------------------------------------------------------------------
// Pure state transitions (one repo's scroll map at a time)
// ---------------------------------------------------------------------------

export function getScroll(
  entry: FileScrollEntry,
  path: string,
  mode: ScrollMode,
): number | undefined {
  return entry[path]?.[mode];
}

export function setScroll(
  entry: FileScrollEntry,
  path: string,
  mode: ScrollMode,
  top: number,
): FileScrollEntry {
  const next: FileScrollEntry = { ...entry };
  delete next[path]; // re-insert below so `path` becomes the most-recently-touched key
  next[path] = { ...entry[path], [mode]: top };
  const paths = Object.keys(next);
  if (paths.length > MAX_SCROLL_ENTRIES_PER_REPO) {
    delete next[paths[0] as string];
  }
  return next;
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

const WRITE_DEBOUNCE_MS = 150;

export interface FileScrollActions {
  get(path: string, mode: ScrollMode): number | undefined;
  set(path: string, mode: ScrollMode, top: number): void;
}

/** `repoKey` が null の間は get は常に undefined、set は no-op（fileTabs.ts の
 * `useFileTabs` と同じ理由）。 `set` は 150ms でデバウンスして localStorage に
 * 書く — スクロールのたびに書き込まないため。アンマウント時・デバウンス中に
 * 別の (path, mode) への set が来たときは、保留中の書き込みを先に flush する。 */
export function useFileScroll(repoKey: string | null): FileScrollActions {
  const [map] = store.useStore();
  const pendingRef = useRef<{ path: string; mode: ScrollMode; top: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (!pending || repoKey === null) return;
    pendingRef.current = null;
    const current = store.get()[repoKey] ?? {};
    store.set({ [repoKey]: setScroll(current, pending.path, pending.mode, pending.top) });
  }, [repoKey]);

  useEffect(() => flush, [flush]);

  const get = useCallback(
    (path: string, mode: ScrollMode): number | undefined => {
      if (repoKey === null) return undefined;
      const pending = pendingRef.current;
      if (pending && pending.path === path && pending.mode === mode) return pending.top;
      return getScroll(map[repoKey] ?? {}, path, mode);
    },
    [repoKey, map],
  );

  const set = useCallback(
    (path: string, mode: ScrollMode, top: number) => {
      if (repoKey === null) return;
      const existing = pendingRef.current;
      if (existing && (existing.path !== path || existing.mode !== mode)) flush();
      else if (existing && existing.top === top) return;
      pendingRef.current = { path, mode, top };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, WRITE_DEBOUNCE_MS);
    },
    [repoKey, flush],
  );

  return { get, set };
}
