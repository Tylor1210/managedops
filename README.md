# Managed Ops

A Kanban-style board for **recurring** client-profile-update work — think
"Creator Ops," but for jobs that repeat on a cadence (daily, weekly, monthly,
every N days, or specific weekdays) instead of one-off tasks.

This is a demo build: no real authentication, just a role switcher that lets
you act as any seeded creator (one of whom is an admin) to walk through the
whole flow live.

## Stack

- **Cloudflare Pages** for hosting + **Pages Functions** (TypeScript) for the API
- **Cloudflare D1** (SQLite) for storage
- Plain HTML/CSS/JS frontend, no build step

## How it works

- **Claiming** an op claims all of its future occurrences. A creator claims
  a client's recurring task once — not every week. Each time an occurrence
  ("cycle") is submitted, the next one is generated automatically right away,
  anchored off the due date that was just submitted (not "today"), so a late
  completion doesn't shift the whole schedule forward — and so one slow
  review doesn't stall the whole cadence.
- **Submission review**: clicking "Submit" doesn't finalize a cycle — it puts
  it in the admin's Approvals queue (`Pending submissions`) with a note on
  whether it came in early/on-time or late. An admin **approves** it (final,
  now shows in the Submissions log) or **rejects** it, which sends the same
  cycle back to the creator's This week board flagged with a red "Rejected —
  redo" badge until they resubmit. A cycle awaiting review is hidden from
  This week (nothing to act on until it's decided).
- **Dropping** a claimed op is gated behind `DROP_REQUIRES_APPROVAL` (default
  `true` in `wrangler.toml`). When true, a drop request sits in the admin
  Approvals queue until approved or rejected. When false, drops release the
  op back to the pool immediately and just log the event (notify-only).
- **Safety net**: Pages Functions have no native scheduled/cron handler, so
  this runs defensively on every board load (`functions/api/board.ts` calls
  `runSafetyNet`, in `functions/api/_shared/safetynet.ts`) and is also
  exposed as `POST /api/cron/safety-net` so you can trigger it on demand
  during a demo. It flags any pending cycle more than 1 day past due as
  `missed` (never deleted) and backfills a fresh pending cycle for any
  claimed op that's missing one. In a real deployment, point a Cloudflare
  Cron Trigger at a small Worker that calls the same logic on a schedule.
- **Job details**: click any job card (unclaimed, mine, due, or an admin
  approval) to open it and read its SOP — a description of what needs to be
  done plus an ordered steps checklist. Admins can create new jobs (`+ New
  job` in the Unclaimed pool) or edit an existing job's description/steps at
  any time from the same detail view; neither field is required to save.
- **Priority**: jobs can be Normal / High / Urgent. Urgent jobs get a
  blinking red outline on their card everywhere they appear, so they're
  impossible to miss on the board.
- **Reassignment**: admins can move a claimed op to a different creator
  directly from its job detail view, without going through drop → approve →
  re-claim. The existing recurring schedule is untouched.
- **Bulk actions**: multi-select checkboxes + a floating action bar on the
  Unclaimed pool (bulk claim) and both Approvals panels (bulk approve/reject
  drop requests and submissions).
- **Live cursors**: every connected browser sees everyone else's mouse move
  in real time, each labeled with their acting-as name. This runs on a
  Durable Object in a separate Worker — see `presence-worker/README.md` for
  why, and how to deploy/run it.
- **Host app sidebar**: a left nav rail representing the existing product
  this feature would ship inside of ("Managed Ops" is the only live item;
  the rest are placeholders). Collapses to an off-canvas drawer on mobile.

## Data model

- `clients` — who the recurring work is for
- `creators` — who does the work (`is_admin` flags the admin role)
- `managed_ops` — one row per recurring job (client, task type, cadence,
  status, who claimed it, pending drop request flag, and an optional
  admin-authored description + ordered steps checklist — the job's SOP)
- `op_cycles` — one row per due occurrence of an op (due date, status,
  completion timestamp + who completed it, plus `pending_review` while a
  submission awaits admin decision and `rejected` if it was sent back)
- `claim_events` — audit log of claim/drop/submission/approve/reject actions,
  optionally tied to a specific cycle for submission-review events

## Project layout

```
functions/api/          Pages Functions (the API)
  _shared/               cadence math, D1 env types, safety-net logic
  board.ts                GET  /api/board?creatorId=
  bootstrap.ts             GET  /api/bootstrap
  ops/claim.ts             POST /api/ops/claim
  ops/drop.ts              POST /api/ops/drop
  ops/create.ts            POST /api/ops/create (admin-only)
  ops/details.ts           POST /api/ops/details (admin-only)
  ops/reassign.ts          POST /api/ops/reassign (admin-only)
  cycles/complete.ts       POST /api/cycles/complete
  admin/approvals.ts       GET/POST /api/admin/approvals (drop requests)
  admin/submission-approvals.ts  GET/POST /api/admin/submission-approvals
  admin/submissions.ts     GET  /api/admin/submissions (finalized log)
  cron/safety-net.ts       POST /api/cron/safety-net (manual trigger)
  presence.ts              GET  /api/presence (WebSocket, live cursors)
migrations/               D1 schema + demo seed data
public/                   Static frontend (index.html, styles.css, app.js)
presence-worker/          Standalone Worker hosting the live-cursor Durable
                           Object (Pages can't host its own DO) -- see its
                           own README for why and how to deploy it
```

## Setup

```bash
npm install
```

Create the D1 database and wire its id into `wrangler.toml`:

```bash
npx wrangler d1 create managed-ops-db
```

Copy the `database_id` from the output into the `[[d1_databases]]` block in
[`wrangler.toml`](wrangler.toml).

Apply migrations (schema + seed data):

```bash
npm run db:migrate:local    # for local dev
npm run db:migrate:remote   # for the live D1 database
```

Deploy the presence Worker (needed for live cursors) and it'll be picked up
by the `script_name` binding already in `wrangler.toml`:

```bash
cd presence-worker && wrangler deploy && cd ..
```

## Local development

```bash
npm run dev
```

This runs Pages Functions + the static frontend together via
`wrangler pages dev`, backed by your local D1 replica.

## Deploy

1. Push this repo to GitHub.
2. In the Cloudflare dashboard, create a Pages project connected to the repo
   (build output directory: `public`; no build command needed), **or** deploy
   directly from the CLI:

   ```bash
   npm run deploy
   ```
3. Bind the `DB` D1 database to the Pages project (Settings → Functions → D1
   database bindings) if it wasn't picked up automatically from
   `wrangler.toml`, and set the `DROP_REQUIRES_APPROVAL` environment variable
   if you want to flip it from the dashboard instead of the config file.
4. Run `npm run db:migrate:remote` (or apply migrations against the
   production database from the dashboard) before the first load.

## Demo script

Four seeded creators: **Tylor C.** and **Sam Okafor** and **Priya
Natarajan** are working creators, and **Admin** is a plain admin-only
account for the Approvals/Submissions views. The seed data is written with
relative dates, so it looks fresh no matter when you seed it:

- **Tylor C.** already has **Acme Corp** (daily "Client Profile Refresh")
  claimed, with two completed cycles in its history and one due today —
  submit it, then switch to **Admin** → **Approvals** → **Pending
  submissions** to approve or reject it. Reject it and switch back to
  Tylor C. to see it reappear on **This week** with a red "Rejected — redo"
  badge, ready to resubmit.
- **Evergreen Dental** (Sun/Tue/Thu) and **Harbor Fitness** (every 5 days)
  sit unclaimed in the pool — claim one to see a cycle get generated
  immediately.
- **Bluebird Media** (weekly, claimed by Sam Okafor) has two completed
  cycles in its history and one due today — submit it to watch the next
  cycle roll forward exactly 7 days (once approved, it lands in the
  Submissions log).
- **DriftCo** (every 3 days, claimed by Sam Okafor) seeds with a cycle 2
  days overdue — load the board and the safety net will have already
  flagged it `missed` and backfilled a fresh pending cycle.
- **Coastal Realty** (monthly, claimed by Priya Natarajan) seeds with a
  pending drop request — switch to **Admin** and open **Approvals** to
  approve or reject it.
- Switch to **Admin** and open **Submissions** to see every completed
  cycle across all creators, filterable by client/creator/date range and
  sortable — due date vs. completed-at makes late submissions easy to spot.
- Open the live URL in two browser windows side by side and move your
  mouse in one — the other shows a live, labeled cursor. Good closer for a
  demo.
