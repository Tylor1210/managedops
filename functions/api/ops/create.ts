import { json, badRequest, type Env } from "../_shared/http";
import { describeCadence, type CadenceType, type CadenceConfig } from "../_shared/cadence";

const VALID_CADENCE_TYPES: CadenceType[] = ["daily", "weekly", "monthly", "every_n_days", "custom_weekdays"];

function sanitizeSteps(steps: unknown): string[] {
  if (!Array.isArray(steps)) return [];
  return steps.map((s) => String(s).trim()).filter(Boolean).slice(0, 20);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json<{
    adminId?: number;
    clientId?: number;
    taskType?: string;
    cadenceType?: CadenceType;
    cadenceConfig?: CadenceConfig;
    description?: string;
    steps?: string[];
  }>();

  const adminId = Number(body.adminId);
  const clientId = Number(body.clientId);
  const taskType = body.taskType?.trim();
  const cadenceType = body.cadenceType;

  if (!adminId || !clientId || !taskType || !cadenceType) {
    return badRequest("adminId, clientId, taskType and cadenceType are required");
  }
  if (!VALID_CADENCE_TYPES.includes(cadenceType)) {
    return badRequest(`Unknown cadence type: ${cadenceType}`);
  }

  const admin = await env.DB.prepare(`SELECT id, is_admin FROM creators WHERE id = ?`).bind(adminId).first<{ id: number; is_admin: number }>();
  if (!admin || !admin.is_admin) return badRequest("Only admins can create jobs");

  const client = await env.DB.prepare(`SELECT id FROM clients WHERE id = ?`).bind(clientId).first();
  if (!client) return badRequest("Unknown client");

  let cadenceConfig: CadenceConfig = {};
  if (cadenceType === "every_n_days") {
    const interval = Math.max(1, Number(body.cadenceConfig?.interval) || 1);
    cadenceConfig = { interval };
  } else if (cadenceType === "custom_weekdays") {
    const weekdays = Array.isArray(body.cadenceConfig?.weekdays)
      ? body.cadenceConfig!.weekdays!.map(Number).filter((d) => d >= 0 && d <= 6)
      : [];
    if (!weekdays.length) return badRequest("Pick at least one weekday for a custom-weekday cadence");
    cadenceConfig = { weekdays: [...new Set(weekdays)].sort((a, b) => a - b) };
  }

  const description = body.description?.trim() || null;
  const steps = JSON.stringify(sanitizeSteps(body.steps));

  const result = await env.DB.prepare(
    `INSERT INTO managed_ops (client_id, task_type, cadence_type, cadence_config, status, description, steps)
     VALUES (?, ?, ?, ?, 'unclaimed', ?, ?)`
  )
    .bind(clientId, taskType, cadenceType, JSON.stringify(cadenceConfig), description, steps)
    .run();

  return json({
    ok: true,
    opId: result.meta.last_row_id,
    cadenceDescription: describeCadence(cadenceType, cadenceConfig),
  });
};
