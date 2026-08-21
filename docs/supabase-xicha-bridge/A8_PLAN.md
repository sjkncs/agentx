# A8 Plan — Inngest Bridge + Webhooks

> Plan generated under the `vibe-coding-cn` skill (8-step workflow + machine gates).
> Self-audited against `karpathy-guidelines` (think-before-code, simplicity, surgical, goal-driven).

## 1. Scope

**In scope:**
- SQL gap-closing for channel routing + webhook inbox + 5 worker RPCs
- Node.js 20 worker polling `fsf_inngest_events` and dispatching per `event_name`
- `apps/api/src/webhooks/` ingoing routes for Inngest / DingTalk / generic
- `apps/api/server.ts` route mount (surgical, <15 LOC)
- Dockerfile + docker-compose for worker + optional Inngest

**Out of scope:**
- A9 cross-workflow event subscriptions
- A9.1 frontend Webhooks Inbox UI
- Real DingTalk corp_id / agent_id provisioning (still placeholders)

**Success criterion:**
A queued event in `fsf_inngest_events` is dispatched to a real endpoint (or dry-run log) within `poll_interval_ms * attempts`, recorded in `fsf_notification_deliveries`, and webhook callbacks land in `fsf_webhook_inbox` linking back to `fsf_work_orders.agent_notes`.

## 2. Context Read

Already inspected:
- `000_install_all_NO_PGRST.sql` — base datafoundry schema (10 tables)
- `003_food_safety_schema.sql` — 6 food-safety tables (compensation/script/SLA)
- `005_inngest_gate_rpcs.sql` — Inngest event facade (5 RPCs, queue table)
- `packages/harness-core/.../capability-brief.ts` — 8 harness surfaces (Goal/Subagent/Marketplace/Worktree/Gate/Hooks/Sandbox/Runtime)
- `apps/api/server.ts` — Node http + CopilotKit + auth + RBAC routes

## 3. Plan — Step / Verify

| # | Step | Verify Gate |
|---|---|---|
| 3.1 | SQL: routes + deliveries + inbox + 5 RPCs | `psql -c "SELECT count(*) FROM datafoundry.fsf_notification_routes"` ≥ 5 |
| 3.2 | TS: dispatchers split by event_name | `tsc --noEmit` returns 0 in `services/inngest-bridge` |
| 3.3 | TS: worker poll loop w/ SKIP LOCKED semantics | `node dist/verify-loop.js` outputs `[verify] PASS` |
| 3.4 | TS: webhooks HTTP handler (3 routes + verify) | Manual curl: `curl -X POST .../api/webhooks/dingtalk -d '{}'` returns 200 |
| 3.5 | Dockerfile multi-stage + nonroot + tini | `docker build -f docker/inngest-bridge/Dockerfile .` exits 0 |
| 3.6 | docker-compose.yml wires env to worker | `docker compose config` exits 0 |
| 3.7 | server.ts route mount (1 import + 12 LOC dispatch) | `tsc` in `apps/api` still 0 errors |
| 3.8 | verify SQL end-to-end | `006_verify_inngest_loop.sql` queue health: dispatched>0 |

## 4. Execute — Minimal Touch

Only touched files:
- `docs/supabase-xicha-bridge/006_inngest_callback_and_channel_routes.sql` (NEW, 220)
- `docs/supabase-xicha-bridge/006_verify_inngest_loop.sql` (NEW, 90)
- `docs/supabase-xicha-bridge/README_A8.md` (NEW, deliverable index)
- `services/inngest-bridge/**` (NEW, 6 files, 204 LOC total after simplify)
- `docker/inngest-bridge/{Dockerfile,build-local.sh}` (NEW)
- `services/docker-compose.yml` (NEW)
- `apps/api/src/webhooks/index.ts` (NEW, ~260 LOC)
- `apps/api/src/server.ts` (EDIT, 1 import + 12 LOC dispatch)

Did NOT modify: 005 SQL, base schema, harness-core, agent-runtime, supabase-bridge.

## 5. Gates Run (machine-enforced)

| Gate | Tool | Pass criterion |
|---|---|---|
| TypeScript compile | `tsc --noEmit` in services/inngest-bridge | exit 0 |
| Docker build | `docker build -f docker/inngest-bridge/Dockerfile .` | exit 0 |
| Worker self-check | `node dist/verify-loop.js` (DRY_RUN=true) | `[verify] PASS` |
| End-to-end SQL | `006_verify_inngest_loop.sql` (via Supabase SQL editor) | `dispatched > 0`, `deliveries > 0` after a real run |
| API smoke | `curl -X POST .../api/webhooks/inngest -d '{}'` | 200 `{ok:true}` |

(Steps 3.2-3.8 currently executed in code review mode; full run requires
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env.)

## 6. Diff Review

Run after Gate pass:
```bash
git diff main --stat
git diff main -- services/inngest-bridge apps/api/src/webhooks apps/api/src/server.ts
# Look for: secrets (.env, key tokens), tmp dirs (.npm, node_modules), long base64
```
Expected diff: ~1100 LOC addition, 0 deletion outside surgical touches.

## 7. Commit

Single semver-style commit:
```
feat(services): A8 inngest-bridge worker + apps/api webhooks

* datafoundry: 5 new tables (notification_routes/deliveries/webhook_inbox)
  + 5 RPCs (dispatch_one/mark_result/pick_route/record_delivery/ack_webhook)
* services/inngest-bridge: Node 20 worker with FOR UPDATE SKIP LOCKED
* apps/api: /api/webhooks/{inngest,dingtalk,generic,inbox} with HMAC verify
* docker/inngest-bridge: multi-stage build, tini, nonroot
* verify: 006_verify_inngest_loop.sql (9 checks)

Refs: datafoundry-A8
```

## 8. Sync Docs

- `docs/supabase-xicha-bridge/README_A8.md` — delivery doc ✅ written
- `A8_PLAN.md` (this file) — plan/verify record ✅ written
- Top-level `datafoundry-enhanced/docs/INDEX.md` — add A8 entry (next task, A8.7)
