import { type Env } from "./_shared/http";

// Forwards the WebSocket upgrade to the shared presence room (a Durable
// Object living in the separate presence-worker/ project -- see
// wrangler.toml for the cross-script binding). Cloudflare Pages can't host
// its own Durable Object, so this is just a thin proxy.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const id = env.PRESENCE.idFromName("global");
  const stub = env.PRESENCE.get(id);
  return stub.fetch(request);
};
