import { json, badRequest, notFound, type Env } from "../_shared/http";

// Admin moves a claimed op from one creator to another directly, without
// going through the drop/approve/re-claim cycle. The recurring schedule
// (existing op_cycles) is untouched -- only who's responsible changes.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json<{ opId?: number; adminId?: number; newCreatorId?: number }>();
  const opId = Number(body.opId);
  const adminId = Number(body.adminId);
  const newCreatorId = Number(body.newCreatorId);
  if (!opId || !adminId || !newCreatorId) return badRequest("opId, adminId and newCreatorId are required");

  const admin = await env.DB.prepare(`SELECT id, is_admin FROM creators WHERE id = ?`).bind(adminId).first<{ id: number; is_admin: number }>();
  if (!admin || !admin.is_admin) return badRequest("Only admins can reassign ops");

  const op = await env.DB.prepare(`SELECT id, status, claimed_by FROM managed_ops WHERE id = ?`)
    .bind(opId)
    .first<{ id: number; status: string; claimed_by: number | null }>();
  if (!op) return notFound("Op not found");
  if (op.status !== "claimed") return badRequest("Only a claimed op can be reassigned");

  const newCreator = await env.DB.prepare(`SELECT id, name FROM creators WHERE id = ?`).bind(newCreatorId).first<{ id: number; name: string }>();
  if (!newCreator) return notFound("Unknown creator");

  if (op.claimed_by === newCreatorId) return json({ ok: true });

  const oldCreator = op.claimed_by
    ? await env.DB.prepare(`SELECT name FROM creators WHERE id = ?`).bind(op.claimed_by).first<{ name: string }>()
    : null;

  await env.DB.batch([
    env.DB.prepare(`UPDATE managed_ops SET claimed_by = ?, pending_drop_request = 0 WHERE id = ?`).bind(newCreatorId, opId),
    env.DB.prepare(`INSERT INTO claim_events (managed_op_id, creator_id, action, note, resolved_by, resolved_at) VALUES (?, ?, 'claimed', ?, ?, datetime('now'))`).bind(
      opId,
      newCreatorId,
      `Reassigned by admin${oldCreator ? ` from ${oldCreator.name}` : ""}.`,
      adminId
    ),
  ]);

  return json({ ok: true });
};
