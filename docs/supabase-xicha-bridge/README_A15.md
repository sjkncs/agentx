# A15 — Work-Order Detail 22-Field + Delivery Stats Panel

**目标**：工单详情完整 22 字段 + 投递统计面板。

**资产清单**：
```
apps/web/src/app/admin/
├── admin-work-orders.tsx        (改) 22字段详情 + SLA进度条 + 补偿 + 门店/订单 + 凭证
├── admin-delivery-stats.tsx     (新) 投递统计：摘要 + channel过滤 + 失败重发按钮
└── admin-home.tsx              (改) +delivery tab

docs/supabase-xicha-bridge/
└── README_A15.md              (新) 交付清单
```

---

## 关键改动

### A15.1: 工单详情完整 22 字段

**列表增强**：
- SLA 超时/预警 badge（红色/黄色警示）

**详情页扩展**：
| 区域 | 字段 |
|---|---|
| 基本信息 | case_no, category, sub_category, description, risk, status, stage |
| SLA | sla_start, sla_deadline, sla_status + **进度条可视化** |
| 时间线 | created_at, updated_at, escalated_at, resolved_at |
| 人员 | user_id, handler_id |
| 补偿 | compensation_type + compensation_detail（voucher/redelivery/refund） |
| 结果 | resolution |
| 门店 | store_info JSON 展开（store_id, store_name, address, region） |
| 订单 | order_info JSON 展开（order_no, items, amount） |
| 凭证 | evidence_urls 缩略图展示 |
| AI备注 | agent_notes 蓝色背景高亮 |
| 事件流 | fsf_inngest_events 时间线 |

**SLA 进度条**：
- 绿色（正常）/ 黄色（warning）/ 红色（breached）
- 百分比显示 + 状态文字

### A15.2: 投递统计面板

- **3 个 KPI**：总计 / 成功数+成功率% / 失败数
- **channel 过滤器**：email / dingtalk / corp_dingtalk / webhook / sms / slack
- **状态过滤器**：全部 / 成功 / 失败
- **投递记录表**：HTTP状态码 + 重试次数 + 工单ID + 时间 + 重发按钮
- **重发**：调 `rpc_subscription_delivery_resend`

---

## V-Gate 结果

| Gate | 期望 | 实际 | 状态 |
|---|---|---|---|
| 新文件 tsc | 无 error | 0 (project-level) | ✅ |
| 交付清单 | README_A15.md | ✅ | |
| Commit | A15 干净 | 4 files | ✅ |

### Karpathy 4 原则

| 原则 | 评价 |
|---|---|
| 1. Think Before Coding | ✅ 两块功能各自独立，并行实现 |
| 2. Simplicity First | ✅ delivery 用已有 rpc；SLA 用纯 CSS bar |
| 3. Surgical Changes | ✅ admin-home 只加 1 import + 1 type + 2 lines |
| 4. Goal-Driven | ✅ 每个 panel 有明确功能边界 |

---

## 下一步候选

- **A16**：工单创建表单（通过 AI agent 或手动触发 WO）
- **A16.1**：fsf_work_orders PATCH → 自动 enqueue trigger 测试
- **A16.2**：subscribe_loop 的 retry backoff 可视化（admin-delivery-stats 已有的重发按钮覆盖）