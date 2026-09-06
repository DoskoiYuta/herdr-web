import * as net from "node:net";
import * as v from "valibot";
import {
  AgentPromptedResultSchema,
  AgentStartedResultSchema,
  HERDR_AGENT_PROMPT_ERROR_CODES,
  HERDR_SUBSCRIPTIONS,
  HerdrEventEnvelopeSchema,
  NotificationShownResultSchema,
  PaneInfoSchema,
  PaneLayoutSnapshotSchema,
  PaneListResultSchema,
  PaneReadResultSchema,
  PingResultSchema,
  SessionSnapshotSchema,
  WorkspaceCreatedResultSchema,
  WorkspaceInfoResultSchema,
  type HerdrEventEnvelope,
  type PaneInfo,
  type PaneLayoutSnapshot,
  type PingResult,
  type SessionSnapshot,
} from "../../contract/herdr";
import type { AgentPromptOutcome, HerdrGateway, HerdrStatus } from "./gateway";

export type Logger = Pick<typeof console, "error" | "warn" | "info">;

export interface HerdrSocketClientOptions {
  socketPath: string;
  logger?: Logger;
  /** Per-request timeout (ms), covering connect + response. Default 10s. */
  requestTimeoutMs?: number;
  /**
   * F7: `agent.prompt` can legitimately take much longer than other requests
   * (herdr waits out the prompt/send cycle before responding) — default 60s,
   * overriding `requestTimeoutMs` for that one method only.
   */
  agentPromptTimeoutMs?: number;
  /** Reconnect backoff for the subscribe connection: starts here, doubles, caps at `backoffMaxMs`. Default 500ms. */
  backoffInitialMs?: number;
  /** Default 10s. */
  backoffMaxMs?: number;
}

type WireError = { code: string; message: string };

class HerdrRequestError extends Error {
  code: string;
  constructor(body: WireError) {
    super(`herdr: ${body.code}: ${body.message}`);
    this.code = body.code;
  }
}

/** Frames NDJSON off a socket's `data` events, calling `onLine` per complete line. */
function ndjsonReader(onLine: (line: string) => void): (chunk: Buffer) => void {
  let buf = "";
  return (chunk: Buffer) => {
    buf += chunk.toString("utf8");
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.trim().length > 0) onLine(line);
    }
  };
}

/**
 * Real `HerdrGateway` over herdr's unix-domain-socket NDJSON API (protocol 20).
 *
 * herdr's socket transport is **one request per connection**: per the
 * socket-api docs ("Event subscriptions keep the connection open after the
 * initial response" — implying plain requests do not) and confirmed live
 * against a running herdr 0.8.2 (a `ping` request's connection receives its
 * response and is then closed by the server), every `request()` call here
 * opens a fresh ephemeral connection, writes one line, reads the matching
 * response, and lets the connection close. `events.subscribe` is the one
 * exception: a single long-lived connection dedicated to it (plan.md §10),
 * reconnected with exponential backoff (500ms -> 10s cap by default) when the
 * socket is missing or drops. On every (re)connect of that subscribe
 * connection we also run an ephemeral `ping` to record the protocol and emit
 * connectivity status (so status naturally goes false while herdr is down and
 * true again once both the socket and `ping` succeed, satisfying N4).
 */
export function createHerdrSocketClient(opts: HerdrSocketClientOptions): HerdrGateway {
  const logger = opts.logger ?? console;
  const requestTimeoutMs = opts.requestTimeoutMs ?? 10_000;
  const agentPromptTimeoutMs = opts.agentPromptTimeoutMs ?? 60_000;
  const backoffInitialMs = opts.backoffInitialMs ?? 500;
  const backoffMaxMs = opts.backoffMaxMs ?? 10_000;

  let status: HerdrStatus = { connected: false, protocol: null };
  const statusListeners = new Set<(s: HerdrStatus) => void>();
  const eventHandlers = new Set<(e: HerdrEventEnvelope) => void>();

  let closed = false;
  let nextId = 1;

  function setStatus(next: HerdrStatus): void {
    if (status.connected === next.connected && status.protocol === next.protocol) return;
    status = next;
    for (const cb of statusListeners) {
      try {
        cb(status);
      } catch (err) {
        logger.error("herdr status listener threw", err);
      }
    }
  }

  /** One ephemeral connection: write one request, resolve on the matching response, then it closes. */
  function request<T>(method: string, params: unknown, timeoutMs = requestTimeoutMs): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = `hw-${nextId++}`;
      const sock = net.createConnection(opts.socketPath);
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        sock.destroy();
        reject(new Error(`herdr: request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      function finish(fn: () => void): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
        sock.end();
      }

      sock.on("connect", () => {
        sock.write(JSON.stringify({ id, method, params }) + "\n");
      });
      sock.on(
        "data",
        ndjsonReader((line) => {
          let msg: unknown;
          try {
            msg = JSON.parse(line);
          } catch (err) {
            logger.error("herdr: malformed NDJSON response", err, line);
            return;
          }
          const obj = msg as { id?: string; result?: unknown; error?: WireError };
          if (obj.id !== id) return;
          finish(() => {
            if (obj.error) reject(new HerdrRequestError(obj.error));
            else resolve(obj.result as T);
          });
        }),
      );
      sock.on("error", (err) => {
        finish(() => reject(err));
      });
      sock.on("close", () => {
        finish(() => reject(new Error(`herdr: connection closed before a response to ${method}`)));
      });
    });
  }

  async function pingAndSetStatus(): Promise<void> {
    try {
      const raw = await request<unknown>("ping", {});
      const pong = v.parse(PingResultSchema, raw);
      if (!status.connected) {
        logger.info(`herdr: connected protocol=${pong.protocol}`);
      }
      // A real reconnect: allow the ENOENT warning to fire again on the next outage.
      warnedEnoentSinceConnect = false;
      setStatus({ connected: true, protocol: pong.protocol });
    } catch (err) {
      logger.warn("herdr: ping failed", err instanceof Error ? err.message : err);
      setStatus({ connected: false, protocol: null });
    }
  }

  // --- subscribe connection: the one persistent connection ---------------------------------------------------
  let subSocket: net.Socket | null = null;
  let subBackoff = backoffInitialMs;
  // Rate-limit the ENOENT "socket missing" warning to once per disconnect period, so a
  // long herdr outage doesn't spam logs once per backoff attempt. Reset on reconnect.
  let warnedEnoentSinceConnect = false;

  function connectSubscribeSocket(): void {
    if (closed) return;
    const sock = net.createConnection(opts.socketPath);
    subSocket = sock;
    sock.on("connect", () => {
      subBackoff = backoffInitialMs;
      // Ping (and its `connected` status flip) must complete before we send
      // events.subscribe: herdr replays a stale, out-of-order event buffer right
      // after the subscribe ack, and createHerdrState starts discarding that
      // replay on the status's false->true transition — sending them concurrently
      // could let replay events reach subscribers before status (and thus the
      // replay guard) has flipped on.
      void pingAndSetStatus().then(() => {
        if (subSocket !== sock) return; // superseded by a newer connection attempt
        const id = `hw-sub-${nextId++}`;
        sock.write(
          JSON.stringify({
            id,
            method: "events.subscribe",
            params: { subscriptions: HERDR_SUBSCRIPTIONS },
          }) + "\n",
        );
      });
    });
    sock.on(
      "data",
      ndjsonReader((line) => handleSubscribeLine(line)),
    );
    sock.on("error", (err) => {
      const isEnoent = (err as NodeJS.ErrnoException).code === "ENOENT";
      if (isEnoent) {
        if (warnedEnoentSinceConnect) return;
        warnedEnoentSinceConnect = true;
      }
      logger.warn("herdr: subscribe socket error", err.message);
    });
    sock.on("close", () => {
      subSocket = null;
      setStatus({ connected: false, protocol: null });
      if (!closed) {
        setTimeout(() => connectSubscribeSocket(), subBackoff);
        subBackoff = Math.min(subBackoff * 2, backoffMaxMs);
      }
    });
  }

  function handleSubscribeLine(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      logger.error("herdr: malformed NDJSON line on subscribe socket", err, line);
      return;
    }
    const obj = msg as {
      id?: string;
      result?: unknown;
      error?: WireError;
      event?: string;
      data?: unknown;
    };
    if (obj.error) {
      logger.error("herdr: events.subscribe rejected", obj.error);
      return;
    }
    if (obj.id) return; // the subscription_started ack; nothing to do
    const parsed = v.safeParse(HerdrEventEnvelopeSchema, obj);
    if (!parsed.success) {
      logger.warn("herdr: unrecognized event frame, ignoring", obj);
      return;
    }
    for (const handler of eventHandlers) {
      try {
        handler(parsed.output);
      } catch (err) {
        logger.error("herdr: event handler threw", err);
      }
    }
  }

  connectSubscribeSocket();

  return {
    async ping(): Promise<PingResult> {
      const raw = await request<unknown>("ping", {});
      return v.parse(PingResultSchema, raw);
    },
    async snapshot(): Promise<SessionSnapshot> {
      const raw = await request<{ snapshot: unknown }>("session.snapshot", {});
      return v.parse(SessionSnapshotSchema, raw.snapshot);
    },
    async paneGet(paneId: string): Promise<PaneInfo> {
      const raw = await request<{ pane: unknown }>("pane.get", { pane_id: paneId });
      return v.parse(PaneInfoSchema, raw.pane);
    },
    async paneFocus(paneId: string): Promise<PaneInfo> {
      const raw = await request<{ pane: unknown }>("pane.focus", { pane_id: paneId });
      return v.parse(PaneInfoSchema, raw.pane);
    },
    async workspaceFocus(workspaceId: string): Promise<void> {
      await request<unknown>("workspace.focus", { workspace_id: workspaceId });
    },
    async workspaceCreate(params: {
      cwd: string | null;
      label?: string | null;
      focus?: boolean;
      env?: Record<string, string>;
    }) {
      const raw = await request<unknown>("workspace.create", {
        cwd: params.cwd,
        label: params.label ?? null,
        focus: params.focus ?? false,
        env: params.env ?? undefined,
      });
      const parsed = v.parse(WorkspaceCreatedResultSchema, raw);
      return parsed.workspace;
    },
    async workspaceRename(workspaceId: string, label: string) {
      const raw = await request<unknown>("workspace.rename", {
        workspace_id: workspaceId,
        label,
      });
      const parsed = v.parse(WorkspaceInfoResultSchema, raw);
      return parsed.workspace;
    },
    async workspaceClose(workspaceId: string): Promise<void> {
      await request<unknown>("workspace.close", { workspace_id: workspaceId });
    },
    async agentPrompt(paneId: string, text: string): Promise<AgentPromptOutcome> {
      try {
        const raw = await request<unknown>(
          "agent.prompt",
          { target: paneId, text },
          agentPromptTimeoutMs,
        );
        const parsed = v.parse(AgentPromptedResultSchema, raw);
        return { status: "sent", agent: parsed.agent };
      } catch (err) {
        if (
          err instanceof HerdrRequestError &&
          (HERDR_AGENT_PROMPT_ERROR_CODES as readonly string[]).includes(err.code)
        ) {
          return { status: err.code as "agent_blocked" | "agent_prompt_stalled" };
        }
        throw err;
      }
    },
    async notificationShow(params: {
      title: string;
      body?: string | null;
      sound?: "none" | "done" | "request";
    }): Promise<void> {
      const raw = await request<unknown>("notification.show", {
        title: params.title,
        body: params.body ?? undefined,
        sound: params.sound ?? undefined,
      });
      v.parse(NotificationShownResultSchema, raw);
    },
    async agentStart(params: {
      name: string;
      kind: string;
      paneId: string;
      timeoutMs?: number;
      args?: string[];
    }): Promise<PaneInfo> {
      // herdr's own startup timeout (default 60s here) runs inside the request;
      // give the socket request itself a little headroom beyond that.
      const timeoutMs = params.timeoutMs ?? 60_000;
      const raw = await request<unknown>(
        "agent.start",
        {
          name: params.name,
          kind: params.kind,
          pane_id: params.paneId,
          timeout_ms: timeoutMs,
          args: params.args ?? [],
        },
        Math.max(requestTimeoutMs, timeoutMs + 5_000),
      );
      const parsed = v.parse(AgentStartedResultSchema, raw);
      return parsed.agent;
    },
    async paneList(workspaceId?: string | null): Promise<PaneInfo[]> {
      const raw = await request<unknown>("pane.list", { workspace_id: workspaceId ?? null });
      const parsed = v.parse(PaneListResultSchema, raw);
      return parsed.panes;
    },
    async paneLayout(paneId: string): Promise<PaneLayoutSnapshot> {
      const raw = await request<{ layout: unknown }>("pane.layout", { pane_id: paneId });
      return v.parse(PaneLayoutSnapshotSchema, raw.layout);
    },
    async paneRead(paneId: string, lines: number): Promise<string> {
      const raw = await request<{ read: unknown }>("pane.read", {
        pane_id: paneId,
        source: "recent",
        format: "text",
        strip_ansi: true,
        lines,
      });
      const parsed = v.parse(PaneReadResultSchema, raw.read);
      return parsed.text;
    },
    subscribe(handler: (event: HerdrEventEnvelope) => void): () => void {
      eventHandlers.add(handler);
      return () => eventHandlers.delete(handler);
    },
    status(): HerdrStatus {
      return status;
    },
    onStatus(cb: (status: HerdrStatus) => void): () => void {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    close(): void {
      closed = true;
      subSocket?.destroy();
      statusListeners.clear();
      eventHandlers.clear();
    },
  };
}
