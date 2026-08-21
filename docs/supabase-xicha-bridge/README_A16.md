# A16 — WO Create + Retry Config Panel

**目标**：工单手动创建 API + 重试策略配置面板。

**资产清单**：
```
docs/supabase-xicha-bridge/
├── 011_work_order_rpcs.sql        (新) WO CRUD RPC + 验证
└── README_A16.md                 (新) 交付清单

apps/web/src/app/
├── admin/
│   ├── admin-wo-create-dialog.tsx (新) 新建工单模态表单
│   ├── admin-retry-config.tsx     (新) 重试策略配置面板
│   ├── admin-work-orders.tsx     (改) +创建按钮 + WOCreateDialog 集成
│   └── admin-home.tsx            (改) +retry tab
└── api/admin/wo/route.ts         (新) POST /api/admin/wo → rpc_work_order_create
                                           GET  /api/admin/wo → fetch wo state
```

---

## 关键改动

### A16.1: 011_work_order_rpcs.sql

**rpc_work_order_create** — 创建工单：
```
输入: p_category, p_description, p_risk_level, [p_store_id/name/order_no/reporter_email/evidence_urls]
返回: { ok, case_no, id, sla_hours }
逻辑:
  - 生成 case_no = WO-{YYYYMMDD}-{4位随机}
  - 按 risk_level 自动计算 SLA deadline:
      high   → 2h
      medium → 8h
      low    → 24h
  - 插入 fsf_work_orders
  - 插入 fsf_inngest_events (source='admin_create')
```

**rpc_work_order_list** — 带 summary stats：
```
返回字段: 全部 22 字段 + event_count + last_event_at
支持: p_category / p_status / p_risk_level 过滤
```

### A16.2: POST /api/admin/wo

| 方法 | 路径 | 功能 |
|---|---|---|
| GET  | /api/admin/wo?case_no= | 查单条工单 |
| POST | /api/admin/wo (WOCreateBody) | 创建工单 |
| POST | /api/admin/wo (WOUpdateBody) | 更新状态 |

### A16.3: admin-retry-config.tsx

- 6 channel × 5 参数：maxAttempts / baseDelaySeconds / maxDelaySeconds / multiplier / enabled
- 列表模式：退避序列预览（如 `10s → 20s → 40s → 60s`）
- 编辑模式：逐 channel 配置 + 预设（快速/标准/保守）
- 保存（模拟）：需后端 workspace_config 支持

---

## V-Gate 结果

| Gate | 期望 | 实际 | 状态 |
|---|---|---|---|
| 新文件 tsc | 无 error | 0 (project-level, pre-existing ignored) | ✅ |
| 交付清单 | README_A16.md | ✅ | |
| Commit | A16 干净 | 6 files | ✅ |

---

## 下一步候选

- **A17**: subscribe_loop 真实 backoff 实现（读取 workspace_config 重试参数）
- **A17.1**: dfd_audit_events workspace_config CRUD（admin 配置持久化）
- **A17.2**: 钉钉 corp 消息模板管理面板