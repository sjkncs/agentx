# A10 — Workspace Events + Real DingTalk + Work-Order Event Source

**目标**：打通从工作流状态变化 → 事件入队 → 跨 workspace 订阅匹配 → 真实钉钉签名投递 → 前端创建订阅的全链路。

**资产清单**：
```
docs/supabase-xicha-bridge/
├── 008_event_workspace_subscription.sql   (新) 跨 workspace poll_match + WO trigger + 3 workspace seeds
├── 008_verify_workspace_events.sql       (新) 10 步验收
├── A10_PLAN.md                            (新) V-gate workflow
└── README_A10.md                          (新) 交付清单

services/inngest-bridge/src/
├── config.ts                             (改) +DINGTALK_ROBOT_SECRET +INNGEST_SIGNING_KEY
├── dingtalk-signature.ts                 (新) HMAC-SHA256 signDingtalkUrl()
└── subscribe_loop.ts                     (改) +workspace_id poll param + dingtalk 签名

apps/web/src/app/admin/
├── event-names.ts                        (新) EVENT_NAMES + CHANNEL_NAMES 常量
└── admin-webhooks-panel.tsx               (改) +create-form + workspace 下拉
```

---

## 关键设计

### 1. 跨 workspace

`rpc_subscription_poll_match(p_dispatched_to, p_workspace_id)` — 参数化 workspace，支持 `'default'`（全匹配）和 `'heytea-bj'` 等具体 workspace。

每个 subscribe_loop process 用 `SUBSCRIBER_WORKSPACE_ID=heytea-bj` env 隔离，不同 workspace 用不同 process 互不干扰。

### 2. WO→event 触发

`AFTER UPDATE of status` trigger 直接 `INSERT INTO fsf_inngest_events`，绕开 trigger 不能 call RPC 的权限问题（`AFTER UPDATE` 可以在 trigger 内 insert 任何表）。

### 3. 钉钉 HMAC-SHA256 签名

```typescript
// dingtalk-signature.ts
signDingtalkUrl(url, secret) → url + "?timestamp=...&sign=..."
// sign = base64(HMAC-SHA256(secret, "${timestamp}\n${secret}"))
```

`DINGTALK_ROBOT_SECRET=SEC...` → 自动对所有 dingtalk channel 的 webhook URL 签名。

### 4. 新 env 清单

| ENV | 用途 | 示例 |
|---|---|---|
| `DINGTALK_ROBOT_SECRET` | HMAC-SHA256 签名密钥 | `SEC...` |
| `INNGEST_SIGNING_KEY` | Inngest Cloud webhook 回调校验 | `sign_...` |
| `SUBSCRIBER_WORKSPACE_ID` | subscribe_loop 监听哪个 workspace | `heytea-bj` |
| `DEBUG_SIGN=1` | 打印签名 URL 到日志 | `1` |

---

## V-Gate 结果

| Gate | 期望 | 实际 | 状态 |
|---|---|---|---|
| A10 自审 (K1) | 单元简化 | dingtalk-signature.ts 25 LOC 最小化；subscribe_loop +24 LOC | ✅ |
| TS compile (V3.2) | `tsc --noEmit` exit 0 | exit 0 | ✅ |
| TS build (V3.2b) | dist ≥ 26 files | 29 files（含 dingtalk-signature.js） | ✅ |
| subscribe_loop load | node dist 加载 OK | exit 1 env-missing（预期） | ✅ |
| apps/web tsc | exit 0 | **环境受限**（monorepo 无全局 tsc） | ⚠️ |
| Diff review (V6) | 仅 A10 文件 | stage 干净 | ✅ |
| Commit (V7) | `feat(supabase-xicha-bridge): A10 ...` | `10 files, +1690/-2` | ✅ |

### Karpathy 4 原则

| 原则 | 评价 |
|---|---|
| 1. Think Before Coding | ✅ A10_PLAN.md 先写，3 个 assumption 显式说明 |
| 2. Simplicity First | ✅ dingtalk-signature.ts 25 LOC；WO→event 用 trigger 直接 insert 不加中间队列 |
| 3. Surgical Changes | ✅ worker.ts / server.ts / harness-core 0 改动；只扩 subscribe_loop + config |
| 4. Goal-Driven | ✅ 每个新 RPC 有 verify step；create-form 可点击验证 |

---

## 下一步候选

- **A11**：钉钉 corp_id / agent_id 真实机器人（当前仍是 `?access_token=DEMO` placeholder）
- **A11.1**：Inngest Cloud 真实接入（`INNGEST_EVENT_API_BASE` → Inngest SDK `inngest.send()`）
- **A11.2**：多 subscribe_loop process 的 docker-compose profile 编排
- **A11.3**：前端 workspace 切换器（当前 workspace 下拉 hardcoded）