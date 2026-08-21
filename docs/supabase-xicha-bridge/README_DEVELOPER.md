# Developer Guide — datafoundry-enhanced

> 本地开发指南。覆盖：环境准备、启动流程、SQL 迭代、Worker 调试、测试规范。

---

## 1. 环境准备

### 1.1 必需工具

```bash
node --version   # >=20 (建议 22)
docker --version # >=24
docker compose version  # >=2.20
git --version    # >=2.40
psql --version   # postgres client (可选，调试用)
```

### 1.2 首次克隆

```bash
git clone <repo-url>
cd datafoundry-enhanced

# 复制环境变量模板
cp .env.example .env
# 编辑 .env，填入：
#   SUPABASE_SERVICE_ROLE_KEY=<from Supabase Dashboard>
#   DINGTALK_ROBOT_SECRET=<your robot secret>
#   LLM_API_KEY=<your key>
```

### 1.3 Node 依赖

```bash
npm install
# 这会在 apps/web, services/inngest-bridge 等 workspace 安装依赖
```

---

## 2. 数据库初始化（Local）

### 2.1 启动 PostgreSQL

```bash
docker compose up -d postgres redis
sleep 5
```

### 2.2 运行 SQL 迁移

```bash
# 方式 A: docker compose run (推荐，自动在 postgres 服务内执行)
docker compose run --rm db-init

# 方式 B: 手动 psql (需本地安装 postgres client)
for f in docs/supabase-xicha-bridge/{000,001,003,004,005,007,008,010,011,012,013}_*.sql; do
  psql -h localhost -U postgres -d datafoundry -f "$f" || true
done
```

### 2.3 SQL 迭代

修改 `docs/supabase-xicha-bridge/*.sql` 后，重新运行：

```bash
# 只想重跑单个文件：
psql -h localhost -U postgres -d datafoundry \
  -f docs/supabase-xicha-bridge/012_workspace_config.sql

# 想全部重置（破坏性！会重建所有表）：
docker compose down -v   # 删除 volume
docker compose up -d postgres
sleep 5
docker compose run --rm db-init
```

### 2.4 验证

```bash
psql -h localhost -U postgres -d datafoundry -c \
  "SELECT table_name FROM information_schema.tables WHERE table_schema='datafoundry' ORDER BY table_name;"
```

预期输出：`dfd_audit_events`, `dfd_approvals`, `dfd_users`, …, `fsf_work_orders`, `fsf_inngest_events` 等 17 张表。

---

## 3. 应用启动

### 3.1 API Server（Host）

```bash
npm run dev:api
# → http://127.0.0.1:8787
```

### 3.2 Web UI（Host）

```bash
npm run dev:web
# → http://127.0.0.1:3000
```

### 3.3 Inngest Bridge Workers（Docker）

```bash
# 构建镜像（首次或代码变更后）
docker compose build

# 启动 subscriber (subscribe_loop) + verify (SLA monitor)
docker compose up -d inngest-bridge-subscriber inngest-bridge-verify

# 查看日志
docker compose logs -f inngest-bridge-subscriber
docker compose logs -f inngest-bridge-verify

# 重启 worker
docker compose restart inngest-bridge-subscriber
```

### 3.4 生产 Supabase vs Local Postgres

| 场景 | SUPABASE_URL | 说明 |
|---|---|---|
| Local dev | `http://host.docker.internal:5432` | docker compose 直连 host postgres |
| Cloud dev | `https://dklbrmydxbjhccczimoo.supabase.co` | 填入真实 service_role key |
| CI | `http://host.docker.internal:5432` | GitHub Actions 内的 postgres service |

---

## 4. Worker 调试

### 4.1 Dry Run 模式

```bash
# subscriber 不实际发消息，只打印
DRY_RUN=true docker compose up -d inngest-bridge-subscriber
docker compose logs -f inngest-bridge-subscriber | grep DRY_RUN
```

### 4.2 调整 Poll 频率

```bash
POLL_INTERVAL_MS=5000 BATCH_SIZE=1 docker compose up -d inngest-bridge-subscriber
```

### 4.3 直接在 Host 运行 Worker（TypeScript）

```bash
cd services/inngest-bridge
npm install
npx ts-node src/worker.ts
# 或
npx ts-node src/subscribe_loop.ts
npx ts-node src/verify-loop.ts
```

### 4.4 查看 Inngest Events（SQL）

```sql
-- 待处理事件
SELECT event_id, event_name, status, created_at
FROM datafoundry.fsf_inngest_events
WHERE status = 'pending'
ORDER BY created_at DESC LIMIT 20;

-- 最近投递失败记录
SELECT * FROM datafoundry.fsf_subscription_deliveries
WHERE success = false
ORDER BY created_at DESC LIMIT 10;

-- SLA 预警工单
SELECT id, case_no, risk_level, sla_status, sla_deadline
FROM datafoundry.fsf_work_orders
WHERE sla_status IN ('warning', 'breached')
  AND status NOT IN ('resolved', 'closed')
ORDER BY sla_deadline;
```

---

## 5. Web UI 调试

### 5.1 Admin Panels

访问 `/admin` 路径，使用 13 个 tab：
- **工单**：WO 列表 + 详情 + 统计
- **投递**：订阅投递记录 + 重发
- **审计(增强)**：全文搜索 + 时间范围 + CSV 导出

### 5.2 本地热重载

`npm run dev:web` 默认支持热重载。修改 `apps/web/src/app/admin/*.tsx` 后，浏览器自动刷新。

### 5.3 API 调试

```bash
# 手动触发 WO 创建
curl -X POST http://127.0.0.1:8787/api/admin/work-orders/create \
  -H "Content-Type: application/json" \
  -d '{
    "workspace_id": "heytea-bj",
    "category": "foreign_object_external",
    "description": "测试工单",
    "risk_level": "medium",
    "user_id": 1
  }'

# 查询审计日志
curl "http://127.0.0.1:8787/api/admin/audit?workspace_id=heytea-bj&time_range=24h&limit=5"
```

---

## 6. 测试规范

### 6.1 TypeScript

```bash
# Web app (所有 admin panels)
cd apps/web
npx tsc --noEmit --skipLibCheck

# Inngest bridge
cd services/inngest-bridge
npx tsc --noEmit --skipLibCheck
```

### 6.2 Docker Build

```bash
docker compose build
docker compose up -d
docker compose ps  # 确认所有服务 Running
```

### 6.3 Smoke Test

```sql
-- 运行 999_verify_food_safety.sql
psql -h localhost -U postgres -d datafoundry \
  -f docs/supabase-xicha-bridge/999_verify_food_safety.sql
```

预期：所有 check 均通过（check passed）

---

## 7. Branch / Commit 规范

### 7.1 新功能（Supabase Bridge）

```bash
git checkout -b feat/supabase-bridge-Axx
# ... 写代码 ...
git commit -m "feat(supabase-xicha-bridge): Axx description"
git push -u origin HEAD
# → GitHub Actions 自动触发 supabase-bridge-ci.yml
```

### 7.2 SQL 文件命名

```
### 已编号（A01–A20）：
000_install_all.sql           # 基础表
000_install_all_NO_PGRST.sql  # 无 REST overlay
001_init.sql
003_food_safety_schema.sql    # 注意：A02 空缺（未交付）
004_seed_food_safety_demo.sql
005_inngest_gate_rpcs.sql
006_inngest_callback_and_channel_routes.sql
007_event_subscriptions.sql
008_event_workspace_subscription.sql
009_event_verify_loop.sql
010_work_order_rpcs.sql
011_work_order_rpcs.sql
012_workspace_config.sql
013_audit_search.sql

### 新增文件使用下一个编号：
014_event_*.sql
015_*.sql
```

### 7.3 README 交付清单

每交付一个 episode，在 `docs/supabase-xicha-bridge/` 下创建：
- `README_Axx.md` — 交付清单（资产、关键改动、V-gate、状态）
- 附加：`README_*.md`（ERD、SOP 等）