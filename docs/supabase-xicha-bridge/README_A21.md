# A21 — Developer Guide + Migration Versioning

**目标**：本地开发指南 + SQL migration 版本化规范。

**资产清单**：
```
Dockerfile                         (新) inngest-bridge multi-stage build (context = repo root)
docker-compose.yml                 (改) context 修正 + ${VAR:-default} env substitution
docs/supabase-xicha-bridge/
├── README_DEVELOPER.md          (新) 本地开发完整指南
├── README_MIGRATION_VERSIONING.md (新) SQL 文件版本化规范
└── README_A21.md               (新) 交付清单
```

---

## 关键内容

### Fix: Dockerfile + docker-compose.yml

- `Dockerfile` 新建于 repo root，多阶段构建（`builder` target）
- `docker-compose.yml` build context 从 `./services/inngest-bridge` → `.`（repo root）
- `dockerfile: Dockerfile` 指向 repo root
- 所有 env var 改用 `${VAR:-default}` 格式（支持 `.env` 文件覆盖）

### A21.1: README_DEVELOPER.md

7 个章节：
1. **环境准备** — node / docker / git / psql
2. **数据库初始化** — docker compose up + db-init + SQL 迭代
3. **应用启动** — api/web (host) + workers (docker)
4. **Worker 调试** — dry-run / poll 频率 / host 运行 / SQL 查询
5. **Web UI 调试** — admin panels / 热重载 / API curl
6. **测试规范** — tsc / docker build / smoke SQL
7. **Branch/Commit 规范** — feat/Axx 命名 / SQL 文件顺序 / README 交付清单

### A21.2: README_MIGRATION_VERSIONING.md

5 个章节：
1. **命名规范** — `NNN_description.sql` 格式，禁止 v1/v2 后缀
2. **顺序规则** — 执行顺序 = 字典序，依赖声明，头部注释
3. **Migration 分类** — 7 类前缀 + 序号对照表（000–013+）
4. **Idempotent 原则** — `IF NOT EXISTS` / `CREATE OR REPLACE` / transaction 包装
5. **验证 + 回滚** — 999_verify_food_safety.sql / 表数量检查 / 回滚策略

---

## V-Gate 结果

| Gate | 期望 | 实际 | 状态 |
|---|---|---|---|
| Dockerfile | multi-stage, context fix | ✅ | |
| docker-compose.yml | valid yml, fixed context | ✅ | |
| README_DEVELOPER.md | 7 sections | ✅ | |
| README_MIGRATION_VERSIONING.md | 5 sections | ✅ | |
| Commit | A21 干净 | 6 files | ✅ |

---

## 下一步候选

- **A22**: Supabase Edge Functions stub（如果需要 server-side cron）
- **A22.1**: `014_*.sql` — SLA 超时自动升级 RPC
- **A22.2**: Front-end WO 状态流转表单（triage → investigation → resolution）