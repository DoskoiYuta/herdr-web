import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocketServer } from "ws";
import { createRejectedHostLogger, isAllowedRequest } from "../hostGuard";

export type UpgradeRouter = {
  /** pathname（クエリなし）にちょうど一致する upgrade リクエストを wss に振り分ける */
  add(pathname: string, wss: WebSocketServer): void;
};

/**
 * http.Server の "upgrade" イベントに対する小さなルーター。
 * `/ws/` 以外のパス（Vite の HMR WebSocket など）は関知せず素通しする
 * （socket を破棄しない）。`/ws/` 配下だが登録の無いパスと、DNS
 * リバインディング対策で許可されていない Host/Origin は破棄する。
 */
const DEFAULT_ALLOWED_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1"]);

export function createUpgradeRouter(
  server: Server,
  allowedHosts: ReadonlySet<string> = DEFAULT_ALLOWED_HOSTS,
): UpgradeRouter {
  const routes = new Map<string, WebSocketServer>();
  const logRejectedHost = createRejectedHostLogger();

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = safePathname(req.url);
    if (pathname === undefined || !pathname.startsWith("/ws/")) return;

    if (!isAllowedRequest({ host: req.headers.host, origin: req.headers.origin }, allowedHosts)) {
      logRejectedHost(req.headers.host);
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    const wss = routes.get(pathname);
    if (!wss) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  return {
    add(pathname, wss) {
      routes.set(pathname, wss);
    },
  };
}

function safePathname(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return undefined;
  }
}
