# A25 — Dispatcher Integration + Compensation Approve + WO Detail Page

**目标**：markup-card 进 dispatcher + compensation approve 集成 stage-dialog + WO 详情页。

**资产清单**：
```
services/inngest-bridge/src/dispatchers/
├── work-order-notify.ts   (新) handleWorkOrderNotify
└── index.ts              (改) register work_order.* events

apps/web/src/app/admin/
├── admin-wo-stage-dialog.tsx   (改) +compensate mode + sub_category
├── admin-work-orders.tsx       (改) sub_category + as never removal
└── workorders/
    ├── page.tsx                 (新) WO 列表页（SLA 优先级 + 筛选）
    └── [case_no]/
        └── page.tsx             (新) WO 详情页（22字段 + 卡片预览）
```

---

## 关键内容

### A25.1: handleWorkOrderNotify

```
dispatchEvent(event_name in work_order.*)
  → handleWorkOrderNotify(cfg, rpc, payload)
      ├─ Step 1: rpc_work_order_markdown_card(case_no)
      │            → title + full markdown text
      ├─ Fallback: client-side rich card (risk/sla/status icons + table)
      └─ Step 2: rpc_inngest_pick_notification_route("dingtalk")
                 → POST DingTalk

registered events:
  work_order.escalated | work_order.created
  work_order.stage_changed | work_order.compensation_approved
```

### A25.2: admin-wo-stage-dialog.tsx — compensate mode

4 个 view modes：`view | advance | escalate | compensate`

```
view:
  ├─ 推进按钮 (next stage)
  ├─ ✅ 确认补偿方案 ← NEW
  └─ ⬆️ 升级

点击"确认补偿方案":
  → loadCompensation(category, sub_category, risk_level)
     → rpc_compensation_recommend → 推荐方案卡片
  → setView("compensate")

compensate mode:
  ├─ 推荐方案卡片 (amount range + script)
  ├─ 补偿方式 select
  ├─ 补偿金额 input
  ├─ 处理备注 textarea
  └─ 确认补偿 → rpc_compensation_approve
                 → wo.status=resolved, resolved_at=now
                 → audit_log + fsf_inngest_events
```

### A25.3: workorders/page.tsx + [case_no]/page.tsx

**列表页**：
- 筛选：category / status / sla_status
- Summary badges：breached / warning / escalated / total
- 表格：工单号（跳转详情） / 类别 / 风险 / SLA / 状态 / 创建 / 截止 / 操作
- 操作：详情 + 快速升级

**详情页**：
- Back 导航 + 状态徽章
- SLA 进度条 + 分阶段管理按钮 + 钉钉卡片预览按钮
- Markdown 卡片 `<pre>` 预览
- 22 字段网格（3 列）
- 问题描述 / 门店 / 订单 / 补偿详情 / AI 备注
- 事件时间线（reverse order + icon per event type）

---

## V-Gate

| Gate | 期望 | 实际 | 状态 |
|---|---|---|---|
| work-order-notify.ts | new dispatcher, no lints | ✅ | |
| index.ts | register 4 work_order.* events | ✅ | |
| stage-dialog | +compensate mode, +sub_category | ✅ | |
| workorders/page.tsx | list + filters + summary | ✅ | |
| workorders/[case_no]/page.tsx | detail + card preview | ✅ | |
| No TS lints (all files) | — | ✅ | |
