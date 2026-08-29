export interface Env {
  DB: D1Database;
  DROP_REQUIRES_APPROVAL?: string;
  PRESENCE: DurableObjectNamespace;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

export function notFound(message = "Not found"): Response {
  return json({ error: message }, 404);
}

export function dropRequiresApproval(env: Env): boolean {
  return (env.DROP_REQUIRES_APPROVAL ?? "true").toLowerCase() !== "false";
}
