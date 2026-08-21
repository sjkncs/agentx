# A19 — Schema ERD + Audit Taxonomy + FSF SOP

**目标**：数据库完整文档化 + 事件分类 + SOP 流程图。

**资产清单**：
```
docs/supabase-xicha-bridge/
├── README_ERD.md          (新) 17 表 ERD + Mermaid 图 + 字段表
├── README_AUDIT_FLOW.md  (新) A19.2+19.3 合并：audit taxonomy + FSF SOP + 时序图
└── README_A19.md         (新) 交付清单
```

---

## 关键内容

### A19.1: README_ERD.md

- 17 张表（datafoundry schema）完整列表
- 每表字段 + 类型 + 注释
- Mermaid ER 图（含外键关系）
- 核心 DFD 表关系图（ASCII）
- 总计: 17 表

### A19.2: README_AUDIT_FLOW.md — Part 1

Audit Events Taxonomy：
- 14 个 category（auth → settings）
- 3 个 severity 级别 + 触发条件
- FSF 专用事件（6 个 event_name）
- Workspace config 事件清单

### A19.3: README_AUDIT_FLOW.md — Part 2–6

- Stage 流程图（ASCII + 6 阶段）
- FSF Event 时序图（Mermaid）
- SLA 监控规则（3 风险级别 × 3 状态）
- Delivery Channel 矩阵（6 channels）
- WO Field State Machine
- 关键 SQL RPC 一览表（13 个 RPC）

---

## V-Gate 结果

| Gate | 期望 | 实际 | 状态 |
|---|---|---|---|
| 文件 | 3 个 .md | ✅ | |
| SQL 文件 | 无改动 | ✅ | |
| TS 文件 | 无改动 | ✅ | |
| 交付清单 | README_A19.md | ✅ | |
| Commit | A19 干净 | 3 files | ✅ |

---

## 下一步候选

- **A20**: 数据库迁移脚本（local dev 快速初始化 docker-compose.yml）
- **A20.1**: Supabase local 启动脚本
- **A20.2**: 环境变量示例 .env.example
- **A20.3**: CI/CD GitHub Actions workflow