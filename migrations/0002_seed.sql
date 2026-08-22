-- Demo seed data. Uses relative dates so the board looks "live" whenever it's seeded.

INSERT INTO clients (name) VALUES
  ('Acme Corp'),
  ('Bluebird Media'),
  ('Coastal Realty'),
  ('DriftCo'),
  ('Evergreen Dental');

INSERT INTO creators (name, email, is_admin) VALUES
  ('Jamie Rivera', 'jamie@managedops.demo', 1),
  ('Sam Okafor', 'sam@managedops.demo', 0),
  ('Priya Natarajan', 'priya@managedops.demo', 0);

-- 1: Acme Corp / daily / unclaimed
INSERT INTO managed_ops (client_id, task_type, cadence_type, cadence_config, status) VALUES
  (1, 'Client Profile Refresh', 'daily', '{}', 'unclaimed');

-- 2: Bluebird Media / weekly / claimed by Sam, with completed history
INSERT INTO managed_ops (client_id, task_type, cadence_type, cadence_config, status, claimed_by, claimed_at) VALUES
  (2, 'Social Listing Sync', 'weekly', '{}', 'claimed', 2, datetime('now', '-21 days'));

-- 3: Coastal Realty / monthly / claimed by Priya, pending drop request (admin approvals demo)
INSERT INTO managed_ops (client_id, task_type, cadence_type, cadence_config, status, claimed_by, claimed_at, pending_drop_request) VALUES
  (3, 'Directory Content Audit', 'monthly', '{}', 'claimed', 3, datetime('now', '-40 days'), 1);

-- 4: DriftCo / every 3 days / claimed by Sam, overdue cycle (safety-net demo)
INSERT INTO managed_ops (client_id, task_type, cadence_type, cadence_config, status, claimed_by, claimed_at) VALUES
  (4, 'Inventory Update', 'every_n_days', '{"interval":3}', 'claimed', 2, datetime('now', '-10 days'));

-- 5: Evergreen Dental / custom weekdays (Sun/Tue/Thu) / unclaimed
INSERT INTO managed_ops (client_id, task_type, cadence_type, cadence_config, status) VALUES
  (5, 'Review Response Management', 'custom_weekdays', '{"weekdays":[0,2,4]}', 'unclaimed');

-- Op 2 (Bluebird, weekly): two completed cycles + one open pending cycle due today
INSERT INTO op_cycles (managed_op_id, due_date, status, completed_at, completed_by) VALUES
  (2, date('now', '-14 days'), 'done', datetime('now', '-14 days', '+2 hours'), 2),
  (2, date('now', '-7 days'), 'done', datetime('now', '-7 days', '+3 hours'), 2);
INSERT INTO op_cycles (managed_op_id, due_date, status) VALUES
  (2, date('now'), 'pending');

-- Op 3 (Coastal, monthly): one completed cycle + one open pending cycle a few weeks out
INSERT INTO op_cycles (managed_op_id, due_date, status, completed_at, completed_by) VALUES
  (3, date('now', '-10 days'), 'done', datetime('now', '-10 days', '+1 hours'), 3);
INSERT INTO op_cycles (managed_op_id, due_date, status) VALUES
  (3, date('now', '+20 days'), 'pending');

-- Op 4 (DriftCo, every 3 days): one completed cycle + one cycle 2 days overdue
-- (left as status='pending' on purpose -- the safety-net job flags it 'missed' and
-- backfills a fresh pending cycle the first time the board loads)
INSERT INTO op_cycles (managed_op_id, due_date, status, completed_at, completed_by) VALUES
  (4, date('now', '-5 days'), 'done', datetime('now', '-5 days', '+4 hours'), 2);
INSERT INTO op_cycles (managed_op_id, due_date, status) VALUES
  (4, date('now', '-2 days'), 'pending');

-- Audit log
INSERT INTO claim_events (managed_op_id, creator_id, action, created_at) VALUES
  (2, 2, 'claimed', datetime('now', '-21 days')),
  (3, 3, 'claimed', datetime('now', '-40 days')),
  (4, 2, 'claimed', datetime('now', '-10 days'));

INSERT INTO claim_events (managed_op_id, creator_id, action, note, created_at) VALUES
  (3, 3, 'drop_requested', 'Client relationship winding down, reassigning workload before offboarding.', datetime('now', '-1 days'));
