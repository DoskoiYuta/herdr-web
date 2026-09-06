const FULL_ID_LENGTH = 36; // Bun.randomUUIDv7() の長さ（ハイフン込み）
const MIN_SHORT_ID_LENGTH = 4;

export type ShortIdResult<T> =
  | { kind: "found"; value: T }
  | { kind: "not_found" }
  | { kind: "ambiguous" };

/**
 * review/ask/decision で共通の id 解決規則: 完全な id（ハイフン込み UUIDv7、36 文字）か、
 * その末尾一致（4 文字以上）を受け付ける。UUIDv7 の先頭はタイムスタンプで揃うため、
 * 近い時刻に作られた id は先頭が揃ってしまう — 短縮 id は末尾側を使う。
 */
export async function resolveShortId<T>(
  id: string,
  ops: {
    getFull(id: string): Promise<T | null>;
    listCandidates(): Promise<T[]>;
    idOf(value: T): string;
  },
): Promise<ShortIdResult<T>> {
  if (id.length >= FULL_ID_LENGTH) {
    const value = await ops.getFull(id);
    return value ? { kind: "found", value } : { kind: "not_found" };
  }
  if (id.length < MIN_SHORT_ID_LENGTH) return { kind: "not_found" };

  const all = await ops.listCandidates();
  const matches = all.filter((value) => ops.idOf(value).endsWith(id));
  if (matches.length === 0) return { kind: "not_found" };
  if (matches.length > 1) return { kind: "ambiguous" };
  return { kind: "found", value: matches[0]! };
}
