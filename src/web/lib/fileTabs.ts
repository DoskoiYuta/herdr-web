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

/** 1 リポジトリのタブ数の上限。超えたら最も古い非アクティブなタブを落とす
 * （localStorage の肥大化と、タブバーの実用上の一覧性を両立させる値）。 */
export const MAX_TABS_PER_REPO = 50;

/** クリックのたびに 1 タブ増える（プレビュータブ方式は採らない）。既に開いて
 * いれば末尾に足さず、そのままアクティブにする。上限を超えたら、開いた順が
 * 最も古いタブを 1 つ落とす — 新しく開く（=これからアクティブになる）タブは
 * 末尾に追加されるため、この操作で落ちることはない。`isDirty` が与えられた
 * ときは、保存していない下書きを持つタブは（可能な限り）追い出し候補から
 * 除く — 未保存の編集を画面から見えなくして事実上気付けなくするのを避ける
 * ため。下書き自体は fileDrafts.ts 側に残るので、全タブが dirty で已む
 * なく追い出しても内容は失われない。 */
export function openTab(
  state: FileTabsState,
  path: string,
  isDirty: (path: string) => boolean = () => false,
): FileTabsState {
  if (state.paths.includes(path)) return { ...state, active: path };
  const paths = [...state.paths, path];
  if (paths.length > MAX_TABS_PER_REPO) {
    const existing = paths.slice(0, -1);
    const evictIdx = existing.findIndex((p) => !isDirty(p));
    paths.splice(evictIdx === -1 ? 0 : evictIdx, 1);
  }
  return { paths, active: path };
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

/** ドラッグ並べ替え（`arrayMove` 相当）。`active` は変えない — 並べ替え自体は
 * 選択を動かす操作ではない。範囲外の index はそのまま返す。 */
export function reorderTabs(state: FileTabsState, from: number, to: number): FileTabsState {
  if (from === to || from < 0 || to < 0 || from >= state.paths.length || to >= state.paths.length) {
    return state;
  }
  const paths = [...state.paths];
  const [moved] = paths.splice(from, 1);
  paths.splice(to, 0, moved as string);
  return { ...state, paths };
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
  open(path: string, isDirty?: (path: string) => boolean): void;
  close(path: string): void;
  closeOthers(path: string): void;
  closeAll(): void;
  reorder(from: number, to: number): void;
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
    open: useCallback(
      (path: string, isDirty?: (path: string) => boolean) =>
        update((s) => openTab(s, path, isDirty)),
      [update],
    ),
    close: useCallback((path: string) => update((s) => closeTab(s, path)), [update]),
    closeOthers: useCallback((path: string) => update((s) => closeOtherTabs(s, path)), [update]),
    closeAll: useCallback(() => update(() => closeAllTabs()), [update]),
    reorder: useCallback(
      (from: number, to: number) => update((s) => reorderTabs(s, from, to)),
      [update],
    ),
  };

  return [state, actions];
}
