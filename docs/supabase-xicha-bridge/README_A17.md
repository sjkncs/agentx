# A17 — subscribe_loop Backoff + Workspace Config CRUD

**目标**：subscribe_loop 真实退避重试 + workspace 配置 CRUD + 钉钉消息模板管理。

**资产清单**：
```
services/inngest-bridge/src/
└── subscribe_loop.ts              (改) A17 backoff 重试循环 + poll_retries 扫描

docs/supabase-xicha-bridge/
├── 012_workspace_config.sql       (新) 6 个 workspace/retry RPC
└── README_A17.md                 (新) 交付清单

apps/web/src/app/admin/
├── admin-workspace-config.tsx    (新) 工作区配置面板（retry per-channel 快速编辑）
├── admin-dingtalk-template.tsx   (新) 钉钉消息模板管理（CRUD + 变量预览）
└── admin-home.tsx               (改) +wsconfig +templates tab（12 tabs）
```

---

## 关键改动

### A17.1: subscribe_loop.ts 真实退避

**退避策略**（per-channel，优先级：RPC config > env var > defaults）：

| 参数 | 默认值 | 来源 |
|---|---|---|
| max_attempts | 5 | RETRY_MAX_{CHANNEL} |
| base_delay_s | 30s | RETRY_BASE_{CHANNEL} |
| backoff_multiplier | 2.0x | RETRY_MULTIPLIER |
| max_delay_s | 3600s | RETRY_MAX_DELAY |

**退避序列**：`base × 2^(attempt-1)`, cap at max

**重试循环**：
1. 首次 dispatch → record_delivery
2. 失败 → 检查 attempt < max_attempts
3. 调用 `rpc_subscription_delivery_resend` 重入队列
4. sleep(backoff_ms)
5. scan `fsf_subscription_deliveries WHERE status=pending AND resend_requested_at < now()`

**新增 RPC**：`rpc_subscription_poll_retries` / `rpc_subscription_get_attempt_count` / `rpc_subscription_get_latest_delivery`

### A17.2: 012_workspace_config.sql

| RPC | 功能 |
|---|---|
| `rpc_workspace_config_get` | 读取单个配置项（供 subscribe_loop 读取 retry 参数） |
| `rpc_workspace_config_set` | 写入配置（upsert via workspace_seed event） |
| `rpc_workspace_config_list` | 列出 workspace 全部配置 |
| `rpc_subscription_poll_retries` | 扫描 pending 重试 |
| `rpc_subscription_get_attempt_count` | 获取投递次数 |
| `rpc_subscription_get_latest_delivery` | 获取最新 delivery id |

### A17.3: admin-workspace-config.tsx

- 6 channel × 4 参数：max_attempts / base_delay_s / max_delay_s / backoff_multiplier
- 退避序列实时预览
- 脏值追踪 + 批量保存 → `rpc_workspace_config_set`

### A17.4: admin-dingtalk-template.tsx

- 3 seed 模板（工单告警 / 已解决 / 补偿审批）
- CRUD：name / msgType / title / body
- 变量自动检测（`{{work_order_id}}` 等 13 种）
- 实时渲染预览（输入测试值 → 显示钉钉效果）

---

## V-Gate 结果

| Gate | 期望 | 实际 | 状态 |
|---|---|---|---|
| subscribe_loop tsc | 无 error | 0 | ✅ |
| 新 tsx tsc | 无 error | 0 (project-level, pre-existing ignored) | ✅ |
| SQL defifier typo | 无 | 1 fixed | ✅ |
| 交付清单 | README_A17.md | ✅ | |
| Commit | A17 干净 | 5 files | ✅ |

---

## /admin 完整 12 Tab

members · audit · users · metrics · alerts · approvals · webhooks · 工单 · 投递 · **重试策略** · **工作区** · **模板**

---

## 下一步候选

- **A18**: 工单 AI 处理 agent（调用 LLM 分析投诉 → 建议 compensation_type）
- **A18.1**: food_safety 场景 SOP 可视化（流程图 + 自动升级规则）
- **A18.2**: 审计日志搜索增强（按 user/event_name/time_range 过滤）