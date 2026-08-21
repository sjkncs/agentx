# A22 — SLA Escalation + Stage Management

**目标**：SLA 超时自动检测 + 工单 stage 流转管理 UI。

**资产清单**：
```
docs/supabase-xicha-bridge/
├── 014_sla_escalation_rpcs.sql     (新) 5 个 RPC
├── README_A22.md                   (新) 交付清单
apps/web/src/app/admin/
└── admin-wo-stage-dialog.tsx       (新) Stage 流转 + 升级表单
(改) admin-work-orders.tsx          (新) 集成 WOStageDialog
```

---

## 关键内容

### A22.1: 014_sla_escalation_rpcs.sql

| RPC | 功能 | 调用方 |
|---|---|---|
| `rpc_sla_check_and_escalate` | 扫描所有工单，超时→breached+escalated，预警→warning；插入 `work_order.escalated` 事件 | verify-loop.ts |
| `rpc_work_order_escalate` | 手动升级（不依赖 SLA 时间）；插入 `work_order.escalated` 事件 | 前端升级按钮 |
| `rpc_work_order_stage_advance` | stage 推进 + notes + resolution；stage→status 映射 | admin-wo-stage-dialog |
| `rpc_work_order_list_with_sla` | 工单列表（含 SLA 统计摘要） | admin-wo-stage-dialog 加载 |
| (index) | `idx_fsfwo_sla_monitor` — SLA 监控查询优化 | — |

**SLA 规则**（来自 `fsf_sla_config`）：
- `high` → 2h
- `medium` → 8h
- `low` → 24h

**SLA 状态机**：
```
ok → warning（剩余 < 20%）→ breached（deadline < now）
   → 自动设置 escalated_at + status='escalated'
   → 插入 fsf_inngest_events (event_name='work_order.escalated')
   → subscribe_loop → 匹配订阅 → 钉钉投递
```

### A22.2: admin-wo-stage-dialog.tsx

5 个组件：
1. **StageIndicator** — 可视化阶段进度条（reported→triage→investigation→resolution→closed）
2. **SlaBanner** — SLA 预警 banner（颜色 + 剩余时间 + 进度条）
3. **View 模式** — 推进按钮组 + 升级按钮 + 关闭按钮
4. **Advance 模式** — stage 推进表单（notes + resolution）
5. **Escalate 模式** — 升级表单（escalate_to + reason）

集成进 `admin-work-orders.tsx`：新增「分阶段管理」按钮 → 打开 `WOStageDialog`。

---

## V-Gate 结果

| Gate | 期望 | 实际 | 状态 |
|---|---|---|---|
| 014_sla_escalation_rpcs.sql | 5 RPC + 1 index, idempotent | ✅ | |
| admin-wo-stage-dialog.tsx | 5 sections, no lints | ✅ | |
| admin-work-orders.tsx | import + integrate dialog | ✅ | |
| Commit | A22 干净 | 3 files | ✅ |

---

## 下一步候选

- **A23**: `rpc_sla_check_and_escalate` 集成进 verify-loop.ts（每 30s 执行）
- **A23.1**: `015_*.sql` — 补偿方案推荐 RPC（基于 fsf_compensation_matrix AI 推理）
- **A23.2**: WO 列表按 SLA 优先级排序（breached/warning 前排）
- **A24**: 钉钉卡片模板升级（Markdown 格式工单详情卡片）