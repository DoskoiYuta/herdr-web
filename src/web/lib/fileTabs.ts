// Files タブ（plan.md F9）で開いたファイルのタブ列。リポジトリ単位
// （`repoKey` = git-common-dir の realpath）で 1 エントリを持ち、worktree を
// 切り替えても同じ列が出る。1 つの localStorage キーの中に repoKey ごとの
// エントリをまとめて持つ（キーの数を増やさない — `viewerSettings.ts` と同じ
// 流儀）。

import { useCallback } from "react";
import { createLocalStorageStore } from "./localStorageStore";

export interface FileTabsState {
  paths: string[];
  active: string | null;
}

export const EMPTY_FILE_TABS: FileTabsState = { paths: [], active: null };

export type FileTabsMap = Record<string, FileTabsState>;

const STORAGE_KEY = "herdr-web.fileTabs";

function validateEntry(raw: unknown): FileTabsState {
  const out: FileTabsState = { paths: [], active: null };
  if (raw == null || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;

  if (Array.isArray(obj.paths) && obj.paths.every((p): p is string => typeof p === "string")) {
    out.paths = [...new Set(obj.paths)];
  }
  if (typeof obj.active === "string" && out.paths.includes(obj.active)) {
    out.active = obj.active;
  }
  return out;
}

export function validateFileTabsMap(raw: unknown): FileTabsMap {
  if (raw == null || typeof raw !== "object") return {};
  const out: FileTabsMap = {};
  for (const [repoKey, entry] of Object.entries(raw as Record<string, unknown>)) {
    out[repoKey] = validateEntry(entry);
  }
  return out;
}

const store = createLocalStorageStore<FileTabsMap>({
  key: STORAGE_KEY,
  defaultValue: {},
  validate: (raw) => validateFileTabsMap(raw),
});

// ---------------------------------------------------------------------------
// Pure state transitions (one repo's tab list at a time)
// ---------------------------------------------------------------------------

/** クリックのたびに 1 タブ増える（プレビュータブ方式は採らない）。既に開いて
 * いれば末尾に足さず、そのままアクティブにする。 */
export function openTab(state: FileTabsState, path: string): FileTabsState {
  if (state.paths.includes(path)) return { ...state, active: path };
  return { paths: [...state.paths, path], active: path };
}

/** 閉じたタブがアクティブだった場合、隣（右優先、無ければ左）を選ぶ。最後の
 * 1 枚を閉じたら active は null。 */
export function closeTab(state: FileTabsState, path: string): FileTabsState {
  const idx = state.paths.indexOf(path);
  if (idx === -1) return state;
  const paths = state.paths.filter((p) => p !== path);
  if (state.active !== path) return { paths, active: state.active };
  const active = paths[idx] ?? paths[idx - 1] ?? null;
  return { paths, active };
}

export function closeOtherTabs(state: FileTabsState, path: string): FileTabsState {
  if (!state.paths.includes(path)) return state;
  return { paths: [path], active: path };
}

export function closeAllTabs(): FileTabsState {
  return { paths: [], active: null };
}

export function setActiveTab(state: FileTabsState, path: string): FileTabsState {
  if (!state.paths.includes(path)) return state;
  return { ...state, active: path };
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export interface FileTabsActions {
  open(path: string): void;
  close(path: string): void;
  closeOthers(path: string): void;
  closeAll(): void;
}

/** `repoKey` が null（herdr 未接続などでまだ解決できていない）の間はタブ列を
 * 空のまま返し、操作は no-op にする — 解決前に localStorage の別 repoKey の
 * エントリを壊さないため。 */
export function useFileTabs(repoKey: string | null): [FileTabsState, FileTabsActions] {
  const [map, setMap] = store.useStore();
  const state = repoKey !== null ? (map[repoKey] ?? EMPTY_FILE_TABS) : EMPTY_FILE_TABS;

  const update = useCallback(
    (fn: (s: FileTabsState) => FileTabsState) => {
      if (repoKey === null) return;
      const current = store.get()[repoKey] ?? EMPTY_FILE_TABS;
      setMap({ [repoKey]: fn(current) });
    },
    [repoKey, setMap],
  );

  const actions: FileTabsActions = {
    open: useCallback((path: string) => update((s) => openTab(s, path)), [update]),
    close: useCallback((path: string) => update((s) => closeTab(s, path)), [update]),
    closeOthers: useCallback((path: string) => update((s) => closeOtherTabs(s, path)), [update]),
    closeAll: useCallback(() => update(() => closeAllTabs()), [update]),
  };

  return [state, actions];
}
