import { json, badRequest, notFound, type Env } from "../_shared/http";
import { nextDueDate, type CadenceType, type CadenceConfig } from "../_shared/cadence";

// Marking a cycle "done" submits it for admin review -- it does not finalize
// immediately. The recurring schedule still advances right away (the next
// cycle is generated now, anchored off this cycle's due date) so one slow
// review doesn't stall the whole cadence; see admin/submission-approvals.ts
// for the approve/reject step that finalizes or reopens this cycle.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json<{ cycleId?: number; creatorId?: number }>();
  const cycleId = Number(body.cycleId);
  const creatorId = Number(body.creatorId);
  if (!cycleId || !creatorId) return badRequest("cycleId and creatorId are required");

  const cycle = await env.DB.prepare(
    `SELECT oc.id, oc.due_date, oc.status, oc.pending_review, mo.id AS op_id, mo.claimed_by, mo.cadence_type, mo.cadence_config
     FROM op_cycles oc JOIN managed_ops mo ON mo.id = oc.managed_op_id
     WHERE oc.id = ?`
  )
    .bind(cycleId)
    .first<{
      id: number;
      due_date: string;
      status: string;
      pending_review: number;
      op_id: number;
      claimed_by: number | null;
      cadence_type: CadenceType;
      cadence_config: string;
    }>();

  if (!cycle) return notFound("Cycle not found");
  if (cycle.claimed_by !== creatorId) return badRequest("This op isn't claimed by you");
  if (cycle.status === "done") return badRequest("Cycle is already marked done");
  if (cycle.pending_review) return badRequest("This submission is already awaiting review");

  const config: CadenceConfig = JSON.parse(cycle.cadence_config || "{}");
  const next = nextDueDate(cycle.cadence_type, config, cycle.due_date);

  await env.DB.batch([
    env.DB.prepare(`UPDATE op_cycles SET pending_review = 1, rejected = 0, completed_at = datetime('now'), completed_by = ? WHERE id = ?`).bind(
      creatorId,
      cycleId
    ),
    env.DB.prepare(`INSERT INTO op_cycles (managed_op_id, due_date, status) VALUES (?, ?, 'pending')`).bind(cycle.op_id, next),
    env.DB.prepare(`INSERT INTO claim_events (managed_op_id, op_cycle_id, creator_id, action) VALUES (?, ?, ?, 'submitted')`).bind(
      cycle.op_id,
      cycleId,
      creatorId
    ),
  ]);

  return json({ ok: true, status: "submitted", nextDueDate: next });
};
