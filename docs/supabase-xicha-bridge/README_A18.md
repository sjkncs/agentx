# A18 — Audit Log Search Enhancement

**目标**：审计日志全文搜索 + 时间范围过滤 + CSV 导出。

**资产清单**：
```
docs/supabase-xicha-bridge/
├── 013_audit_search.sql       (新) 审计搜索 RPC + GIN 索引
└── README_A18.md             (新) 交付清单

apps/web/src/app/
├── admin/
│   ├── admin-audit-enhanced.tsx (新) 增强审计面板（搜索 + 统计 + 导出）
│   └── admin-home.tsx         (改) +audit2 tab（13 tabs）
└── api/admin/audit/route.ts  (新) GET /api/admin/audit (search+stats), POST (CSV export)
```

---

## 关键改动

### A18.1: 013_audit_search.sql

| RPC | 功能 |
|---|---|
| `rpc_audit_search` | payload 关键词搜索 + time_range + category/severity/action/actor_id/target_like 过滤 + 分页 |
| `rpc_audit_stats` | 时间范围 count by category + severity（summary cards 用） |
| `rpc_audit_actions_list` | 时间范围内全部 action 类型（过滤器下拉用） |

**GIN 索引**：`dfd_audit_events_payload_idx`（payload jsonb_path_ops）+ `created_at desc` + `target text_pattern_ops`

**time_range 解析**：`1h / 24h / 7d / 30d` → `now() - interval`

### A18.2: admin-audit-enhanced.tsx

- 4 个时间范围快速按钮
- keyword 搜索（payload 全文）
- category / severity / action / target 工单号 过滤
- 统计摘要 cards（info/warning/critical count）
- 分页 + total count
- CSV 导出（POST /api/admin/audit/export）

### A18.3: api/admin/audit/route.ts

- `GET /api/admin/audit`：keyword + time_range + category + severity + action + actor_id + target_like + limit + offset
- `POST /api/admin/audit/export`：同 filter → CSV blob（UTF-8 BOM）
- 内部并发调用 `rpc_audit_search` + `rpc_audit_stats`

---

## V-Gate 结果

| Gate | 期望 | 实际 | 状态 |
|---|---|---|---|
| 新文件 tsc | 无 error | 0 (project-level, pre-existing ignored) | ✅ |
| 交付清单 | README_A18.md | ✅ | |
| Commit | A18 干净 | 5 files | ✅ |

---

## /admin 完整 13 Tab

members · audit · users · metrics · alerts · approvals · webhooks · **工单** · **投递** · **重试策略** · **工作区** · **模板** · **审计(增强)**

---

## 下一步候选

- **A19**: 数据库 schema 文档化（从 SQL 文件生成 ERD markdown）
- **A19.1**: fsf_work_orders + fsf_inngest_events 关系图
- **A19.2**: dfd_audit_events 事件分类文档