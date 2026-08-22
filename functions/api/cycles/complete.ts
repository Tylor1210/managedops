import { json, badRequest, notFound, type Env } from "../_shared/http";
import { nextDueDate, type CadenceType, type CadenceConfig } from "../_shared/cadence";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json<{ cycleId?: number; creatorId?: number }>();
  const cycleId = Number(body.cycleId);
  const creatorId = Number(body.creatorId);
  if (!cycleId || !creatorId) return badRequest("cycleId and creatorId are required");

  const cycle = await env.DB.prepare(
    `SELECT oc.id, oc.due_date, oc.status, mo.id AS op_id, mo.claimed_by, mo.cadence_type, mo.cadence_config
     FROM op_cycles oc JOIN managed_ops mo ON mo.id = oc.managed_op_id
     WHERE oc.id = ?`
  )
    .bind(cycleId)
    .first<{ id: number; due_date: string; status: string; op_id: number; claimed_by: number | null; cadence_type: CadenceType; cadence_config: string }>();

  if (!cycle) return notFound("Cycle not found");
  if (cycle.claimed_by !== creatorId) return badRequest("This op isn't claimed by you");
  if (cycle.status === "done") return badRequest("Cycle is already marked done");

  const config: CadenceConfig = JSON.parse(cycle.cadence_config || "{}");
  const next = nextDueDate(cycle.cadence_type, config, cycle.due_date);

  await env.DB.batch([
    env.DB.prepare(`UPDATE op_cycles SET status = 'done', completed_at = datetime('now'), completed_by = ? WHERE id = ?`).bind(creatorId, cycleId),
    env.DB.prepare(`INSERT INTO op_cycles (managed_op_id, due_date, status) VALUES (?, ?, 'pending')`).bind(cycle.op_id, next),
  ]);

  return json({ ok: true, nextDueDate: next });
};
