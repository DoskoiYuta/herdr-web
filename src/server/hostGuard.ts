/**
 * DNS リバインディング対策: ブラウザが送る `Host` / `Origin` ヘッダを検査する。
 * 攻撃者のページが DNS を `127.0.0.1` 等に切り替えて同一オリジン扱いで
 * `/api/*` `/ws/*` を叩くのを防ぐ（ブラウザは切り替え後も `Host` に
 * 攻撃者のドメイン名を送るため、ここで弾ける）。
 */

const ANY_ADDRESS_HOSTS = new Set(["0.0.0.0", "::"]);

export function buildAllowedHosts(config: {
  host: string;
  allowedHosts: readonly string[];
}): Set<string> {
  const hosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!ANY_ADDRESS_HOSTS.has(config.host)) hosts.add(config.host.toLowerCase());
  for (const h of config.allowedHosts) hosts.add(h.toLowerCase());
  return hosts;
}

/** `Host` ヘッダからホスト名だけを取り出す（ポート除去、`[::1]:8080` の
 * 角括弧付き IPv6 に対応）。小文字化して返す。解釈できなければ null。 */
function extractHostname(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const trimmed = hostHeader.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end === -1) return null;
    const host = trimmed.slice(1, end);
    return host.length > 0 ? host.toLowerCase() : null;
  }

  const colonCount = (trimmed.match(/:/g) ?? []).length;
  if (colonCount > 1) return null; // 角括弧無しの bare IPv6 はポート境界が曖昧なので不正扱い
  const host = trimmed.split(":")[0];
  return host && host.length > 0 ? host.toLowerCase() : null;
}

export function isAllowedHost(
  hostHeader: string | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  const hostname = extractHostname(hostHeader);
  return hostname !== null && allowed.has(hostname);
}

function isAllowedOrigin(originHeader: string, allowed: ReadonlySet<string>): boolean {
  if (originHeader === "null") return false;
  try {
    return allowed.has(new URL(originHeader).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export type GuardedHeaders = { host: string | undefined; origin?: string };

/** `Host` を検査し、`Origin` が付いていればそのホストも同じ許可集合で検査する。 */
export function isAllowedRequest(headers: GuardedHeaders, allowed: ReadonlySet<string>): boolean {
  if (!isAllowedHost(headers.host, allowed)) return false;
  if (headers.origin !== undefined && !isAllowedOrigin(headers.origin, allowed)) return false;
  return true;
}

/** 拒否したホストごとに 1 回だけ warn する（同じホストからの連打でログを埋めない）。 */
export function createRejectedHostLogger(warn: (msg: string) => void = console.warn) {
  const seen = new Set<string>();
  return (hostHeader: string | undefined) => {
    const key = hostHeader ?? "(missing)";
    if (seen.has(key)) return;
    seen.add(key);
    warn(
      `herdr-web: Host "${key}" を許可されていないため拒否しました。tailnet 等からのアクセスなら config.json の allowedHosts に追加してください。`,
    );
  };
}
