import * as v from "valibot";
import {
  type ClientEventMessage,
  ServerEventMessageSchema,
  type ServerEventMessage,
} from "@contract/events";

export type EventsSocketLocation = { protocol: string; host: string };

/** `location` から /ws/events の接続先 URL を組み立てる（termSocket.ts と同じ方式） */
export function buildEventsSocketUrl(loc: EventsSocketLocation): string {
  const wsProtocol = loc.protocol === "https:" ? "wss:" : "ws:";
  return new URL(`${wsProtocol}//${loc.host}/ws/events`).toString();
}

export type EventsSocketStatus = "connecting" | "open" | "reconnecting" | "closed";

export type EventsSocketOptions = {
  onMessage: (message: ServerEventMessage) => void;
  onStatus?: (status: EventsSocketStatus) => void;
  /** テスト用に差し替え可能な WebSocket 実装。既定は global `WebSocket`。 */
  WebSocketImpl?: typeof WebSocket;
  /** 再接続バックオフの初期値・上限（ms）。既定 500ms -> 10s。 */
  minBackoffMs?: number;
  maxBackoffMs?: number;
};

export type EventsSocketHandle = {
  send: (message: ClientEventMessage) => void;
  close: () => void;
};

/**
 * `/ws/events` に接続し、フレームを `ServerEventMessageSchema` で検証してから
 * `onMessage` に渡す。不正なフレームは console.warn して捨てる。
 * 切断時は指数バックオフ（500ms -> 10s 上限）で自動再接続する。
 */
export function connectEvents(
  loc: EventsSocketLocation,
  opts: EventsSocketOptions,
): EventsSocketHandle {
  const WebSocketImpl = opts.WebSocketImpl ?? WebSocket;
  const minBackoff = opts.minBackoffMs ?? 500;
  const maxBackoff = opts.maxBackoffMs ?? 10_000;

  let ws: WebSocket | null = null;
  let closed = false;
  let backoff = minBackoff;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let hasConnectedOnce = false;

  const setStatus = (status: EventsSocketStatus) => opts.onStatus?.(status);

  const scheduleReconnect = () => {
    if (closed) return;
    setStatus("reconnecting");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, backoff);
    backoff = Math.min(backoff * 2, maxBackoff);
  };

  const open = () => {
    if (closed) return;
    setStatus(hasConnectedOnce ? "reconnecting" : "connecting");
    const socket = new WebSocketImpl(buildEventsSocketUrl(loc));
    ws = socket;

    socket.addEventListener("open", () => {
      hasConnectedOnce = true;
      backoff = minBackoff;
      setStatus("open");
    });

    socket.addEventListener("message", (ev: MessageEvent<unknown>) => {
      const raw = ev.data;
      if (typeof raw !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        console.warn("eventsSocket: invalid JSON frame", raw);
        return;
      }
      const result = v.safeParse(ServerEventMessageSchema, parsed);
      if (!result.success) {
        console.warn("eventsSocket: dropping invalid frame", parsed, result.issues);
        return;
      }
      opts.onMessage(result.output);
    });

    socket.addEventListener("close", () => {
      if (ws === socket) ws = null;
      if (closed) return;
      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      // close も続けて発火するのでここでは何もしない
    });
  };

  open();

  return {
    send(message: ClientEventMessage) {
      if (!ws || ws.readyState !== WebSocketImpl.OPEN) return;
      ws.send(JSON.stringify(message));
    },
    close() {
      closed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      setStatus("closed");
      ws?.close();
      ws = null;
    },
  };
}
