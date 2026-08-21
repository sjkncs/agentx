# A23 — SLA Cron + Compensation Recommendation

**目标**：verify-loop 每 30s 自动检测 SLA + 补偿方案推荐。

**资产清单**：
```
services/inngest-bridge/src/verify-loop.ts       (改) A23.1 SLA cron + dispatch
docs/supabase-xicha-bridge/
├── 015_compensation_recommendation_rpcs.sql (新) 3 RPC
└── 016_work_order_markdown_card.sql        (新) 2 RPC
(改) docs/supabase-xicha-bridge/011_work_order_rpcs.sql (A23.3 排序)
```

---

## 关键内容

### A23.1: verify-loop.ts — SLA Cron + Dispatch

```
启动条件: DISPATCHED_TO=verifier
循环 (VERIFY_INTERVAL_MS=30000):
  ├─ rpc_sla_check_and_escalate()
  │   → breached → 自动 escalated + fsf_inngest_events
  │   → warning  → status=warning
  └─ 对每个新 breached 事件:
      ├─ rpc_inngest_dispatch_one()
      ├─ dispatcher (钉钉/email)
      └─ rpc_inngest_mark_result
```

**关键行为**：
- `DISPATCHED_TO != 'verifier'` 时静默退出（不会误报）
- `dryRun=true` 时跳过 HTTP 请求但打印日志
- SLA check 异常时继续等待下一个 interval（不退出）

### A23.2: 015_compensation_recommendation_rpcs.sql

| RPC | 输入 | 输出 |
|---|---|---|
| `rpc_compensation_recommend` | category, sub_category, risk_level, severity_score | type + min/max/推荐金额 + 话术 |
| `rpc_compensation_approve` | case_no, type, amount, resolution, handler_id | 更新 WO + 审计 + 事件 |
| `rpc_compensation_stats` | workspace_id, days | category×risk_level×type cube 统计 |

**推荐算法**（3 级 fallback）：
1. 精确匹配 `(category, sub_category, risk_level)`
2. fallback: `(category, risk_level)`
3. fallback: `(category)` 取 severity_score 最高
4. 无匹配 → default apology

### A23.3: WO 列表 SLA 优先级排序

`rpc_work_order_list` 新排序：

```
优先级 1: SLA 状态
  breached(0) > warning(1) > ok(2) > 其他(3)

优先级 2: 处理状态
  escalated(0) > open(1) > investigating(2) > resolved(3) > closed(4)

优先级 3: SLA 截止时间（asc, nulls last）

优先级 4: 创建时间（desc）
```

---

## V-Gate 结果

| Gate | 期望 | 实际 | 状态 |
|---|---|---|---|
| verify-loop.ts | SLA cron + dispatch, no lints | ✅ | |
| 015 SQL | 3 RPC idempotent | ✅ | |
| 016 SQL | 2 RPC + markdown | ✅ | |
| 011 SQL sort | 4-level ORDER BY | ✅ | |
| No TS lints | — | ✅ | |
