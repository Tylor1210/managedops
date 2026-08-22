import { json, badRequest, notFound, dropRequiresApproval, type Env } from "../_shared/http";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json<{ opId?: number; creatorId?: number; note?: string }>();
  const opId = Number(body.opId);
  const creatorId = Number(body.creatorId);
  const note = body.note?.trim() || null;
  if (!opId || !creatorId) return badRequest("opId and creatorId are required");

  const op = await env.DB.prepare(`SELECT id, status, claimed_by, pending_drop_request FROM managed_ops WHERE id = ?`)
    .bind(opId)
    .first<{ id: number; status: string; claimed_by: number | null; pending_drop_request: number }>();
  if (!op) return notFound("Op not found");
  if (op.status !== "claimed" || op.claimed_by !== creatorId) return badRequest("You don't have this op claimed");
  if (op.pending_drop_request) return badRequest("A drop request is already pending for this op");

  if (dropRequiresApproval(env)) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE managed_ops SET pending_drop_request = 1 WHERE id = ?`).bind(opId),
      env.DB.prepare(`INSERT INTO claim_events (managed_op_id, creator_id, action, note) VALUES (?, ?, 'drop_requested', ?)`).bind(opId, creatorId, note),
    ]);
    return json({ ok: true, status: "pending_approval" });
  }

  // Notify-only path: release immediately, clear the now-stale open cycle so a
  // future claim doesn't collide with it, and still log the event for the audit trail.
  await env.DB.batch([
    env.DB.prepare(`UPDATE managed_ops SET status = 'unclaimed', claimed_by = NULL, claimed_at = NULL, pending_drop_request = 0 WHERE id = ?`).bind(opId),
    env.DB.prepare(`DELETE FROM op_cycles WHERE managed_op_id = ? AND status = 'pending'`).bind(opId),
    env.DB.prepare(`INSERT INTO claim_events (managed_op_id, creator_id, action, note) VALUES (?, ?, 'drop_requested', ?)`).bind(opId, creatorId, note),
  ]);
  return json({ ok: true, status: "released" });
};
