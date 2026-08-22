import { json, type Env } from "../_shared/http";
import { describeCadence, type CadenceType } from "../_shared/cadence";

const SORT_COLUMNS: Record<string, string> = {
  dueDate: "oc.due_date",
  completedAt: "oc.completed_at",
  client: "c.name",
  creator: "cr.name",
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId");
  const creatorId = url.searchParams.get("creatorId");
  const from = url.searchParams.get("from"); // YYYY-MM-DD, inclusive, matched against completed_at
  const to = url.searchParams.get("to"); // YYYY-MM-DD, inclusive
  const sortBy = SORT_COLUMNS[url.searchParams.get("sortBy") ?? ""] ?? "oc.completed_at";
  const sortDir = url.searchParams.get("sortDir") === "asc" ? "ASC" : "DESC";

  const { results } = await env.DB.prepare(
    `SELECT oc.id AS cycleId, oc.due_date AS dueDate, oc.completed_at AS completedAt,
            mo.id AS opId, mo.task_type AS taskType, mo.cadence_type AS cadenceType, mo.cadence_config AS cadenceConfig,
            c.id AS clientId, c.name AS clientName,
            cr.id AS creatorId, cr.name AS creatorName
     FROM op_cycles oc
     JOIN managed_ops mo ON mo.id = oc.managed_op_id
     JOIN clients c ON c.id = mo.client_id
     JOIN creators cr ON cr.id = oc.completed_by
     WHERE oc.status = 'done'
       AND (? IS NULL OR c.id = ?)
       AND (? IS NULL OR cr.id = ?)
       AND (? IS NULL OR date(oc.completed_at) >= ?)
       AND (? IS NULL OR date(oc.completed_at) <= ?)
     ORDER BY ${sortBy} ${sortDir}`
  )
    .bind(clientId, clientId, creatorId, creatorId, from, from, to, to)
    .all<{ cadenceType: CadenceType; cadenceConfig: string; [k: string]: unknown }>();

  const rows = (results ?? []).map((r) => ({
    ...r,
    cadenceConfig: JSON.parse(r.cadenceConfig || "{}"),
    cadenceDescription: describeCadence(r.cadenceType, JSON.parse(r.cadenceConfig || "{}")),
  }));

  return json({ submissions: rows });
};
