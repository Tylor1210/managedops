import { nextDueDate, firstDueDate, todayStr, type CadenceType, type CadenceConfig } from "./cadence";

/**
 * Daily/cron-style safety net (see functions/api/cron/safety-net.ts for the
 * manually-triggerable endpoint; a real deployment would wire this to a
 * separate Cron Triggers Worker since Pages Functions have no scheduled
 * handler). Run defensively on every board load so the demo self-heals even
 * without the cron endpoint ever being called.
 *
 * 1. Flags pending cycles more than 1 day past due as "missed" (kept, not deleted).
 * 2. Backfills a fresh pending cycle for any claimed op that has none open.
 */
export async function runSafetyNet(db: D1Database): Promise<void> {
  const today = todayStr();

  await db
    .prepare(`UPDATE op_cycles SET status = 'missed' WHERE status = 'pending' AND pending_review = 0 AND due_date < date(?, '-1 day')`)
    .bind(today)
    .run();

  const { results: opsNeedingCycles } = await db
    .prepare(
      `SELECT mo.id, mo.cadence_type, mo.cadence_config
       FROM managed_ops mo
       WHERE mo.status = 'claimed'
         AND NOT EXISTS (
           SELECT 1 FROM op_cycles oc WHERE oc.managed_op_id = mo.id AND oc.status = 'pending'
         )`
    )
    .all<{ id: number; cadence_type: CadenceType; cadence_config: string }>();

  for (const op of opsNeedingCycles ?? []) {
    const config: CadenceConfig = JSON.parse(op.cadence_config || "{}");
    const last = await db
      .prepare(`SELECT due_date FROM op_cycles WHERE managed_op_id = ? ORDER BY due_date DESC LIMIT 1`)
      .bind(op.id)
      .first<{ due_date: string }>();

    const dueDate = last ? nextDueDate(op.cadence_type, config, last.due_date) : firstDueDate(op.cadence_type, config, today);

    await db
      .prepare(`INSERT INTO op_cycles (managed_op_id, due_date, status) VALUES (?, ?, 'pending')`)
      .bind(op.id, dueDate)
      .run();
  }
}
