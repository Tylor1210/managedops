import { json, badRequest, notFound, type Env } from "../_shared/http";
import { describeCadence, type CadenceType } from "../_shared/cadence";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    `SELECT oc.id AS cycleId, oc.due_date AS dueDate, oc.completed_at AS submittedAt,
            mo.id AS opId, mo.task_type AS taskType, mo.cadence_type AS cadenceType, mo.cadence_config AS cadenceConfig,
            c.id AS clientId, c.name AS clientName,
            cr.id AS creatorId, cr.name AS creatorName
     FROM op_cycles oc
     JOIN managed_ops mo ON mo.id = oc.managed_op_id
     JOIN clients c ON c.id = mo.client_id
     JOIN creators cr ON cr.id = oc.completed_by
     WHERE oc.pending_review = 1
     ORDER BY oc.completed_at ASC`
  ).all<{ cadenceType: CadenceType; cadenceConfig: string; [k: string]: unknown }>();

  const rows = (results ?? []).map((r) => ({
    ...r,
    cadenceConfig: JSON.parse(r.cadenceConfig || "{}"),
    cadenceDescription: describeCadence(r.cadenceType, JSON.parse(r.cadenceConfig || "{}")),
  }));

  return json({ submissions: rows });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json<{ cycleId?: number; adminId?: number; decision?: "approve" | "reject"; note?: string }>();
  const cycleId = Number(body.cycleId);
  const adminId = Number(body.adminId);
  const decision = body.decision;
  const note = body.note?.trim() || null;
  if (!cycleId || !adminId || (decision !== "approve" && decision !== "reject")) {
    return badRequest("cycleId, adminId and decision ('approve'|'reject') are required");
  }

  const admin = await env.DB.prepare(`SELECT id, is_admin FROM creators WHERE id = ?`).bind(adminId).first<{ id: number; is_admin: number }>();
  if (!admin || !admin.is_admin) return badRequest("Only admins can review submissions");

  const cycle = await env.DB.prepare(`SELECT id, managed_op_id, completed_by, pending_review FROM op_cycles WHERE id = ?`)
    .bind(cycleId)
    .first<{ id: number; managed_op_id: number; completed_by: number | null; pending_review: number }>();
  if (!cycle) return notFound("Submission not found");
  if (!cycle.pending_review) return badRequest("This cycle has no pending submission");

  if (decision === "approve") {
    await env.DB.batch([
      env.DB.prepare(`UPDATE op_cycles SET status = 'done', pending_review = 0 WHERE id = ?`).bind(cycleId),
      env.DB.prepare(
        `INSERT INTO claim_events (managed_op_id, op_cycle_id, creator_id, action, note, resolved_by, resolved_at) VALUES (?, ?, ?, 'submission_approved', ?, ?, datetime('now'))`
      ).bind(cycle.managed_op_id, cycleId, cycle.completed_by, note, adminId),
    ]);
  } else {
    await env.DB.batch([
      env.DB.prepare(`UPDATE op_cycles SET pending_review = 0, rejected = 1, completed_at = NULL, completed_by = NULL WHERE id = ?`).bind(cycleId),
      env.DB.prepare(
        `INSERT INTO claim_events (managed_op_id, op_cycle_id, creator_id, action, note, resolved_by, resolved_at) VALUES (?, ?, ?, 'submission_rejected', ?, ?, datetime('now'))`
      ).bind(cycle.managed_op_id, cycleId, cycle.completed_by, note, adminId),
    ]);
  }

  return json({ ok: true });
};
