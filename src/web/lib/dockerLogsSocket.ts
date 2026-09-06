import * as v from "valibot";
import { DockerLogsServerMessageSchema, type DockerLogsServerMessage } from "@contract/docker";

export type DockerLogsSocketLocation = { protocol: string; host: string };
export type DockerLogsSocketOptions = { root: string; id: string; tail?: number };

/** `location` から /ws/docker-logs の接続先 URL を組み立てる */
export function buildDockerLogsSocketUrl(
  loc: DockerLogsSocketLocation,
  opts: DockerLogsSocketOptions,
): string {
  const wsProtocol = loc.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${wsProtocol}//${loc.host}/ws/docker-logs`);
  url.searchParams.set("root", opts.root);
  url.searchParams.set("id", opts.id);
  if (opts.tail) url.searchParams.set("tail", String(opts.tail));
  return url.toString();
}

/** server -> client のテキストフレームを解釈する。不正な JSON / スキーマ不一致は undefined。 */
export function decodeDockerLogsMessage(raw: string): DockerLogsServerMessage | undefined {
  const parsed = safeJsonParse(raw);
  if (parsed === undefined) return undefined;
  const result = v.safeParse(DockerLogsServerMessageSchema, parsed);
  return result.success ? result.output : undefined;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export type DockerLogsSocketHandlers = {
  onMessage: (msg: DockerLogsServerMessage) => void;
  onClose: () => void;
};

/** 実際の WebSocket を張って /ws/docker-logs プロトコルの受信を配線する */
export function connectDockerLogsSocket(
  loc: DockerLogsSocketLocation,
  opts: DockerLogsSocketOptions,
  handlers: DockerLogsSocketHandlers,
): WebSocket {
  const ws = new WebSocket(buildDockerLogsSocketUrl(loc, opts));
  ws.addEventListener("message", (ev: MessageEvent<string>) => {
    const msg = decodeDockerLogsMessage(ev.data);
    if (msg) handlers.onMessage(msg);
  });
  ws.addEventListener("close", () => handlers.onClose());
  return ws;
}
