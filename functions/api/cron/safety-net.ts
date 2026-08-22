import { json, type Env } from "../_shared/http";
import { runSafetyNet } from "../_shared/safetynet";

// Manually-triggerable version of the safety net for the demo (Pages Functions
// have no scheduled/cron handler). It also runs automatically on every board
// load — see functions/api/board.ts — but this endpoint lets the admin fire it
// on demand to show the "backfill + flag missed" behavior live.
export const onRequestPost: PagesFunction<Env> = async ({ env }) => {
  await runSafetyNet(env.DB);
  return json({ ok: true });
};
