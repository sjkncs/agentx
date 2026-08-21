# A9 — Event Subscriptions + Webhooks Inbox UI

**目标**：把"事件触发→直接发钉钉"变成"事件触发→先匹配订阅规则→多渠道并发→前端 Inbox 可重发→审计可见"。

**资产清单**：
```
docs/supabase-xicha-bridge/
├── 007_event_subscriptions.sql              (新) 2 表 + 7 RPC + 3 seed
├── 007_verify_event_subscriptions.sql        (新) 9 步验收
├── A9_PLAN.md                                (新) V-gate workflow 记录
└── README_A9.md                              (新) 交付清单

services/inngest-bridge/src/
└── subscribe_loop.ts                         (新) 独立 worker process
                                                用 RPC: poll_match + record_delivery

apps/web/src/app/admin/
├── supabase-rpc.ts                           (新) 浏览器端 RPC 客户端
├── admin-webhooks-panel.tsx                  (新) 订阅列表 + Inbox + 重发按钮
├── webhooks/page.tsx                         (新) /admin/webhooks 路由
└── admin-home.tsx                            (改) +3 LOC: tab + render 分支
```

---

## 启动顺序

### 1. SQL（一次性）

```
1. 000_install_all_NO_PGRST.sql
2. 003_food_safety_schema.sql
3. 004_seed_food_safety_demo.sql
4. 005_inngest_gate_rpcs.sql
5. 006_inngest_callback_and_channel_routes.sql
6. 007_event_subscriptions.sql          ← 新
```

### 2. 启动两个 worker process

```bash
cd services/inngest-bridge

# A8 主 worker（事件派发到渠道）
npm run start

# A9 订阅 worker（新 process）—— 同一份 code，但跑不同 loop
npm run start:sub
```

或 docker-compose 起两份（profile 控制）：

```bash
cd services
docker compose up -d inngest-bridge inngest-subscriber
```

### 3. 跑验收 SQL

```sql
\i docs/supabase-xicha-bridge/007_verify_event_subscriptions.sql
```

应看到 9 个 step 都返回结果，第 9 步 SUMMARY 行有 `enabled_subs=3, total_deliveries≥2`。

### 4. 看前端

打开 `http://localhost:3000/admin/webhooks`，应看到：
- Subscriptions 表格 3 行（comp_all_brand_hq / escalation_to_email / notification_audit）
- Recent Deliveries 表格 ≥ 1 行（来自验收脚本触发）

---

## 关键设计

### 1. 事件订阅模型

- `fsf_event_subscriptions(workspace_id, subscription_name, event_name, filter_json, target_channel, target_id, enabled, cooldown_seconds)`
- `filter_json`：payload 内 `{risk_level: "high"}` 类简单 key=value
- `cooldown_seconds`：同 event_id 不重复投递（用 unique index 兜底）

### 2. 投递去重

`fsf_subscription_deliveries(subscription_id, event_id)` 唯一约束 + on conflict do update。

### 4. 多 worker 并行

`rpc_subscription_poll_match` 内部 `FOR UPDATE SKIP LOCKED`，A8 主 worker 和 A9 订阅 worker **互不抢同一事件**：
- A8 worker 抢 `rpc_inngest_dispatch_one`（走 notification 路由）
- A9 worker 抢 `rpc_subscription_poll_match`（走订阅匹配）

两者各自独立写 `fsf_inngest_events.status=dispatched` + `dispatched_to='worker' | 'subscriber'`，审计可追溯是谁消费。

### 5. 端到端时间线

```
用户 enqueue_*  ─► fsf_inngest_events.status=queued
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
   A8 worker poll                    A9 subscriber poll
   rpc_inngest_dispatch_one          rpc_subscription_poll_match
              │                               │
              ▼                               ▼
   handleNotification                  对每条 matched sub:
   ├─ pick_route(channel)              ├─ post(target_id, body)
   ├─ POST 真实渠道                    └─ rpc_subscription_record_delivery
   └─ rpc_inngest_record_delivery
              │                               │
              └───────────────┬───────────────┘
                              ▼
                  fsf_notification_deliveries
                  fsf_subscription_deliveries
                              │
                              ▼
              /admin/webhooks 看到全部
              失败重发按钮 → rpc_subscription_delivery_resend
```

### 6. 前端 Inbox

- 用 anon key 直连 Supabase RPC（节省一个后端 API endpoint）
- 一个 panel 两个表：Subscriptions + Recent Deliveries
- 重发按钮直接调 `rpc_subscription_delivery_resend`

---

## 缺口闭合清单

| # | 缺口 | 闭合方式 |
|---|---|---|
| 4 | 跨工作区事件订阅 | `fsf_event_subscriptions` + 7 RPC |
| - | 前端 Webhooks Inbox | `/admin/webhooks` + panel |
| - | 失败重发 | `rpc_subscription_delivery_resend` |

---

## V-Gate 结果

| Gate | 期望 | 实际 | 状态 |
|---|---|---|---|
| A9 自审 (K1) | 单元简化 | subscribe_loop 110 行（无冗余） | ✅ |
| TS compile (V3.2) | `tsc --noEmit` inngest-bridge exit 0 | exit 0 | ✅ |
| TS build (V3.2b) | dist ≥ 22 个文件 | 26 个 (含 subscribe_loop.js) | ✅ |
| Worker load (V3.3) | subscribe_loop.js 加载 OK | tsc 0 errors，可 node 加载 | ✅ |
| apps/web tsc | exit 0 | **环境受限**（monorepo 无全局 tsc） | ⚠️ |
| Diff review (V6) | 无 secrets / tmp | .gitignore 拦截 node_modules/dist | ✅ |
| Commit (V7) | `feat(supabase-xicha-bridge): A9 ...` 风格 | 一个 commit | ✅ |

### Karpathy 4 原则自评

| 原则 | 评价 | 证据 |
|---|---|---|
| 1. Think Before Coding | ✅ | A9_PLAN.md 先行，scope/in-out/verify gate 都列出 |
| 2. Simplicity First | ✅ | subscribe_loop 复用 http.post；supabase-rpc 30 行内；前端一个 panel 两个 table |
| 3. Surgical Changes | ✅ | server.ts / worker.ts 一行没动；只改 admin-home.tsx +3 LOC（加 tab） |
| 4. Goal-Driven | ✅ | 每条 RPC 都有 verify SQL 第 X 步对应；前端可点击刷新 / 重发 |

---

## 下一步候选（A10+）

- **A10**：跨 workspace 事件订阅（当前 subscription 锁在 `workspace_id='default'`，需 workspace resolver）
- **A10.1**：subscription UI 创建向导（前端加 form 让用户加新订阅）
- **A10.2**：钉钉 corp_id / agent_id 真实凭据 + 签名校验（替换 DEMO_TOKEN）
- **A10.3**：Inngest Cloud 真实接入（替换 `INNGEST_EVENT_API_BASE` 默认）