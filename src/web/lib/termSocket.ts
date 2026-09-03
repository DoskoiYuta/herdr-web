import * as v from "valibot";
import { TermServerMessageSchema } from "@contract/term";

export type TermSocketLocation = { protocol: string; host: string };
export type TermSocketOptions = { session?: string; cols?: number; rows?: number };

/** `location` から /ws/term の接続先 URL を組み立てる */
export function buildTermSocketUrl(loc: TermSocketLocation, opts: TermSocketOptions = {}): string {
  const wsProtocol = loc.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${wsProtocol}//${loc.host}/ws/term`);
  if (opts.session) url.searchParams.set("session", opts.session);
  if (opts.cols) url.searchParams.set("cols", String(opts.cols));
  if (opts.rows) url.searchParams.set("rows", String(opts.rows));
  return url.toString();
}

/** client -> server の resize テキストフレーム */
export function encodeResizeMessage(cols: number, rows: number): string {
  return JSON.stringify({ type: "resize", cols, rows });
}

/** client -> server の入力バイナリフレーム */
export function encodeInput(data: string): Uint8Array {
  return new TextEncoder().encode(data);
}

export type TermServerFrame = { kind: "output"; data: Uint8Array } | { kind: "exit"; code: number };

/** server -> client のフレーム（バイナリ = 出力 / テキスト = exit）を解釈する */
export function decodeServerFrame(
  data: ArrayBuffer | Uint8Array | string,
): TermServerFrame | undefined {
  if (typeof data === "string") {
    const parsed = safeJsonParse(data);
    if (parsed === undefined) return undefined;
    const result = v.safeParse(TermServerMessageSchema, parsed);
    if (!result.success) return undefined;
    return { kind: "exit", code: result.output.code };
  }
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return { kind: "output", data: bytes };
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export type TermSocketHandlers = {
  onOpen?: () => void;
  onOutput: (data: Uint8Array) => void;
  onExit: (code: number) => void;
  onClose: () => void;
};

/** 実際の WebSocket を張って /ws/term プロトコルの受信を配線する */
export function connectTermSocket(
  loc: TermSocketLocation,
  opts: TermSocketOptions,
  handlers: TermSocketHandlers,
): WebSocket {
  const ws = new WebSocket(buildTermSocketUrl(loc, opts));
  ws.binaryType = "arraybuffer";
  ws.addEventListener("open", () => handlers.onOpen?.());
  ws.addEventListener("message", (ev: MessageEvent<ArrayBuffer | string>) => {
    const frame = decodeServerFrame(ev.data);
    if (!frame) return;
    if (frame.kind === "output") handlers.onOutput(frame.data);
    else handlers.onExit(frame.code);
  });
  ws.addEventListener("close", () => handlers.onClose());
  return ws;
}

export function sendInput(ws: WebSocket, data: string): void {
  const bytes = encodeInput(data);
  ws.send(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

export function sendResize(ws: WebSocket, cols: number, rows: number): void {
  ws.send(encodeResizeMessage(cols, rows));
}
