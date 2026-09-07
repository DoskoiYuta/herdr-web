import { WebSocketServer } from "ws";
import * as v from "valibot";
import { ClientEventMessageSchema, type ServerEventMessage } from "../../contract/events";
import type { EventHub } from "./broadcast";

export type EventsWssDeps = {
  hub: EventHub;
  onClientMessage: (message: v.InferOutput<typeof ClientEventMessageSchema>) => void;
  logger?: Pick<typeof console, "warn">;
};

/** `/ws/events`: サーバー → クライアントは hub のブロードキャスト、クライアント → サーバーは focus-pane。 */
export function createEventsWss(deps: EventsWssDeps): WebSocketServer {
  const { hub, onClientMessage, logger = console } = deps;
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (socket) => {
    const detach = hub.attach({
      send(message: ServerEventMessage) {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      },
    });
    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        logger.warn("events ws: non-JSON message ignored");
        return;
      }
      const parsed = v.safeParse(ClientEventMessageSchema, raw);
      if (!parsed.success) {
        logger.warn("events ws: invalid client message ignored");
        return;
      }
      onClientMessage(parsed.output);
    });
    socket.on("close", detach);
    socket.on("error", detach);
  });

  return wss;
}
