// Files タブの編集下書き（`PUT /api/fs/file` で保存する前の状態）。
// `fileTabs.ts` と違い localStorage には入れない（下書きをタブ間で共有する
// ためだけの寿命でよく、リロードをまたいで残す必要はない）— メモリ上の
// モジュールストアに `useSyncExternalStore` で購読する。FilesPanel は
// ToolPane のタブ切替で unmount/remount され（`Tabs` は非アクティブな
// `TabsContent` の中身を破棄する）、worktree 切替でも `key={resolvedRoot}`
// で作り直される。下書きを FilesPanel のローカル state に置くと、その
// どちらでも未保存の編集が確認なしに消える。

import { useSyncExternalStore } from "react";

/** タブ列はリポジトリ単位で worktree を跨ぐが、下書きは worktree（`root`）
 * ごとに別に持つ必要があるため、path だけでは足りない。 */
export function draftKey(root: string, path: string): string {
  return `${root}\0${path}`;
}

export interface FileEditEntry {
  editing: boolean;
  baseHash: string;
  /** 常に LF 化して保持する（dirty 判定を改行コードに依存させない）。 */
  baseContents: string;
  /** ディスク上の実際の改行コード。保存時にこれへ揃え直す。 */
  eol: "lf" | "crlf";
  /** 常に LF 化して保持する。 */
  draft: string;
  saving: boolean;
  banner: { kind: "conflict" | "external"; diskHash: string } | null;
  /** エディタの文書を base/draft の内容で作り直す必要があるたびに増やす
   * （編集 ON・破棄して再読込・dirty でないときの外部追従）。pierre の
   * `Editor` は `contents` prop の差し替えだけでは内部の `TextDocument` を
   * 再構築しない（name/lang/cacheKey しか見ない）ため、この値を
   * `CodeFileView` の `key` に含めて React ごと作り直す。保存成功時は
   * draft の値自体が変わらないので増やさない。 */
  session: number;
}

export function isDirty(entry: FileEditEntry | undefined): boolean {
  return entry !== undefined && entry.editing && entry.draft !== entry.baseContents;
}

export function detectEol(contents: string): "lf" | "crlf" {
  return contents.includes("\r\n") ? "crlf" : "lf";
}

export function toLf(contents: string): string {
  return contents.includes("\r\n") ? contents.replace(/\r\n/g, "\n") : contents;
}

export function toEol(contents: string, eol: "lf" | "crlf"): string {
  return eol === "crlf" ? contents.replace(/\n/g, "\r\n") : contents;
}

export type FileEditsMap = Record<string, FileEditEntry>;

let state: FileEditsMap = {};
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function get(): FileEditsMap {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setEntry(key: string, entry: FileEditEntry): void {
  state = { ...state, [key]: entry };
  notify();
}

function patchEntry(key: string, patch: Partial<FileEditEntry>): void {
  const entry = state[key];
  if (!entry) return;
  state = { ...state, [key]: { ...entry, ...patch } };
  notify();
}

function removeEntry(key: string): void {
  if (!(key in state)) return;
  const next = { ...state };
  delete next[key];
  state = next;
  notify();
}

export function useFileEdits(): FileEditsMap {
  return useSyncExternalStore(subscribe, get, get);
}

export const fileEditsStore = { get, setEntry, patchEntry, removeEntry, subscribe };

/** Test-only: this is a module-level singleton by design (M2 — it must
 * survive the `FilesPanel` unmounts that a tab switch or worktree change
 * cause), so tests that open the same path across cases need to clear it
 * between them or leak state. */
export function resetFileEditsForTests(): void {
  state = {};
  notify();
}
