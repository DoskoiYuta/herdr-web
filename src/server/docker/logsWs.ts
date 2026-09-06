import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { DockerLogsErrorCode, DockerLogsServerMessage } from "../../contract/docker";
import { isAllowedRoot, pathExists } from "../routes/allowed-roots";
import type { DockerCache } from "./cache";
import { lookupContainer } from "./containerLookup";
import type { DockerLogsProcess, SpawnDockerLogs } from "./logsSpawn";
import { resolveRoots } from "./roots";

const DEFAULT_TAIL = 200;
const MAX_TAIL = 5000;

export interface CreateDockerLogsWssOptions {
  allowedRoots: string[];
  /** Shared with `GET /api/docker/containers` so both reuse the same TTL/single-flight `docker ps`. */
  cache: DockerCache;
  spawn: SpawnDockerLogs;
  logger?: Pick<typeof console, "warn">;
}

/** Clamps to [1, MAX_TAIL], falling back to DEFAULT_TAIL for anything that
 * doesn't parse as a positive integer. */
function parseTail(raw: string | null): number {
  if (raw === null) return DEFAULT_TAIL;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_TAIL;
  return Math.min(n, MAX_TAIL);
}

/** Buffers chunks until a newline so a line split across two `data` events
 * (a chunk boundary mid-line) still arrives as one message. */
function createLineSplitter(onLine: (line: string) => void) {
  let buffer = "";
  return (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      onLine(buffer.slice(0, idx).replace(/\r$/, ""));
      buffer = buffer.slice(idx + 1);
    }
  };
}

/**
 * `/ws/docker-logs` (plan.md §9.y): streams `docker logs --follow` for one
 * container, verifying on connect that `id` belongs to `root` via the same
 * F11-2 classification as `GET /api/docker/containers` — without it, a
 * valid `root` alone would let a client read any container's logs.
 */
export function createDockerLogsWss(opts: CreateDockerLogsWssOptions): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const logger = opts.logger ?? console;

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    handleConnection(ws, req, opts).catch((err) => {
      logger.warn("docker-logs: connection handler failed", err);
      if (ws.readyState === WebSocket.OPEN) ws.close();
    });
  });

  return wss;
}

function send(ws: WebSocket, msg: DockerLogsServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function sendErrorAndClose(ws: WebSocket, code: DockerLogsErrorCode, message: string): void {
  send(ws, { type: "error", code, message });
  if (ws.readyState === WebSocket.OPEN) ws.close();
}

async function handleConnection(
  ws: WebSocket,
  req: IncomingMessage,
  opts: CreateDockerLogsWssOptions,
): Promise<void> {
  const query = new URL(req.url ?? "/", "http://localhost").searchParams;
  const root = query.get("root") ?? "";
  const id = query.get("id") ?? "";
  const tail = parseTail(query.get("tail"));

  if (!(await isAllowedRoot(root, opts.allowedRoots))) {
    const code = (await pathExists(root)) ? "forbidden" : "not-found";
    sendErrorAndClose(ws, code, `root is ${code}`);
    return;
  }

  const roots = await resolveRoots(root);
  const lookup = await lookupContainer({ cache: opts.cache, roots, id });
  if (!lookup.ok) {
    sendErrorAndClose(
      ws,
      "docker-unavailable",
      "docker ps failed while checking container ownership",
    );
    return;
  }
  if (!lookup.found) {
    sendErrorAndClose(ws, "forbidden", "id is not a container tied to root");
    return;
  }

  // The client may have disconnected while the checks above were in flight.
  if (ws.readyState !== WebSocket.OPEN) return;

  let child: DockerLogsProcess;
  try {
    child = opts.spawn({ id, tail });
  } catch (err) {
    sendErrorAndClose(ws, "failed", err instanceof Error ? err.message : String(err));
    return;
  }

  const emitStdoutLine = createLineSplitter((text) =>
    send(ws, { type: "line", stream: "stdout", text }),
  );
  const emitStderrLine = createLineSplitter((text) =>
    send(ws, { type: "line", stream: "stderr", text }),
  );
  child.onStdout(emitStdoutLine);
  child.onStderr(emitStderrLine);

  child.onError((err) => {
    const code: DockerLogsErrorCode = err.code === "ENOENT" ? "docker-unavailable" : "failed";
    sendErrorAndClose(ws, code, err.message);
  });

  child.onExit((event) => {
    send(ws, { type: "exit", code: event.code ?? -1 });
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });

  ws.on("close", () => {
    child.kill();
  });
}
