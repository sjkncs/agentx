# A13 — apps/api TS Errors Fix + Work-Order Admin Panel

**目标**：清零 apps/api pre-existing TS errors，建工单管理面板。

**资产清单**：
```
apps/api/src/
├── webhooks/index.ts                   (改) 去掉 @supabase/supabase-js 依赖，改用 dbInsert/dbRpc 纯 fetch；修 Inngest 签名 ts\nbody；加 ! 非空断言
├── supabase-food-safety.ts             (改) env! 非空断言（3处）
└── (server.ts 无改动)

docs/supabase-xicha-bridge/
├── 010_workspace_front_end.sql         (改) +rpc_work_order_list_events + rpc_work_order_update_status
└── README_A13.md                      (新) 交付清单

apps/web/src/app/admin/
└── admin-work-orders.tsx              (新) 工单列表 + 详情 + 事件时间线 + 状态推进按钮
```

---

## 关键改动

### A13.1: apps/api TS 全部清零

**问题根因**：`apps/api` 从未构建过，`@supabase/supabase-js` 从未安装（不在 `package.json`）。

**解决方案**：重写 DB 层为纯 fetch helper（无任何 SDK 依赖）：

```typescript
// 之前（依赖不存在的包）：
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(url, key);

// 现在（零依赖）：
async function dbInsert(env, table, row) { ... }
async function dbRpc(env, fn, args) { ... }
```

**Inngest 签名 ISV 规范**：A12 已修 `${ts}\n${body}`。

**null check**：regex exec 结果加 `!` 非空断言。

### A13.2: 工单管理面板

- **列表页**：按 created_at desc 显示 100 条，risk level + status badge，支持点击选择
- **详情页**：category + risk + status + stage + SLA 截止时间 + 门店信息
- **推进按钮**：调 `rpc_work_order_update_status` → AFTER UPDATE trigger → auto enqueue `work_order.status_change` 事件 → subscribe_loop 发送钉钉通知
- **事件时间线**：调 `rpc_work_order_list_events` 显示工单关联的所有事件

---

## V-Gate 结果

| Gate | 期望 | 实际 | 状态 |
|---|---|---|---|
| inngest-bridge tsc | `tsc --noEmit` exit 0 | exit 0 | ✅ |
| apps/api tsc | exit 0 | exit 0 (pre-existing errors ALL cleared) | ✅ |
| webhooks lints | 0 errors | 0 | ✅ |
| supabase-food-safety lints | 0 errors | 0 | ✅ |
| WO RPCs | 2 new RPCs in 010 | ✅ | |
| Commit | A13 干净 | 5 files | ✅ |

### Karpathy 4 原则

| 原则 | 评价 |
|---|---|
| 1. Think Before Coding | ✅ 发现 @supabase/supabase-js 不存在是根因，给出零依赖解法 |
| 2. Simplicity First | ✅ 纯 fetch helper 替代 SDK；不引入新 npm 包 |
| 3. Surgical Changes | ✅ 只改 apps/api DB 层；apps/web 新文件不碰已有代码 |
| 4. Goal-Driven | ✅ apps/api tsc 从 6 errors → 0 是可验证目标 |

---

## 下一步候选

- **A14**：前端 route `/admin/work-orders` 注册 + layout 入口
- **A14.1**：工单详情页面（完整 22 字段 + 补偿信息 + SLA 可视化）
- **A14.2**：fsf_subscription_deliveries 投递成功/失败统计面板
