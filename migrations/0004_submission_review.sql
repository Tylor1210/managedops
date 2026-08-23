-- Completions now go through admin review before being finalized. Marking a
-- cycle "done" puts it in pending_review; an admin then approves it (final)
-- or rejects it, which sends it back to the creator's board flagged red.

ALTER TABLE op_cycles ADD COLUMN pending_review INTEGER NOT NULL DEFAULT 0;
ALTER TABLE op_cycles ADD COLUMN rejected INTEGER NOT NULL DEFAULT 0;

-- Widen claim_events to track submission review actions, and let an event
-- reference the specific cycle it's about (submission events are cycle-level,
-- unlike claim/drop events which are op-level). SQLite can't ALTER a CHECK
-- constraint in place, so the table is rebuilt.
CREATE TABLE claim_events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  managed_op_id INTEGER NOT NULL REFERENCES managed_ops(id),
  op_cycle_id INTEGER REFERENCES op_cycles(id),
  creator_id INTEGER REFERENCES creators(id),
  action TEXT NOT NULL CHECK (action IN (
    'claimed','drop_requested','drop_approved','drop_rejected','cancelled',
    'submitted','submission_approved','submission_rejected'
  )),
  note TEXT,
  resolved_by INTEGER REFERENCES creators(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO claim_events_new (id, managed_op_id, creator_id, action, note, resolved_by, resolved_at, created_at)
  SELECT id, managed_op_id, creator_id, action, note, resolved_by, resolved_at, created_at FROM claim_events;

DROP TABLE claim_events;
ALTER TABLE claim_events_new RENAME TO claim_events;
CREATE INDEX idx_claim_events_op ON claim_events(managed_op_id);
