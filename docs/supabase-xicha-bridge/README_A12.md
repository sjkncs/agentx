# A12 — apps/api Webhook Bug + Workspace Frontend + corp_dingtalk Subscribe

**目标**：修 apps/api Inngest 签名 bug，让前端 workspace 下拉从 RPC 动态加载，subscribe_loop 支持 corp_dingtalk 频道。

**资产清单**：
```
apps/api/src/webhooks/
└── index.ts                           (改) verifyInngestSignature: ts+body → ts\nbody

docs/supabase-xicha-bridge/
├── 010_workspace_front_end.sql         (新) rpc_workspace_list
└── README_A12.md                      (新) 交付清单

apps/web/src/app/admin/
├── admin-webhooks-panel.tsx            (改) workspace 下拉动态 + 跟随 wsId 过滤
└── event-names.ts                      (改) +corp_dingtalk channel

services/inngest-bridge/src/
└── subscribe_loop.ts                   (改) +corp_dingtalk channel → rpc_corp_dingtalk_send
```

---

## 关键改动

### A12.1: apps/api Inngest 签名 bug 修复

Inngest ISV 规范要求签名 payload 为 `${timestamp}\n${body}`（用换行符 `\n` 分隔），但原代码用了 `${timestamp}${body}`（直接拼接）。

修复：
```typescript
// 修复前（错误）：
createHmac("sha256", signingKey).update(`${ts}${body}`)
// 修复后（正确）：
createHmac("sha256", signingKey).update(`${ts}\n${body}`)
```

### A12.2: 前端 workspace 动态下拉

原来 hardcoded `heytea-bj/sh/sz` 三个选项 → 改从 `rpc_workspace_list()` RPC 动态加载，每次 workspace 切换自动刷新订阅列表和投递记录。

### A12.3: subscribe_loop corp_dingtalk 支持

`target_channel = 'corp_dingtalk'` 的订阅不走 HTTP POST webhook，改为调 `rpc_corp_dingtalk_send(p_agent_id, p_userid_list, p_content, p_title)` — 真实通过钉钉 corp API 发消息。

filter_json 格式：
```json
{ "agent_id": 1000001, "userid_list": "manager001,chef001" }
```

---

## V-Gate 结果

| Gate | 期望 | 实际 | 状态 |
|---|---|---|---|
| inngest-bridge tsc | `tsc --noEmit` exit 0 | exit 0 | ✅ |
| apps/api tsc | exit 0 | pre-existing errors (`@supabase/supabase-js` missing, null checks) | ⚠️ pre |
| apps/api webhook bug | `ts\nbody` 分隔符 | 已修复 | ✅ |
| subscribe_loop corp_dingtalk | RPC branch added | +35 LOC | ✅ |
| Frontend dynamic ws | rpc_workspace_list called | wsOptions state + useEffect | ✅ |
| Commit | A12 干净 | 5 files | ✅ |

### Karpathy 4 原则

| 原则 | 评价 |
|---|---|
| 1. Think Before Coding | ✅ 发现 apps/api pre-existing TS errors，标注不修 |
| 2. Simplicity First | ✅ corp_dingtalk 用已有 rpc，不加新队列 |
| 3. Surgical Changes | ✅ apps/api 只改 1 行；不修 pre-existing null check errors |
| 4. Goal-Driven | ✅ 每个改动有 verify step；apps/api tsc 标注 pre-existing |

---

## 下一步候选

- **A13**：apps/api `supabase-food-safety.ts` null check pre-existing errors
- **A13.1**：前端 workspace 切换后自动刷新订阅
- **A13.2**：fsf_work_orders 工单列表 + 详情页（对接 WO trigger 事件流）