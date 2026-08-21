# A20 — Local Dev Infra + CI

**目标**：docker-compose local dev + .env.example 补充 + supabase-bridge CI workflow。

**资产清单**：
```
docker-compose.yml                (新) Supabase local + Redis + inngest-bridge workers
.env.example                     (改) + Supabase/Inngest/DingTalk/Retry env vars
.github/workflows/supabase-bridge-ci.yml  (新) 6-job CI pipeline
docs/supabase-xicha-bridge/
└── README_A20.md               (新) 交付清单
```

---

## 关键内容

### A20.1: docker-compose.yml

**Services**：
| Service | Image | Port | 说明 |
|---|---|---|---|
| `postgres` | postgres:16-alpine | 5432 | datafoundry schema |
| `redis` | redis:7-alpine | 6379 | reserved (future cache) |
| `db-init` | postgres:16-alpine | — | run-once: applies all 012 SQL files |
| `inngest-bridge-subscriber` | from `services/inngest-bridge` | — | subscribe_loop.ts worker |
| `inngest-bridge-verify` | same | — | verify-loop.ts worker |

**启动命令**：
```bash
docker compose up -d postgres redis
sleep 5
docker compose run --rm db-init
docker compose up -d inngest-bridge-subscriber inngest-bridge-verify
```

**extra_hosts**: `host.docker.internal` for local Supabase access

### A20.2: .env.example

新增 4 个区块：
1. **Inngest Bridge Workers** — SUPABASE_URL, INNGEST_SIGNING_KEY, INNGEST_EVENT_KEY
2. **DingTalk Integration** — DINGTALK_ROBOT_SECRET, DINGTALK_APP_KEY, DINGTALK_APP_SECRET
3. **subscribe_loop Env** — POLL_INTERVAL_MS, BATCH_SIZE, HTTP_TIMEOUT_MS, DRY_RUN
4. **verify-loop Env** — VERIFY_INTERVAL_MS, DISPATCHED_TO
5. **A17 Retry Backoff** — RETRY_MULTIPLIER, RETRY_MAX_DELAY, RETRY_MAX/BASE_DINGTALK

### A20.3: supabase-bridge-ci.yml

**6 个 Job**：
| Job | Timeout | 验证内容 |
|---|---|---|
| `tsc-inngest-bridge` | 5min | TypeScript --noEmit (inngest-bridge) |
| `tsc-web-admin` | 10min | TypeScript --noEmit (web admin panels) |
| `sql-syntax` | 10min | pg_query 解析 .sql 文件 |
| `docker-build` | 15min | `docker build` inngest-bridge image |
| `docs-check` | 5min | 所有 README_A*.md 文件存在 |
| `schema-table-count` | 5min | ERD README ≥17 表 |

**触发条件**：`pull_request` 或 `push main` 触及：
- `services/inngest-bridge/**`
- `docs/supabase-xicha-bridge/**`
- `apps/web/src/app/admin/**`
- `apps/web/src/app/api/admin/**`

---

## V-Gate 结果

| Gate | 期望 | 实际 | 状态 |
|---|---|---|---|
| docker-compose.yml | valid yml | ✅ | |
| CI workflow | valid yml | ✅ | |
| .env.example | env vars added | ✅ | |
| README | README_A20.md | ✅ | |
| Commit | A20 干净 | 4 files | ✅ |

---

## 下一步候选

- **A21**: 本地开发指南 README_DEVELOPER.md（git branch workflow + Supabase studio + inngest-bridge dev）
- **A21.1**: 数据库 migration 版本化脚本命名规范
- **A21.2**: Supabase Edge Functions stub（如果需要）