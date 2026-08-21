# A9 Plan — Event Subscriptions + Webhooks Inbox UI

> Generated under the `vibe-coding-cn` 8-step workflow.
> Self-audited against `karpathy-guidelines`.

## 1. Scope

**In scope:**
- `fsf_event_subscriptions` 表 + 4 RPCs（create / list / enable / pause）
- Worker subscribe loop：轮询 queued 事件，对匹配订阅的事件拷贝到投递队列
- `/admin/webhooks` 前端页面：列出 subscriptions + inbox（含失败重发）
- `admin-home.tsx` 加 tab slot

**Out of scope:**
- 钉钉 corp_id / agent_id 真实凭据（仍 DEMO）
- 邮件 SMTP 真实发（demo 仅记日志）
- 多用户订阅（只做 workspace 级）

**Success criterion:**
A user creates a subscription "send notification when event_name='compensation.generate'" → inserts a queued event into `fsf_inngest_events` → within `poll_interval_ms*attempts` worker copies it to `fsf_subscription_deliveries` with status='pending' → frontend `/admin/webhooks` lists it under "Subscriptions" with re-send button.

## 2. Context Read

- `fsf_inngest_events` — (event_id, event_name, source, payload, status, attempts, last_error, dispatched_at)
- `fsf_work_orders` — primary food-safety entity (22 cols)
- `fsf_notification_routes` / `fsf_notification_deliveries` (from A8)
- `fsf_webhook_inbox` / `rpc_inngest_ack_webhook` (from A8)
- `apps/web/src/app/admin/{alerts,metrics,users,members,audit}/page.tsx` — pattern: thin page → `<AdminHome initialTab="x">`
- `apps/web/src/app/admin/admin-*-panel.tsx` — actual panels

## 3. Plan — Step / Verify

| # | Step | Verify Gate |
|---|---|---|
| 3.1 | SQL: `fsf_event_subscriptions` + `fsf_subscription_deliveries` + 4 RPCs | `psql` SELECT count(*) ≥ 3 seed rows |
| 3.2 | Worker: add `subscribe_loop.ts` w/ FOR UPDATE SKIP LOCKED + poll_subs_rpc | `tsc --noEmit` exit 0 in services/inngest-bridge |
| 3.3 | Worker: integrate into `worker.ts` as 2nd poll loop (or new sub-process) | `tsc` build dist 22+ files; verify-loop.js still PASS |
| 3.4 | Frontend page.tsx | `tsc --noEmit` in apps/web exit 0 |
| 3.5 | Frontend admin-webhooks-panel.tsx | tailwind 0 class names from `@/components` |
| 3.6 | Frontend admin-home tab slot | grep `webhooks` appears in admin-home.tsx |
| 3.7 | SQL verify: 9-step end-to-end | `007_verify_event_subscriptions.sql` shows deliveries>0 |
| 3.8 | README_A9.md + final commit | diff stat shows only A9 files |

## 4. Execute — minimal touch

Only:
- 2 new SQL files (`007_event_subscriptions.sql`, `007_verify_event_subscriptions.sql`)
- 1 new TS worker file (`subscribe_loop.ts`)
- 1 new TS panel + 1 page
- 1 surgical edit in `admin-home.tsx` (add webhooks tab)
- 1 new README
- 1 new PLAN

Do NOT modify: existing SQL (`005`, `006`), existing RPCs, server.ts, harness-core, datalink.

## 5. Gates (machine-enforced)

- `tsc --noEmit` in services/inngest-bridge → 0
- `tsc --noEmit` in apps/web → 0
- `tsc` build dist in services/inngest-bridge → 22+ files
- `node dist/verify-loop.js` → loads without import errors (env-missing fail-fast OK)
- `git diff --stat` shows only A9 paths
- SQL verify: queries return non-error responses

## 6. Diff Review

Inspect for: temp files, secrets (.env), unrelated edits, `}` `{{}}` template literals (parser killers).

## 7. Commit

Single semantic commit:
```
feat(supabase-xicha-bridge): A9 event subscriptions + webhooks inbox UI

* datafoundry.fsf_event_subscriptions: workspace-scoped rule (event_name + filter + target_channel)
* datafoundry.fsf_subscription_deliveries: copy of fsf_inngest_events with re-send state
* rpc_create/list/enable/pause_subscription
* services/inngest-bridge/src/subscribe_loop.ts: 2nd poll loop (poll_subscriptions_for_event)
* apps/web/src/app/admin/webhooks/: page + panel + admin-home tab
* 007_verify_event_subscriptions.sql: 9-check end-to-end

Refs: datafoundry-A9
```

## 8. Sync Docs

- `A9_PLAN.md` (this file)
- `README_A9.md` (delivery index, V-gate table, karpathy self-audit)