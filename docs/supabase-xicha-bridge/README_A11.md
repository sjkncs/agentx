# A11 — DingTalk Corp API + Inngest Cloud + Subscriber Docker Profile

**目标**：从 DEMO_TOKEN 钉钉机器人升级到企业真实 corp API，支持 per-workspace 独立 subscribe_loop container。

**资产清单**：
```
docs/supabase-xicha-bridge/
├── 009_corp_dingtalk.sql                    (新) corp API + access_token + https helpers
├── 009_verify_corp_and_profiles.sql         (新) 5 步验收
├── A11_PLAN.md                              (新) V-gate workflow
└── README_A11.md                            (新) 交付清单

services/
├── docker-compose.yml                        (改) +subscriber profile + new envs
└── inngest-bridge/src/
    └── inngest-signature.ts                 (新) verifyInngestSignature() ISV 模式
```

---

## 新 env 完整清单

| ENV | 用途 | 示例 |
|---|---|---|
| `DINGTALK_APP_KEY` | 钉钉 corp API app key | `dingg...` |
| `DINGTALK_APP_SECRET` | 钉钉 corp API app secret | `SEC...` |
| `DINGTALK_AGENT_ID` | 钉钉 corp agent ID | `1000001` |
| `DINGTALK_ROBOT_SECRET` | 机器人 HMAC-SHA256 签名密钥 | `SEC...` |
| `INNGEST_SIGNING_KEY` | Inngest Cloud webhook 签名校验 | `sign_...` |
| `SUBSCRIBER_WORKSPACE_ID` | subscribe_loop 监听哪个 workspace | `heytea-bj` |
| `DEBUG_SIGN=1` | 打印签名 URL 到日志 | `1` |

---

## 启动命令

```bash
# 1. 仅 worker（不发订阅）
docker compose -f services/docker-compose.yml up -d inngest-bridge

# 2. worker + subscriber profile（全 workspace 订阅）
docker compose -f services/docker-compose.yml --profile subscriber up -d

# 3. 加本地 Inngest dev server
docker compose -f services/docker-compose.yml --profile subscriber --profile with-inngest up -d
```

---

## 钉钉 corp API 架构

```
rpc_corp_dingtalk_send(agent_id, userid_list, msg)
    │
    ├─► rpc_dingtalk_app_token(appkey, appsecret)
    │       └─► https://oapi.dingtalk.com/gettoken
    │               └─► access_token（有效期 2h）
    │
    └─► https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2
            └─► { errcode: 0, task_id: ... }
```

**两种钉钉发送模式对比**：

| | 机器人 webhook | Corp API |
|---|---|---|
| API | `/robot/send` | `/topapi/message/corpconversation/asyncsend_v2` |
| 身份 | access_token (robot) | app access_token |
| 接收 | 任何人可加机器人 | 企业内部指定人/部门 |
| 签名 | HMAC-SHA256 URL sign | OAuth2 app token |

---

## V-Gate 结果

| Gate | 期望 | 实际 | 状态 |
|---|---|---|---|
| TS compile (V3.2) | `tsc --noEmit` exit 0 | exit 0 | ✅ |
| TS build (V3.2b) | dist ≥ 29 files | 32 files (`inngest-signature.js`) | ✅ |
| docker-compose subscriber | `df-subscriber-default` + `df-subscriber-bj` | `profiles: ["subscriber"]` × 2 | ✅ |
| apps/web tsc | exit 0 | **环境受限** | ⚠️ |
| Commit | A11 干净 commit | 6 files | ✅ |

### Karpathy 4 原则

| 原则 | 评价 |
|---|---|
| 1. Think Before Coding | ✅ A11_PLAN.md 先写，假设显式说明 |
| 2. Simplicity First | ✅ http helper 用 pg 内置 https.request；Inngest 校验 stub 不冗余 |
| 3. Surgical Changes | ✅ 仅 docker-compose 加 2 service；apps/api 不动 |
| 4. Goal-Driven | ✅ docker compose config 可直接验证 profile |

---

## 下一步候选

- **A12**：apps/api webhook 入口接入 `verifyInngestSignature()`（把 stub 变成真实校验）
- **A12.1**：前端 workspace 切换器（替换 hardcoded 下拉）
- **A12.2**：DINGTALK_APP_KEY/SECRET/AGENT_ID 前端配置 UI
