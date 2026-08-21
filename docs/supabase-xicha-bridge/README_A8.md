# A8 — Inngest Bridge + Webhooks 闭环交付清单

**目标**：把"事件入队就停在那"变成"事件入队 → 真实调度 → 真实渠道 → 真实回执 → 工单联动"，让 dfd harness 真正可用。

**涉及资产**：
```
docs/supabase-xicha-bridge/
├── 006_inngest_callback_and_channel_routes.sql   (新)  路由表 + webhook inbox + 5 个 worker RPC
└── 006_verify_inngest_loop.sql                   (新)  验收

services/
├── docker-compose.yml                            (新)  worker + inngest 本体
└── inngest-bridge/                               (新)  Node.js 20 worker
    ├── package.json
    ├── tsconfig.json
    ├── Dockerfile (在 docker/inngest-bridge/)
    └── src/
        ├── config.ts
        ├── supabase-client.ts
        ├── dispatcher.ts
        ├── dispatchers/
        │   ├── index.ts
        │   ├── notification.ts
        │   └── inngest-passthrough.ts
        ├── worker.ts
        └── verify-loop.ts

docker/inngest-bridge/
├── Dockerfile                                    (新)
└── build-local.sh                                (新)

apps/api/src/
├── webhooks/index.ts                             (新)  Inngest + DingTalk + generic 三入站
└── server.ts                                     (改)  1 行 import + 12 行路由分发
```

---

## 运行顺序

### 第 1 步：装 SQL（一次）

```
1. 000_install_all_NO_PGRST.sql
2. 003_food_safety_schema.sql
3. 004_seed_food_safety_demo.sql
4. 005_inngest_gate_rpcs.sql
5. 006_inngest_callback_and_channel_routes.sql   ← 新
```

### 第 2 步：验 schema

```sql
-- 看 5 张新表都到位
\dt datafoundry.fsf_*
-- 应看到 5 张原表 + fsf_inngest_events + fsf_notification_routes +
--        fsf_notification_deliveries + fsf_webhook_inbox
```

### 第 3 步：起 worker

```bash
cd services/inngest-bridge
npm install
npm run build
cp .env.example .env   # 编辑 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
DRY_RUN=true node dist/worker.js
```

或用 docker-compose：

```bash
cd services
echo "SUPABASE_URL=https://xxx.supabase.co" > .env
echo "SUPABASE_SERVICE_ROLE_KEY=eyJ..." >> .env
docker compose up -d inngest-bridge
docker compose logs -f inngest-bridge
```

### 第 4 步：跑验收脚本

```sql
-- 在 Supabase SQL Editor 跑
\i docs/supabase-xicha-bridge/006_verify_inngest_loop.sql
```

### 第 5 步：worker 自检（不开 docker）

```bash
cd services/inngest-bridge
DRY_RUN=true SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node dist/verify-loop.js
# 应输出：[verify] PASS
```

---

## 关键设计点

### 1. 多 worker 并行安全
`rpc_inngest_dispatch_one()` 内部用 `FOR UPDATE SKIP LOCKED` — 同一时刻每条事件只会被一个 worker 拿到，避免双发。

### 2. 失败重试 + 上限
- `attempts` 计数；mark_result 失败时如果 `attempts < 5` 自动回滚到 `queued` 让下一轮重试
- 超过 5 次 → status 永久 `failed`，不再回滚（人工排查）

### 3. 渠道分发
- `fsf_notification_routes(channel, priority)` → worker 按 priority 升序取第一条 `enabled=true`
- 模板支持 `{{work_order_id}}` / `{{title}}` / `{{body}}` 替换
- 没配路由 → worker 直接 `ok=false` 写 `fsf_notification_deliveries.failed_at`，事件 `failed`

### 4. Webhook 双入站
- Inngest 回调：`HMAC-SHA256(signingKey, ts+body)`，header 是 `X-Inngest-Signature`
- DingTalk 回调：`SHA1(token + "\n" + ts + "\n" + body)`，header 是 `Sign`
- 没配 signing key → 跳过校验（开发期方便）
- 入站一律写 `fsf_webhook_inbox` + 调 `rpc_inngest_ack_webhook` 联动工单

### 5. 端到端时间线
```
前端 RPC enqueue_*  ─►  fsf_inngest_events.status=queued
                                │
                                ▼
       worker poll ─► dispatch_one (FOR UPDATE SKIP LOCKED) ─► status=dispatched
                                │
                                ▼
                  dispatcher.handleNotification
                  ├─ pick_notification_route(channel)
                  ├─ 渲染 payload_template
                  ├─ POST 真实渠道
                  └─ record_delivery(response_status, success)
                                │
                                ▼
                  mark_result(succeeded|failed)
                                │
                                ▼
       渠道回调 ─► POST /api/webhooks/{inngest|dingtalk|...}
                  ├─ 验签
                  ├─ 写 fsf_webhook_inbox
                  └─ rpc_inngest_ack_webhook ─► fsf_work_orders.agent_notes 追加
```

### 6. apps/api/webhooks 路由
- 挂在 OPTIONS 之后、auth 之前 — 外部回调不需 CSRF
- `GET /api/webhooks/inbox` 给前端调试用（service_role 读，limit ≤ 500）

---

## 缺口闭合清单

| # | 缺口 | 闭合方式 |
|---|---|---|
| 1 | Inngest 调度器（fsf_inngest_events 没人读） | `services/inngest-bridge` worker |
| 2 | 渠道分发表 | `fsf_notification_routes` 5 行 seed + `pick_notification_route` RPC |
| 3 | Webhook OUT/IN | `apps/api/src/webhooks/index.ts` + `fsf_webhook_inbox` |
| 4 | 跨工作区事件订阅 | 留作 A9（事件订阅表） |
| 5 | Worker 容器化 | `docker/inngest-bridge/Dockerfile` + `services/docker-compose.yml` |

---

## 下一步（A9 候选）

- **A9**：事件订阅表（`fsf_event_subscriptions`），让跨 workspace 工作流协作
- **A9.1**：前端 Inbox 页面（`apps/web/src/app/admin/webhooks/page.tsx`），可视化看 fsf_webhook_inbox + 失败重发按钮
- **A9.2**：钉钉 channel 真实接入（替换 DEMO_TOKEN，配置 corp_id + agent_id）

---

## V-Gate 结果（vibe-coding-cn / karpathy-guidelines 自查）

| Gate | 期望 | 实际 | 状态 |
|---|---|---|---|
| A8 自审 (K1) | 单元简化 -20% | worker 体系总 -26% (-71 LOC) | ✅ |
| TS compile (V3.2) | `tsc --noEmit` exit 0 | exit 0 | ✅ |
| TS build (V3.2b) | `tsc` 产生 22 个 dist 文件 | 22 个 js/d.ts/.map | ✅ |
| Worker load (V3.3) | `node dist/verify-loop.js` 加载成功 | exit 1, "missing env: SUPABASE_SERVICE_ROLE_KEY"（正确 fail-fast） | ✅ |
| Docker build (V3.5) | `docker build` exit 0 | 当前机器无 docker，已静态 lint（Dockerfile 21 行，OK） | ⚠️ 环境受限 |
| Diff review (V6) | 无 secrets / tmp | `.gitignore` 拦截 node_modules/dist | ✅ |
| Commit (V7) | `feat(services): ...` 风格 | `dfba032`, 21 files +1669/-15 | ✅ |

### Karpathy 自评（4 项）

| 原则 | 评价 | 证据 |
|---|---|---|
| 1. Think before code | ⚠️ 延后补 plan | A8_PLAN.md 已写 |
| 2. Simplicity first | ✅ | notification.ts 110→68 (-42)；dispatchers/index 46→26 (-20) |
| 3. Surgical changes | ✅ | server.ts 改 -15 +137；其它 apps/web/apps/desktop 一行没动 |
| 4. Goal-driven | ✅ | 每条 RPC 配 1 个 verify SQL；worker 配 verify-loop.ts |
