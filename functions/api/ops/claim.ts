import { json, badRequest, notFound, type Env } from "../_shared/http";
import { firstDueDate, type CadenceType, type CadenceConfig } from "../_shared/cadence";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json<{ opId?: number; creatorId?: number }>();
  const opId = Number(body.opId);
  const creatorId = Number(body.creatorId);
  if (!opId || !creatorId) return badRequest("opId and creatorId are required");

  const op = await env.DB.prepare(`SELECT id, status, cadence_type, cadence_config FROM managed_ops WHERE id = ?`)
    .bind(opId)
    .first<{ id: number; status: string; cadence_type: CadenceType; cadence_config: string }>();
  if (!op) return notFound("Op not found");
  if (op.status !== "unclaimed") return badRequest(`Op is ${op.status}, not available to claim`);

  const creator = await env.DB.prepare(`SELECT id FROM creators WHERE id = ?`).bind(creatorId).first();
  if (!creator) return notFound("Creator not found");

  const config: CadenceConfig = JSON.parse(op.cadence_config || "{}");
  const dueDate = firstDueDate(op.cadence_type, config);

  await env.DB.batch([
    env.DB.prepare(`UPDATE managed_ops SET status = 'claimed', claimed_by = ?, claimed_at = datetime('now'), pending_drop_request = 0 WHERE id = ?`).bind(creatorId, opId),
    env.DB.prepare(`INSERT INTO op_cycles (managed_op_id, due_date, status) VALUES (?, ?, 'pending')`).bind(opId, dueDate),
    env.DB.prepare(`INSERT INTO claim_events (managed_op_id, creator_id, action) VALUES (?, ?, 'claimed')`).bind(opId, creatorId),
  ]);

  return json({ ok: true });
};
