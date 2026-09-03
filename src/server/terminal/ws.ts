import type { IncomingMessage } from "node:http";
import * as v from "valibot";
import { WebSocket, WebSocketServer } from "ws";
import { TermExitMessageSchema, TermResizeMessageSchema } from "../../contract/term";
import type { SpawnedTerminal, SpawnHerdrOptions } from "./pty";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export type CreateTermWssOptions = {
  spawn: (opts: SpawnHerdrOptions) => SpawnedTerminal;
  logger?: Pick<typeof console, "info" | "warn">;
};

/**
 * `/ws/term` の PTY attach プロトコル（plan.md §9.1）を実装した WebSocketServer を返す。
 * 接続ごとに 1 PTY を spawn し、切断時に kill、PTY 終了時に "exit" を送って close する。
 */
export function createTermWss(opts: CreateTermWssOptions): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const logger = opts.logger ?? console;

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const query = new URL(req.url ?? "/", "http://localhost").searchParams;
    const session = query.get("session") ?? undefined;
    const cols = parsePositiveInt(query.get("cols")) ?? DEFAULT_COLS;
    const rows = parsePositiveInt(query.get("rows")) ?? DEFAULT_ROWS;

    const term = opts.spawn({ session, cols, rows });
    logger.info(`term: spawn session=${session ?? "-"} cols=${cols} rows=${rows}`);

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    term.onExit((event) => {
      logger.warn(`term: exit session=${session ?? "-"} code=${event.exitCode}`);
      const msg = v.parse(TermExitMessageSchema, { type: "exit", code: event.exitCode });
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
        ws.close();
      }
    });

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        term.write(new Uint8Array(data as Buffer));
        return;
      }
      const parsed = safeJsonParse(data.toString());
      if (parsed === undefined) return;
      const result = v.safeParse(TermResizeMessageSchema, parsed);
      if (!result.success) return;
      term.resize(result.output.cols, result.output.rows);
    });

    ws.on("close", () => {
      term.kill();
    });
  });

  return wss;
}

function parsePositiveInt(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
