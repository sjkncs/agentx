# Database Migration Versioning — A21.2

> SQL 文件版本化规范。确保 local dev、staging、production 数据库 schema 一致。

---

## 1. 命名规范

### 1.1 文件名格式

```
{NNN}_{short_description}.sql
```

- `{NNN}`: 3 位数字序号，从 `000` 开始
- `_{short_description}`: 下划线分隔的小写描述
- 必须以 `.sql` 结尾

### 1.2 示例

```
000_install_all.sql
001_init.sql
003_food_safety_schema.sql
004_seed_food_safety_demo.sql
005_inngest_gate_rpcs.sql
```

### 1.3 禁止

- `v1`, `v2` 后缀（如 `003_v1.sql`）
- 日期前缀（如 `20260819_003_xxx.sql`）
- 字母后缀（如 `003a.sql`）

---

## 2. 顺序规则

### 2.1 执行顺序 = 文件名字典序

SQL 文件按字母顺序执行（PostgreSQL `psql -f` 依次运行）。**文件名中的序号必须与依赖顺序一致**。

### 2.2 依赖声明

每个 SQL 文件头部注释声明依赖：

```sql
-- ============================================================
-- 012_workspace_config.sql
-- 依赖: 000_install_all_NO_PGRST.sql（dfd_workspaces, dfd_users 表已存在）
-- ============================================================
```

### 2.3 删除 / 替换旧文件

| 场景 | 操作 |
|---|---|
| 新功能 | 新建文件（下一个序号） |
| 修复 bug | 编辑现有文件（不改序号） |
| 重构 schema | 新建文件 + 注释说明 deprecated |
| 删除表/列 | 始终新建 SQL（不用手动 DROP） |

---

## 3. Migration 分类

### 3.1 分类标签

| 前缀 | 类型 | 示例 |
|---|---|---|
| `000` | 核心表（workspaces, users, sessions, runs） | `000_install_all.sql` |
| `001` | 初始化（seeds, configs） | `001_init.sql` |
| `003–004` | 业务 schema（fsf_work_orders, fsf_inngest_events） | `003_food_safety_schema.sql` |
| `005–008` | 事件系统（gate, subscriptions, routes） | `005_inngest_gate_rpcs.sql` |
| `009–010` | SLA / 验证 | `009_event_verify_loop.sql` |
| `011–012` | 业务 RPC（WO CRUD, config） | `011_work_order_rpcs.sql` |
| `013+` | 扩展功能 | `013_audit_search.sql` |

### 3.2 序号对照表

| 序号 | 文件 | 交付 Episode |
|---|---|---|
| 000 | `000_install_all.sql` / `_NO_PGRST.sql` | A8 |
| 001 | `001_init.sql` | A8 |
| 002 | （空缺） | — |
| 003 | `003_food_safety_schema.sql` | A9 |
| 004 | `004_seed_food_safety_demo.sql` | A9 |
| 005 | `005_inngest_gate_rpcs.sql` | A9 |
| 006 | `006_inngest_callback_and_channel_routes.sql` | A11 |
| 007 | `007_event_subscriptions.sql` | A9 |
| 008 | `008_event_workspace_subscription.sql` | A10 |
| 009 | `009_event_verify_loop.sql` | A10 |
| 010 | `010_work_order_rpcs.sql` | A10, A12 |
| 011 | `011_work_order_rpcs.sql` | A13, A16 |
| 012 | `012_workspace_config.sql` | A17 |
| 013 | `013_audit_search.sql` | A18 |
| 014–020 | （预留） | — |

---

## 4. Idempotent 原则

### 4.1 每个文件可安全重复执行

```sql
-- ✅ 正确：CREATE TABLE IF NOT EXISTS
create table if not exists datafoundry.fsf_work_orders (...);

-- ✅ 正确：CREATE INDEX IF NOT EXISTS
create index if not exists dfd_audit_events_workspace_idx
  on datafoundry.dfd_audit_events (workspace_id, created_at desc);

-- ✅ 正确：CREATE OR REPLACE FUNCTION
create or replace function datafoundry.rpc_audit_search(...);

-- ❌ 错误：直接 CREATE（会报错如果已存在）
create table datafoundry.fsf_work_orders (...);
```

### 4.2 transaction 包装

```sql
begin;
-- 所有 DDL 语句
commit;
-- 每个文件一个事务，失败时自动回滚
```

### 4.3 错误容忍（db-init script）

```bash
# db-init 在 docker-compose.yml 中使用 || true 容忍单文件失败
for f in ...; do
  psql ... -f /sql/$$f || true;
done;
```

但**生产部署必须单独运行每个文件**，不使用 `|| true`。

---

## 5. 验证 SQL

### 5.1 本地验证

```bash
# 运行 999_verify_food_safety.sql
psql -h localhost -U postgres -d datafoundry \
  -f docs/supabase-xicha-bridge/999_verify_food_safety.sql
```

### 5.2 GitHub Actions CI

CI 中的 `sql-syntax` job 验证 `.sql` 文件可被 PostgreSQL 解析。

### 5.3 表数量验证

```sql
SELECT count(*) AS table_count
FROM information_schema.tables
WHERE table_schema = 'datafoundry';
-- 预期: >= 17
```

---

## 6. 生产部署 Checklist

- [ ] 所有 `000_*.sql` 已执行（按顺序）
- [ ] `999_verify_food_safety.sql` 全通过
- [ ] `.env` 中的 `SUPABASE_URL` 指向 production project
- [ ] `SUPABASE_SERVICE_ROLE_KEY` 已填入
- [ ] `docker compose build --pull` 在 staging 验证通过
- [ ] A/B 验证：新表可读、新 RPC 可调用

---

## 7. 回滚策略

PostgreSQL 不支持自动回滚。策略：

| 场景 | 回滚方式 |
|---|---|
| 新增表/列 | 手动 `DROP TABLE / ALTER TABLE DROP COLUMN` |
| 新增 RPC | 手动 `DROP FUNCTION` |
| 数据损坏 | 从备份恢复（Supabase Dashboard → Backups） |
| 安全漏洞 | 立即 patch + incident report |

**不要依赖 migration 文件做回滚**。每次 schema 变更都应在 GitHub issue 中记录回滚 SQL。