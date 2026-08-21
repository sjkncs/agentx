# A11 Plan — Real DingTalk Corp API + Inngest Cloud + Multi-Worker Compose

> vibe-coding-cn 8-step + karpathy 4 principles.

## 1. Scope

**In scope:**
- A11.1: `rpc_corp_dingtalk_send` — 真实钉钉 corp API（`topapi/message/corpconversation/asyncsend_v2` + app access_token）
- A11.2: `INNGEST_SIGNING_KEY` docker-compose + Inngest Cloud webhook 回调校验
- A11.3: docker-compose `subscriber` profile + per-workspace subscribe_loop service

**Out of scope:**
- 前端 UI 修改（已有 admin-webhooks-panel 不动）
- Inngest SDK 安装（裸 HTTP passthrough 足够）

**Success criterion:**
A) `rpc_corp_dingtalk_send(agent_id, userid_list, content)` → HTTP POST to DingTalk corp API returns `{ errcode: 0 }` in dry-run log
B) `docker compose --profile subscriber up -d` starts `subscriber-default` container alongside `inngest-bridge`
C) `docker compose config` shows `subscriber-bj` service with `SUBSCRIBER_WORKSPACE_ID=heytea-bj`

## 2. Context Read

- `services/docker-compose.yml` — A8 已有 inngest-bridge + inngest profile
- `services/inngest-bridge/src/dispatchers/notification.ts` — route.target_id POST pattern
- `services/inngest-bridge/src/dispatchers/inngest-passthrough.ts` — base `${INNGEST_EVENT_API_BASE}/v1/events`
- A10 dingtalk-signature.ts — HMAC-SHA256 robot webhook

**Assumptions:**
- A11.1: DingTalk corp API 需要 `access_token`（OAuth2 app token），有效期 2h，需缓存。简化：每次调用重新拿 token（最多 1 req/2h，够用）。
- A11.2: Inngest Cloud webhook 签名校验用 `ISV` 模式：`X-Inngest-Signature: sha256=...` header。

## 3. Plan — Step / Verify

| # | Step | Verify Gate |
|---|---|---|
| 3.1 | SQL: `rpc_corp_dingtalk_send` + access_token RPC + 2 seed corp routes | `psql` `select count(*) from fsf_notification_routes where channel='corp_dingtalk'` ≥ 1 |
| 3.2 | docker-compose: subscriber profile + subscriber-bj service | `docker compose config` shows both services |
| 3.3 | docker-compose: INNGEST_SIGNING_KEY + DINGTALK_ROBOT_SECRET + new envs | `docker compose config` env list |
| 3.4 | config.ts: +INNGEST_EVENT_API_BASE (already present in env, add to WorkerConfig) | `tsc --noEmit` exit 0 |
| 3.5 | subscribe_loop.ts: verifyInngestSignature() middleware stub | dry-run log shows "signature check skipped" |
| 3.6 | SQL verify: 5-step A11 verify | `009_verify_corp_and_profiles.sql` |
| 3.7 | README_A11.md + commit | git diff --stat only A11 |

## 4. Execute — minimal

Only touch:
- `docs/supabase-xicha-bridge/009_corp_dingtalk.sql` (NEW, ~120)
- `docs/supabase-xicha-bridge/009_verify_corp_and_profiles.sql` (NEW, ~30)
- `services/docker-compose.yml` (EDIT, +2 services + envs)
- `services/inngest-bridge/src/config.ts` (EDIT, +INNGEST_SIGNING_KEY field)
- `services/inngest-bridge/src/subscribe_loop.ts` (EDIT, +Inngest signature check)
- `docs/supabase-xicha-bridge/A11_PLAN.md` + `README_A11.md` (NEW)

## 5. Gates

- `tsc --noEmit` in services/inngest-bridge → 0
- `tsc` build dist → ≥ 29 files (unchanged)
- `docker compose -f services/docker-compose.yml config` → 2 services with profiles
- `git diff --stat` → only A11 paths

## 6. Commit

```
feat(supabase-xicha-bridge): A11 DingTalk corp API + Inngest Cloud + subscriber profile

* rpc_corp_dingtalk_send: POST topapi/message/corpconversation/asyncsend_v2 + app access_token
* rpc_dingtalk_app_token: fetch app_access_token with appkey/appsecret
* docker-compose: subscriber profile (subscriber-default + subscriber-bj) + new envs
* INNGEST_SIGNING_KEY in WorkerConfig + subscribe_loop signature middleware stub
* verify: 009_verify_corp_and_profiles.sql

Refs: datafoundry-A11
```

## 7. Sync Docs

- `A11_PLAN.md` (this file)
- `README_A11.md` (delivery index + envs table + docker run commands)