# A24 — Rich Markdown Card + subscribe_loop bodyFor()

**目标**：钉钉通知卡片升级为结构化 Markdown（含表格、状态图标、工单详情）。

**资产清单**：
```
services/inngest-bridge/src/subscribe_loop.ts  (改) bodyFor() → rich markdown
docs/supabase-xicha-bridge/
├── 016_work_order_markdown_card.sql (新) 2 RPC
└── README_A24.md                    (新) 交付清单
```

---

## 关键内容

### A24.1: 016_work_order_markdown_card.sql

| RPC | 功能 | 调用方 |
|---|---|---|
| `rpc_work_order_markdown_card` | 完整 Markdown 卡片（标题 + 摘要表格 + 门店 + 订单 + 补偿 + AI备注） | subscribe_loop / bodyFor 降级 |
| `rpc_work_order_digest_card` | 单行摘要（适用于通知标题行） | 钉钉卡片 title 字段 |

**卡片样式规范**：
```
## 🚨 【紧急升级】食品安全工单

> **FSW-20260821-0042**  |  🔴 高风险  |  ⚙️ 调查中

| 项目 | 内容 |
|---|---|
| 工单号 | **FSW-20260821-0042** |
| 问题类别 | 外源性异物（外部）/ plastic |
| 风险等级 | 🔴 高风险 |
| SLA 状态 | ⏰ SLA 已超时！ |
| 创建时间 | 2026-08-21 14:00 |
| SLA 截止 | 2026-08-21 16:00 |

### 问题描述
客户反映在冰博客中喝到塑料异物...

### 门店信息
| 门店 ID | BJ-001 |
| 门店名称 | 北京三里屯店 |
| 区域 | 华北大区 |

---
> DataFoundry × 喜茶食安系统 | 2026-08-21 15:32:00
```

### A24.2: subscribe_loop bodyFor() 富文本

`bodyFor()` 新增字段感知，fallback client-side 卡片：

```typescript
// 传入 payload 包含 risk_level / sla_status / category / status 时
// 自动渲染 riskIcon / slaIcon / statusIcon + 表格卡片
// payload 来自 fsf_inngest_events.payload（由各 RPC 注入）
```

**推送层级**（由丰富到简陋）：
1. `rpc_work_order_markdown_card` 直接返回 markdown 字符串 → `payload.markdown`
2. `payload.risk_level/sla_status/category` 齐全 → client-side rich card
3. 兜底 → 原有的简化标题

---

## 下一步候选

- **A25**: `rpc_work_order_markdown_card` 集成进 subscribe_loop（优先使用 server-side 渲染）
- **A25.1**: 补偿 approve 集成进 stage-dialog（resolution 阶段新增「确认补偿」按钮）
- **A25.2**: 钉钉卡片点击跳转工单详情页（URL scheme + DingTalk corp msgLink）
