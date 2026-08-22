import { json, badRequest, notFound, type Env } from "../_shared/http";
import { describeCadence, type CadenceType } from "../_shared/cadence";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    `SELECT mo.id AS opId, mo.task_type AS taskType, mo.cadence_type AS cadenceType, mo.cadence_config AS cadenceConfig,
            c.id AS clientId, c.name AS clientName,
            cr.id AS requestedById, cr.name AS requestedByName,
            ce.note, ce.created_at AS requestedAt
     FROM managed_ops mo
     JOIN clients c ON c.id = mo.client_id
     JOIN creators cr ON cr.id = mo.claimed_by
     JOIN claim_events ce ON ce.id = (
       SELECT id FROM claim_events
       WHERE managed_op_id = mo.id AND action = 'drop_requested'
       ORDER BY created_at DESC LIMIT 1
     )
     WHERE mo.pending_drop_request = 1
     ORDER BY ce.created_at ASC`
  ).all<{ cadenceType: CadenceType; cadenceConfig: string; [k: string]: unknown }>();

  const rows = (results ?? []).map((r) => ({
    ...r,
    cadenceConfig: JSON.parse(r.cadenceConfig || "{}"),
    cadenceDescription: describeCadence(r.cadenceType, JSON.parse(r.cadenceConfig || "{}")),
  }));

  return json({ approvals: rows });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json<{ opId?: number; adminId?: number; decision?: "approve" | "reject"; note?: string }>();
  const opId = Number(body.opId);
  const adminId = Number(body.adminId);
  const decision = body.decision;
  const note = body.note?.trim() || null;
  if (!opId || !adminId || (decision !== "approve" && decision !== "reject")) {
    return badRequest("opId, adminId and decision ('approve'|'reject') are required");
  }

  const admin = await env.DB.prepare(`SELECT id, is_admin FROM creators WHERE id = ?`).bind(adminId).first<{ id: number; is_admin: number }>();
  if (!admin || !admin.is_admin) return badRequest("Only admins can decide on drop requests");

  const op = await env.DB.prepare(`SELECT id, claimed_by, pending_drop_request FROM managed_ops WHERE id = ?`).bind(opId).first<{ id: number; claimed_by: number | null; pending_drop_request: number }>();
  if (!op) return notFound("Op not found");
  if (!op.pending_drop_request) return badRequest("This op has no pending drop request");

  if (decision === "approve") {
    await env.DB.batch([
      env.DB.prepare(`UPDATE managed_ops SET status = 'unclaimed', claimed_by = NULL, claimed_at = NULL, pending_drop_request = 0 WHERE id = ?`).bind(opId),
      env.DB.prepare(`DELETE FROM op_cycles WHERE managed_op_id = ? AND status = 'pending'`).bind(opId),
      env.DB.prepare(`INSERT INTO claim_events (managed_op_id, creator_id, action, note, resolved_by, resolved_at) VALUES (?, ?, 'drop_approved', ?, ?, datetime('now'))`).bind(opId, op.claimed_by, note, adminId),
    ]);
  } else {
    await env.DB.batch([
      env.DB.prepare(`UPDATE managed_ops SET pending_drop_request = 0 WHERE id = ?`).bind(opId),
      env.DB.prepare(`INSERT INTO claim_events (managed_op_id, creator_id, action, note, resolved_by, resolved_at) VALUES (?, ?, 'drop_rejected', ?, ?, datetime('now'))`).bind(opId, op.claimed_by, note, adminId),
    ]);
  }

  return json({ ok: true });
};
