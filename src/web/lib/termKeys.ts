// herdr は起動時に kitty keyboard protocol（CSI > 7 u）を要求するが、xterm.js は
// この拡張を実装していないため Shift+Enter も Enter も "\r" になり、Claude Code では
// 改行ではなく送信になる。修飾キー付き Enter だけを CSI u 形式で送る。

import { type Keybind, parseKeybind } from "../../contract/keybind";

/** config.json の `terminal.keybinds` を照合用にコンパイルしたもの。 */
export type CompiledKeybinds = { spec: Keybind; value: string }[];

/** 毎キー入力での再パースを避けるため、config 変更時に 1 度だけ呼ぶ。 */
export function compileKeybinds(binds: Record<string, string>): CompiledKeybinds {
  const compiled: CompiledKeybinds = [];
  for (const [spec, value] of Object.entries(binds)) {
    const parsed = parseKeybind(spec);
    if (parsed) compiled.push({ spec: parsed, value });
  }
  return compiled;
}

/**
 * config.json の `terminal.keybinds`（README「設定」参照）と一致するキー入力
 * があれば送信する文字列を返す。既定は Ghostty 風に Shift+←→ を readline の
 * 単語移動（`ESC b` / `ESC f`）へ変換する設定になっている（サーバー側の既定値）。
 */
export function matchKeybind(
  binds: CompiledKeybinds,
  e: {
    type: string;
    key: string;
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    isComposing?: boolean;
  },
): string | null {
  if (e.type !== "keydown" || e.isComposing) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  for (const { spec, value } of binds) {
    if (
      spec.key === key &&
      spec.mods.shift === e.shiftKey &&
      spec.mods.alt === e.altKey &&
      spec.mods.ctrl === e.ctrlKey &&
      spec.mods.meta === e.metaKey
    ) {
      return value;
    }
  }
  return null;
}

/** kitty keyboard protocol の修飾子ビット + 1 */
function kittyModifier(e: {
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): number {
  let m = 0;
  if (e.shiftKey) m |= 1;
  if (e.altKey) m |= 2;
  if (e.ctrlKey) m |= 4;
  if (e.metaKey) m |= 8;
  return m + 1;
}

/**
 * 修飾キー付き Enter を CSI u（`ESC [ 13 ; <mod> u`）に変換する。対象外なら null。
 * Enter 単体・IME 変換中の Enter はそのまま xterm に任せる。
 */
export function encodeModifiedEnter(e: {
  type: string;
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
}): string | null {
  if (e.type !== "keydown" || e.key !== "Enter" || e.isComposing) return null;
  if (!(e.shiftKey || e.altKey || e.ctrlKey || e.metaKey)) return null;
  return `\x1b[13;${kittyModifier(e)}u`;
}

/**
 * D7: Terminal / Tool の最大化トグル（⌘⇧M / Ctrl+Shift+M）。xterm にフォーカスが
 * あっても効くよう、Terminal の `attachCustomKeyEventHandler` からもこれで判定する
 * （`RESERVED_KEYS` の仕組みはブラウザ既定動作を止めるだけで、herdr-web 側の
 * ショートカットは扱わないため別関数にする）。
 */
export function isMaximizeToggleKey(e: {
  type: string;
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  if (e.type !== "keydown") return false;
  if (e.key.toLowerCase() !== "m") return false;
  if (!e.shiftKey) return false;
  return e.metaKey || e.ctrlKey;
}

/**
 * Inbox ダイアログの開閉（⌘I / Ctrl+I）。`isMaximizeToggleKey` と同じ作りで、
 * xterm にフォーカスがあっても `attachCustomKeyEventHandler` から判定できる。
 */
export function isInboxToggleKey(e: {
  type: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  if (e.type !== "keydown") return false;
  if (e.key.toLowerCase() !== "i") return false;
  return e.metaKey || e.ctrlKey;
}
