import { json, badRequest, type Env } from "./_shared/http";
import { describeCadence, type CadenceType } from "./_shared/cadence";
import { runSafetyNet } from "./_shared/safetynet";

interface OpRow {
  id: number;
  taskType: string;
  cadenceType: CadenceType;
  cadenceConfig: string;
  clientId: number;
  clientName: string;
  [key: string]: unknown;
}

function withCadence<T extends { cadenceType: CadenceType; cadenceConfig: string; steps?: string }>(row: T) {
  return {
    ...row,
    cadenceConfig: JSON.parse(row.cadenceConfig || "{}"),
    cadenceDescription: describeCadence(row.cadenceType, JSON.parse(row.cadenceConfig || "{}")),
    steps: JSON.parse(row.steps || "[]"),
  };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const creatorId = Number(url.searchParams.get("creatorId"));
  if (!creatorId) return badRequest("creatorId is required");

  const clientFilter = url.searchParams.get("clientId");
  const clientId = clientFilter ? Number(clientFilter) : null;

  await runSafetyNet(env.DB);

  const requester = await env.DB.prepare(`SELECT is_admin FROM creators WHERE id = ?`).bind(creatorId).first<{ is_admin: number }>();
  const isAdmin = !!requester?.is_admin;

  // Admins see every creator's claimed work on the board; regular creators only see their own.
  const minePrepared = isAdmin
    ? env.DB.prepare(
        `SELECT mo.id, mo.task_type AS taskType, mo.cadence_type AS cadenceType, mo.cadence_config AS cadenceConfig,
                mo.description AS description, mo.steps AS steps,
                mo.claimed_at AS claimedAt, mo.pending_drop_request AS pendingDropRequest,
                c.id AS clientId, c.name AS clientName,
                cr.id AS creatorId, cr.name AS creatorName,
                (SELECT MIN(due_date) FROM op_cycles WHERE managed_op_id = mo.id AND status = 'pending') AS nextDueDate
         FROM managed_ops mo JOIN clients c ON c.id = mo.client_id JOIN creators cr ON cr.id = mo.claimed_by
         WHERE mo.status = 'claimed'
         ORDER BY nextDueDate ASC`
      )
    : env.DB.prepare(
        `SELECT mo.id, mo.task_type AS taskType, mo.cadence_type AS cadenceType, mo.cadence_config AS cadenceConfig,
                mo.description AS description, mo.steps AS steps,
                mo.claimed_at AS claimedAt, mo.pending_drop_request AS pendingDropRequest,
                c.id AS clientId, c.name AS clientName,
                (SELECT MIN(due_date) FROM op_cycles WHERE managed_op_id = mo.id AND status = 'pending') AS nextDueDate
         FROM managed_ops mo JOIN clients c ON c.id = mo.client_id
         WHERE mo.status = 'claimed' AND mo.claimed_by = ?
         ORDER BY nextDueDate ASC`
      ).bind(creatorId);

  const duePrepared = isAdmin
    ? env.DB.prepare(
        `SELECT oc.id AS cycleId, oc.due_date AS dueDate, oc.status AS cycleStatus,
                mo.id AS opId, mo.task_type AS taskType, mo.cadence_type AS cadenceType, mo.cadence_config AS cadenceConfig,
                mo.description AS description, mo.steps AS steps,
                c.id AS clientId, c.name AS clientName,
                cr.id AS creatorId, cr.name AS creatorName
         FROM op_cycles oc
         JOIN managed_ops mo ON mo.id = oc.managed_op_id
         JOIN clients c ON c.id = mo.client_id
         JOIN creators cr ON cr.id = mo.claimed_by
         WHERE oc.status IN ('pending','missed') AND oc.due_date <= date('now', 'weekday 0')
         ORDER BY oc.due_date ASC`
      )
    : env.DB.prepare(
        `SELECT oc.id AS cycleId, oc.due_date AS dueDate, oc.status AS cycleStatus,
                mo.id AS opId, mo.task_type AS taskType, mo.cadence_type AS cadenceType, mo.cadence_config AS cadenceConfig,
                mo.description AS description, mo.steps AS steps,
                c.id AS clientId, c.name AS clientName
         FROM op_cycles oc
         JOIN managed_ops mo ON mo.id = oc.managed_op_id
         JOIN clients c ON c.id = mo.client_id
         WHERE mo.claimed_by = ? AND oc.status IN ('pending','missed') AND oc.due_date <= date('now', 'weekday 0')
         ORDER BY oc.due_date ASC`
      ).bind(creatorId);

  const [unclaimed, mine, due, completed] = await Promise.all([
    env.DB.prepare(
      `SELECT mo.id, mo.task_type AS taskType, mo.cadence_type AS cadenceType, mo.cadence_config AS cadenceConfig,
              mo.description AS description, mo.steps AS steps,
              c.id AS clientId, c.name AS clientName
       FROM managed_ops mo JOIN clients c ON c.id = mo.client_id
       WHERE mo.status = 'unclaimed'
       ORDER BY c.name, mo.task_type`
    ).all<OpRow>(),

    minePrepared.all<OpRow>(),
    duePrepared.all<OpRow>(),

    env.DB.prepare(
      `SELECT oc.id AS cycleId, oc.due_date AS dueDate, oc.completed_at AS completedAt,
              mo.id AS opId, mo.task_type AS taskType,
              c.id AS clientId, c.name AS clientName
       FROM op_cycles oc
       JOIN managed_ops mo ON mo.id = oc.managed_op_id
       JOIN clients c ON c.id = mo.client_id
       WHERE oc.completed_by = ? AND oc.status = 'done'
         AND (? IS NULL OR c.id = ?)
       ORDER BY oc.completed_at DESC
       LIMIT 50`
    ).bind(creatorId, clientId, clientId).all(),
  ]);

  return json({
    unclaimed: (unclaimed.results ?? []).map(withCadence),
    mine: (mine.results ?? []).map(withCadence),
    due: (due.results ?? []).map(withCadence),
    completed: completed.results ?? [],
  });
};
