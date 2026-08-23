import { json, badRequest, notFound, type Env } from "../_shared/http";

function sanitizeSteps(steps: unknown): string[] {
  if (!Array.isArray(steps)) return [];
  return steps.map((s) => String(s).trim()).filter(Boolean).slice(0, 20);
}

// Admin-authored SOP for a job: description of what needs to be done, plus
// an optional ordered checklist of steps. Neither is required.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json<{ opId?: number; adminId?: number; description?: string; steps?: string[] }>();
  const opId = Number(body.opId);
  const adminId = Number(body.adminId);
  if (!opId || !adminId) return badRequest("opId and adminId are required");

  const admin = await env.DB.prepare(`SELECT id, is_admin FROM creators WHERE id = ?`).bind(adminId).first<{ id: number; is_admin: number }>();
  if (!admin || !admin.is_admin) return badRequest("Only admins can edit job details");

  const op = await env.DB.prepare(`SELECT id FROM managed_ops WHERE id = ?`).bind(opId).first();
  if (!op) return notFound("Op not found");

  const description = body.description?.trim() || null;
  const steps = JSON.stringify(sanitizeSteps(body.steps));

  await env.DB.prepare(`UPDATE managed_ops SET description = ?, steps = ? WHERE id = ?`).bind(description, steps, opId).run();

  return json({ ok: true });
};
