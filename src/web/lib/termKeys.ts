// herdr は起動時に kitty keyboard protocol（CSI > 7 u）を要求するが、xterm.js は
// この拡張を実装していないため Shift+Enter も Enter も "\r" になり、Claude Code では
// 改行ではなく送信になる。修飾キー付き Enter だけを CSI u 形式で送る。

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
