# A10 Plan — Workspace Events + Real DingTalk + Event Sources

> vibe-coding-cn 8-step workflow + karpathy-guidelines self-audit.

## 1. Scope

**In scope:**
- A10.1: Cross-workspace subscriptions (`rpc_subscription_poll_match` 参数化 workspace_id; `rpc_subscription_list_deliveries` 读当前 workspace)
- A10.2: UI 向导（admin-webhooks-panel 加 Create Subscription form + event-name 常量枚举）
- A10.3: 真实钉钉签名（HMAC-SHA256 timestamp+sign header; corp_id/agent_id 从 config/env 注入）
- A10.4: Inngest Cloud SDK（替换 mock base URL；用 `@inngest/sdk` 或保留裸 HTTP 做简单 passthrough）
- A10.5: fsf_work_orders 状态变触发事件入队（用 `audit_events` 队列桥接，不用 trigger→RPC）

**Out of scope:**
- 多用户 auth（前端订阅 form 暂用 hardcoded workspace）
- 钉钉 corp_id 真实凭据（仍 placeholders；A10.3 给出签名算法和 env 接口）
- Inngest Cloud 真实 key（A10.4 给出 env 接口和 SDK 安装）

**Success criterion:**
A) `rpc_subscription_poll_match` 返回 rows filtered by workspace_id (verified by `psql -c "select count(*)"` with `p_workspace_id='heytea-bj'`)
B) Frontend form POST creates a new subscription row → appears in list within 1 poll cycle
C) DingTalk HMAC-SHA256 signature header generated correctly (verified by dry-run log showing `sign=...`)
D) `rpc_work_order_enqueue_event` inserts into fsf_inngest_events on status change (verified by SQL)

## 2. Context Read

- `services/inngest-bridge/src/config.ts` — WorkerConfig, env vars
- `docs/supabase-xicha-bridge/007_event_subscriptions.sql` — 7 RPCs + fsf_event_subscriptions
- `docs/supabase-xicha-bridge/003_food_safety_schema.sql` — fsf_work_orders 22-col table
- `docs/supabase-xicha-bridge/005_inngest_gate_rpcs.sql` — escalation.dispatch pattern

**Assumptions made explicit:**
- A10.3: DingTalk robot HMAC-SHA256 = `sha256(secret + "\n" + timestamp).base64()` with `?timestamp=...&sign=...` query params
- A10.5: Trigger 不能直接 call RPC (search_path + SECURITY DEFINER issue). Bridge via `dfd_audit_events` queue: trigger inserts event row into audit_events with category='work_order_status_change', subscribe_loop or dedicated process reads and enqueues.
- A10.4: Inngest Cloud 接入有两种方案：(a) SDK (`@inngest/sdk`) (b) 保留裸 HTTP 做 passthrough。方案 (b) 更简单且 A8/A9 已有；方案 (a) 更 robust。我选 (b) 作为 default，但给出 (a) 的 env 接口。

## 3. Plan — Step / Verify

| # | Step | Verify Gate |
|---|---|---|
| 3.1 | SQL: rpc_subscription_poll_match workspace 参数化 + rpc_work_order_enqueue_event + workspace_seeds | `psql` count rows filtered by workspace_id ≠ 'default' |
| 3.2 | SQL: workspace audit bridge (trigger → dfd_audit_events) | `psql` INSERT fsf_work_orders → SELECT dfd_audit_events category='work_order_status_change' |
| 3.3 | TS: config.ts 加 DINGTALK_SECRET + INNGEST_SIGNING_KEY env | `tsc --noEmit` exit 0 |
| 3.4 | TS: dingtalk-signature.ts (HMAC-SHA256, 1 file, <30 LOC) | dry-run log shows sign=... |
| 3.5 | TS: subscribe_loop.ts 接入 work-order audit bridge | `tsc` dist ≥ 26 files |
| 3.6 | UI: admin-webhooks-panel 加 create-form + event-name constants | UI renders form without errors |
| 3.7 | SQL verify: A10 10-step verify | `008_verify_workspace_events.sql` 10 checks pass |
| 3.8 | README_A10.md + final commit | git diff --stat only A10 files |

## 4. Execute — minimal touch

Only touch:
- `docs/supabase-xicha-bridge/008_event_workspace_subscription.sql` (NEW, ~150)
- `docs/supabase-xicha-bridge/008_verify_workspace_events.sql` (NEW, ~60)
- `services/inngest-bridge/src/config.ts` (EDIT, +2 env vars)
- `services/inngest-bridge/src/dingtalk-signature.ts` (NEW, ~25)
- `services/inngest-bridge/src/subscribe_loop.ts` (EDIT, +work-order bridge)
- `apps/web/src/app/admin/admin-webhooks-panel.tsx` (EDIT, +form + constants)
- `apps/web/src/app/admin/event-names.ts` (NEW, ~20 constants)
- `docs/supabase-xicha-bridge/A10_PLAN.md` + `README_A10.md` (NEW)

Do NOT modify: 005, 006, 007 SQL, worker.ts, server.ts, harness-core, agent-runtime.

## 5. Gates

- `tsc --noEmit` in services/inngest-bridge → 0
- `tsc` build dist → 26+ files (subscribe_loop + dingtalk-signature)
- `node dist/subscribe_loop.js` → fail-fast "missing env" (expected, not import error)
- `git diff --stat` → only A10 paths
- apps/web tsc → skipped (env limitation, noted per vibe-coding-cn rule)

## 6. Diff Review

Watch for: `{`, `{{`, `}}` in SQL/template literals (parser killer), secrets in config.ts.

## 7. Commit

```
feat(supabase-xicha-bridge): A10 workspace events + DingTalk real sig + WO→event

* cross-workspace: rpc_subscription_poll_match workspace_id param + rpc_work_order_enqueue_event
* dingtalk HMAC-SHA256: dingtalk-signature.ts + DINGTALK_ROBOT_SECRET env
* work-order→event bridge: audit_events queue + subscribe_loop reads WO status changes
* UI: admin-webhooks-panel create-form + EVENT_NAMES constant enum
* verify: 008_verify_workspace_events.sql (10 checks)

Refs: datafoundry-A10
```

## 8. Sync Docs

- `A10_PLAN.md` (this file)
- `README_A10.md` (delivery index, V-gate table, karpathy self-audit)