# managed-ops-presence

A tiny standalone Worker hosting the Durable Object that powers live cursor
tracking on the Managed Ops board. It exists as its own Worker because
Cloudflare Pages projects cannot define/export their own Durable Object
classes — Cloudflare requires the class to live in a separate Worker, which
is then bound into the Pages project by name.

## What it does

`PresenceRoom` is a single shared Durable Object ("global") that every
connected browser tab joins over a WebSocket. Each tab sends its own
mouse position (as a fraction of its viewport, `{xPct, yPct}`, 0–1) on
`mousemove`; the room re-broadcasts that to every other connected tab,
which renders it as a small labeled cursor. On disconnect, a `leave`
message tells other tabs to remove that cursor.

No state is persisted — cursor positions are purely ephemeral and don't
survive the Durable Object hibernating/evicting between messages, which is
fine for this use case.

## Deploy

```bash
cd presence-worker
npm install -g wrangler   # if you don't already have it
wrangler deploy
```

This deploys a Worker named `managed-ops-presence`. The main project's
`wrangler.toml` (one level up) binds to it by name:

```toml
[[durable_objects.bindings]]
name = "PRESENCE"
class_name = "PresenceRoom"
script_name = "managed-ops-presence"
```

If you rename this Worker, update `script_name` in the main project's
`wrangler.toml` to match, then redeploy the Pages project so it picks up
the binding.

## Local development

Run this Worker with `wrangler dev` in one terminal, then run the main
project's `wrangler pages dev` in another — Wrangler's `--do` flag lets a
local Pages dev session attach to an external Worker's Durable Object:

```bash
# terminal 1, from presence-worker/
wrangler dev

# terminal 2, from the project root
wrangler pages dev --do PRESENCE=PresenceRoom@managed-ops-presence
```
