// Standalone Worker hosting the live-cursor presence room. Cloudflare Pages
// projects cannot define their own Durable Object classes, so this lives in
// its own Worker and gets bound into the managed-ops Pages project via a
// cross-script `durable_objects` binding (see ../wrangler.toml there).

export interface Env {
  PRESENCE: DurableObjectNamespace<PresenceRoom>;
}

interface CursorAttachment {
  id: string;
  name: string;
  color: string;
}

export class PresenceRoom implements DurableObject {
  state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }

    const url = new URL(request.url);
    const id = url.searchParams.get("id") || crypto.randomUUID();
    const name = (url.searchParams.get("name") || "Someone").slice(0, 40);
    const color = url.searchParams.get("color") || "#0d6e63";

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    server.serializeAttachment({ id, name, color } satisfies CursorAttachment);
    this.state.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    let payload: { type?: string; xPct?: number; yPct?: number };
    try {
      payload = JSON.parse(message);
    } catch {
      return;
    }
    if (payload.type !== "cursor" || typeof payload.xPct !== "number" || typeof payload.yPct !== "number") return;

    const attachment = ws.deserializeAttachment() as CursorAttachment | null;
    if (!attachment) return;

    const out = JSON.stringify({
      type: "cursor",
      id: attachment.id,
      name: attachment.name,
      color: attachment.color,
      xPct: Math.max(0, Math.min(1, payload.xPct)),
      yPct: Math.max(0, Math.min(1, payload.yPct)),
    });

    for (const other of this.state.getWebSockets()) {
      if (other === ws) continue;
      try {
        other.send(out);
      } catch {
        // ignore sends to sockets that are mid-close
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as CursorAttachment | null;
    if (!attachment) return;
    const out = JSON.stringify({ type: "leave", id: attachment.id });
    for (const other of this.state.getWebSockets()) {
      if (other === ws) continue;
      try {
        other.send(out);
      } catch {
        // ignore
      }
    }
  }

  async webSocketError(): Promise<void> {
    // Hibernation API closes the socket for us; nothing else to do here.
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // One shared room for the whole demo -- everyone sees everyone's cursor.
    const stub = env.PRESENCE.getByName("global");
    return stub.fetch(request);
  },
};
