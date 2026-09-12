export type Keybind = {
  mods: { shift: boolean; alt: boolean; ctrl: boolean; meta: boolean };
  key: string;
};

/** KeyboardEvent.key の表記に合わせた特殊キー名。 */
const SPECIAL_KEYS: Record<string, string> = {
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  tab: "Tab",
  enter: "Enter",
  escape: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  insert: "Insert",
  space: " ",
};

/** Ghostty の別名。ここで正準名 (shift/alt/ctrl/meta) へ寄せる。 */
const MOD_ALIASES: Record<string, keyof Keybind["mods"]> = {
  shift: "shift",
  alt: "alt",
  opt: "alt",
  option: "alt",
  ctrl: "ctrl",
  meta: "meta",
  cmd: "meta",
  super: "meta",
};

function parseKey(token: string): string | null {
  const lower = token.toLowerCase();
  if (lower in SPECIAL_KEYS) return SPECIAL_KEYS[lower]!;
  if (/^f([1-9]|1[0-2])$/.test(lower)) return `F${lower.slice(1)}`;
  if (token.length === 1) return lower;
  return null;
}

/**
 * Ghostty 風の `[mod+]...key` 書式をパースする。mod は shift/alt/ctrl/meta
 * （opt・option→alt、cmd・super→meta のエイリアス込み）、key は矢印や
 * ファンクションキーなどの特殊名、または英数字・記号 1 文字。
 * 不正な書式（未知の mod、key が無い/複数文字、末尾が key でない等）は null。
 */
export function parseKeybind(spec: string): Keybind | null {
  if (spec.length === 0) return null;
  const parts = spec.split("+");
  if (parts.some((p) => p.length === 0)) return null;

  const keyToken = parts[parts.length - 1]!;
  const key = parseKey(keyToken);
  if (key === null) return null;

  const mods: Keybind["mods"] = { shift: false, alt: false, ctrl: false, meta: false };
  for (const token of parts.slice(0, -1)) {
    const mod = MOD_ALIASES[token.toLowerCase()];
    if (!mod) return null;
    mods[mod] = true;
  }

  return { mods, key };
}
