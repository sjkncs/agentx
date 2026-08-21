# A27 — XichaFSD Multi-Subagent Architecture

**目标**：在 datafoundry harness-core 框架下，构建喜茶食安多子 Agent 系统。

**资产清单**：
```
packages/agent-runtime/src/tools/xicha/
├── xicha-fsd-agent.ts     (新) 主 Agent Assembly
├── food-safety-subagent.ts (新) 意图分类 + 话术生成 + 输出审计
├── wo-subagent.ts          (新) 工单创建 + 查询 + 升级 + 补偿审批
├── xicha-orchestrator.ts   (新) 编排器（sequential routing）
└── index.ts                (新) barrel export
```

---

## 架构图

```
XichaFSDAgent
  ├─ toolRegistry: FOOD_SAFETY_TOOLS (7 tools)
  ├─ manager: SubagentManager
  ├─ orchestrator: XichaFSDOrchestrator
  └─ sessionLog: SessionEventLog
         │
         ├─ FoodSafetySubagent (role=researcher, isolation=shared)
         │     ├─ classify() → food_safety_intent_classify tool
         │     ├─ generateReply() → food_safety_generate_reply tool
         │     └─ audit() → food_safety_audit_output tool
         │
         └─ WorkOrderSubagent (role=executor, isolation=isolated)
               ├─ createWorkOrder() → food_safety_create_work_order tool
               ├─ queryWorkOrders() → food_safety_query_work_orders tool
               ├─ getSla() → food_safety_get_sla tool
               └─ getCompensation() → food_safety_get_compensation tool
```

---

## 核心流程

```
用户消息
    │
    ▼
XichaFSDOrchestrator.orchestrate()
    │
    ▼
FoodSafetySubagent.classify()
    ├─ intent ≠ food_safety → 直接返回（general/order）
    └─ intent = food_safety → 继续
    │
    ▼
FoodSafetySubagent.generateReply()
    └─ four_step_script: empathy → collect → promise → compensate
    │
    ▼
FoodSafetySubagent.audit()
    ├─ block → 替换为合规兜底回复
    ├─ warn  → 附加警告信息
    └─ pass  → 直接使用
    │
    ▼
[classify.should_escalate + has store_info]
    │
    ▼
WorkOrderSubagent.createWorkOrder()
    │
    ├─ work_order.created → Inngest → DingTalk 钉钉通知
    └─ compensation.generate → Inngest → 补偿物料生成
```

---

## 关键设计

### Subagent Role 分配

| Agent | role | isolation | 职责 |
|---|---|---|---|
| `FoodSafetySubagent` | researcher | shared | 分析型：意图 + 话术 + 审计 |
| `WorkOrderSubagent` | executor | isolated | 执行型：工单 + 升级 + 补偿 |

### L4 合规审计

- **Layer 1**: 违禁词黑名单（奈雪/茶颜悦色/毒品/去死）
- **Layer 2**: 食安话术红线（"全额退款"/"100%满意"/"确认是喜茶问题"）
- **Layer 3**: 幻觉检测（"根据我们的调查"/"门店已被处罚"）

### Inngest 事件触发

编排完成后触发两个事件：
- `work_order.created` → `handleWorkOrderNotify()` → 钉钉富文本卡片
- `compensation.generate` → Inngest further step → 补偿物料生成

---

## V-Gate

| Gate | 期望 | 实际 | 状态 |
|---|---|---|---|
| xicha-fsd-agent.ts | main agent with 4-step pipeline | ✅ | |
| food-safety-subagent.ts | classify + reply + audit tools | ✅ | |
| wo-subagent.ts | WO CRUD tools | ✅ | |
| xicha-orchestrator.ts | sequential routing + event emit | ✅ | |
| index.ts | barrel export all types | ✅ | |
| No TS lints | — | ✅ | |
