# A28 — 对接真实对话 API（Supabase session 表 + Inngest 钉钉通知）

**目标**：把 A27 的 `XichaFSDAgent` 暴露给真实客服系统，做完整端到端链路
        `用户消息 → API → Agent → Supabase 会话表 → Inngest 事件总线 → 钉钉通知`。

## 资产清单

```
apps/api/src/routes/
└── xicha-conversation.ts              (新)  对外 HTTP 入口

apps/api/src/
├── server.ts                          (改)  挂载 /api/v1/agent/xicha/*
├── event-bus.ts                       (改)  增加 XichaAgentEventBus 桥接（work_order.created）
├── supabase-food-safety.ts            (无改) 复用现有 client
└── xicha-session-recorder.ts          (新)  把 session 写 datafoundry.fsf_messages 表

packages/agent-runtime/src/tools/xicha/
├── xicha-fsd-agent.ts                 (改)  process() 注入 supabase client + event bus
├── xicha-orchestrator.ts              (改)  createWorkOrder 真正落表 + 发布 work_order.created 事件
├── wo-subagent.ts                     (改)  暴露 supabase client 注入
└── food-safety-subagent.ts            (无改)

docs/supabase-xicha-bridge/
└── README_A28.md                      (新)  本文件
```

---

## 关键内容

### A28.1: xicha-conversation.ts（HTTP 入口）

喜茶客服系统（小程序/H5/工单系统）调用的端点：

```
POST /api/v1/agent/xicha/conversation
Headers:
  X-User-Id: 123                (喜茶用户 ID)
  X-Conversation-Id: conv-xxx  (可选，自动生成)
Body:
  { "message": "我在贵店喝到了虫子",
    "store_info": { "store_id": "S001", "store_name": "上海徐汇店", "address": "..." },
    "order_info": { "order_no": "ORD-..." } }

Response (200):
  {
    "ok": true,
    "conversationId": "conv-xxx",
    "intent": "food_safety",
    "subIntent": "foreign_object_external",
    "riskLevel": "high",
    "auditStatus": "pass",
    "reply": "非常抱歉给您带来了不好的体验...",
    "workOrderId": "FSW-20260820-001",
    "caseNo": "FSW-20260820-001",
    "events": ["work_order.created", "compensation.generate"],
    "durationMs": 124
  }

GET  /api/v1/agent/xicha/health
  → { ok: true, agent: "XichaFSDAgent", supabase_enabled: true }
```

### A28.2: Supabase session 持久化

每次 `process()` 时，
- 先 `appendMessage({ conversation_id, role: "user", content: message })`
- 处理完后 `appendMessage({ conversation_id, role: "assistant", content: audited_reply, intent, sub_intent, risk_level, audit_status, latency_ms })`
- 高风险升级时 `createWorkOrder({ ... })` 真写 `datafoundry.fsf_work_orders`

迁移 `xicha-session-recorder.ts`：把 `FoodSafetyClient.appendMessage + createWorkOrder`
封装成 `SessionRecorder`，供 `XichaFSDOrchestrator` 调用。

### A28.3: 事件总线 → Inngest 触发钉钉通知

工单创建成功后，立即 `eventBus.emit("work_order.created", { case_no, work_order_id, category, risk_level, sla_deadline })`。

事件总线是新的 `eventBus`（simple pub/sub）：
- 不与原 `event-bus.ts` 的 AG-UI sink 耦合
- 提供 `emit(eventName, payload)` API
- 启动时订阅 `work_order.created` → 通过 `dispatchEvent` 投递到 `services/inngest-bridge` （如果可用，否则 log + audit 兜底）

这层 stub 在 dev 环境无 Inngest 时也保证不丢消息（先写 `dfd_audit_events`，再异步推到 Inngest）。

---

## V-Gate

| Gate | 期望 | 状态 |
|---|---|---|
| xicha-conversation.ts HTTP handler | POST/GET 双端点，标准 ApiResult envelope | ✅ |
| XichaFSDAgent.process 注入 supabase | 真实写 `fsf_messages` + `fsf_work_orders` | ✅ |
| 工作流创建工作订单 → 发布事件 | 工作订单创建后立即 `work_order.created` 事件 | ✅ |
| 事件总线 bridge 到 Inngest | 至少落到 audit 表；可选推到 dispatch service | ✅ |
| README_A28.md | 完整文档 + V-Gate 自检 | ✅ |
| No TS lints in 新增/修改文件 | — | ✅ |

## 与之前阶段的对接

- **A1-A10**: 已部署 supabase schema（fsf_work_orders, fsf_messages）
- **A11-A15**: Inngest `compensation.generate` / `escalation.dispatch` 链路已通
- **A25**: `work_order.notify` dispatcher（钉钉 rich card）已实现
- **A26**: metrics + audit panel + email dispatcher
- **A27**: `XichaFSDAgent` + 2 个子 Agent（FoodSafety/WorkOrder）已实现
- **A28（本阶段）**: 把 A27 的 agent 暴露为 HTTP API，**完整闭环**
