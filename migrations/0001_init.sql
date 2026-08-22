-- Managed Ops schema

CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);

CREATE TABLE creators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE managed_ops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  task_type TEXT NOT NULL,
  cadence_type TEXT NOT NULL,
  cadence_config TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'unclaimed' CHECK (status IN ('unclaimed','claimed','paused','cancelled')),
  claimed_by INTEGER REFERENCES creators(id),
  claimed_at TEXT,
  pending_drop_request INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE op_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  managed_op_id INTEGER NOT NULL REFERENCES managed_ops(id),
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','missed')),
  completed_at TEXT,
  completed_by INTEGER REFERENCES creators(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE claim_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  managed_op_id INTEGER NOT NULL REFERENCES managed_ops(id),
  creator_id INTEGER REFERENCES creators(id),
  action TEXT NOT NULL CHECK (action IN ('claimed','drop_requested','drop_approved','drop_rejected','cancelled')),
  note TEXT,
  resolved_by INTEGER REFERENCES creators(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_managed_ops_status ON managed_ops(status);
CREATE INDEX idx_managed_ops_claimed_by ON managed_ops(claimed_by);
CREATE INDEX idx_op_cycles_managed_op ON op_cycles(managed_op_id);
CREATE INDEX idx_op_cycles_status_due ON op_cycles(status, due_date);
CREATE INDEX idx_claim_events_op ON claim_events(managed_op_id);
