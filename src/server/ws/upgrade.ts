import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocketServer } from "ws";

export type UpgradeRouter = {
  /** pathname（クエリなし）にちょうど一致する upgrade リクエストを wss に振り分ける */
  add(pathname: string, wss: WebSocketServer): void;
};

/**
 * http.Server の "upgrade" イベントに対する小さなルーター。
 * `/ws/` 以外のパス（Vite の HMR WebSocket など）は関知せず素通しする
 * （socket を破棄しない）。`/ws/` 配下だが登録の無いパスだけ破棄する。
 */
export function createUpgradeRouter(server: Server): UpgradeRouter {
  const routes = new Map<string, WebSocketServer>();

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = safePathname(req.url);
    if (pathname === undefined || !pathname.startsWith("/ws/")) return;

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
