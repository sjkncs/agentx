# A26 — Metrics + Audit + Email Dispatcher

**目标**：SLA/审计统计 RPC + admin 面板 + email dispatcher。

**资产清单**：
```
docs/supabase-xicha-bridge/
└── 017_sla_metrics_rpcs.sql   (新) 6 RPC

apps/web/src/app/admin/
├── admin-audit-enhanced-panel.tsx  (新) 审计增强面板
├── admin-metrics-panel.tsx        (新) SLA统计面板
└── admin-home.tsx                  (改) import audit2 + metrics panels

services/inngest-bridge/src/dispatchers/
├── email.ts   (新) handleEmail
└── index.ts  (改) + work_order.email
```

---

## 关键内容

### A26.1: food-safety-tools.ts（无需改动，已完善）

现有 7 个 tools（intent classify / reply generate / output audit / create WO / query WO / get compensation / get SLA）已完整。

### A26.2: 017_sla_metrics_rpcs.sql — 6 个统计 RPC

| RPC | 功能 |
|---|---|
| `rpc_sla_summary` | 当前 open 工单 SLA 健康度：breached/warning/ok count + breach_rate + oldest_deadline |
| `rpc_sla_stats` | 多维 cube 统计（category×risk×status×stage）：wo_count, avg_resolution_hours, total_compensation_amount |
| `rpc_work_order_list_events` | 工单事件时间线（补充 p_limit 默认值 + p_status 过滤） |
| `rpc_audit_event_list` | 审计事件列表（category/actor_id/severity/days 过滤，p_limit=100） |
| `rpc_audit_summary` | 审计统计（按 action×category×severity cube 分组） |
| `rpc_compensation_stats` | 补偿统计（已有，来自 015） |

### A26.2: admin-audit-enhanced-panel.tsx

- `rpc_audit_event_list` 实时列表
- 筛选：category / severity / days（1/7/30/90）
- 统计摘要：action×severity cube 4格卡片
- 每行可展开 payload JSON

### A26.3: admin-metrics-panel.tsx

- `rpc_sla_summary` 5 格 summary cards
- SLA 健康度进度条（rose/amber/emerald）
- `rpc_sla_stats` 完整统计表格（category×risk×status×sla_status）
- 底部：avg_breached_hours + warning_active

### A26.4: email dispatcher

```
handleEmail(cfg, rpc, payload)
  → render email body (subject + text with case_no)
  → EMAIL_WEBHOOK_URL (env) or rpc_inngest_pick_notification_route
  → POST JSON to email webhook
```

注册事件：`work_order.email`

---

## V-Gate

| Gate | 期望 | 实际 | 状态 |
|---|---|---|---|
| 017 SQL | 6 RPC idempotent | ✅ | |
| audit-enhanced-panel | audit list + summary + expand | ✅ | |
| metrics-panel | SLA cards + bar + stats table | ✅ | |
| email.ts | handleEmail, no lints | ✅ | |
| index.ts | register work_order.email | ✅ | |
| No TS lints (all files) | — | ✅ | |
