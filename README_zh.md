# AgentX

<p align="center">
  <strong>DeepSeek 原生 AI 编程 Agent 工作台</strong> — 基于 Prefix-Cache 稳定性优化，支持多模型和企业级工作流编排。<br />
  DeepSeek-native AI coding agent harness with prefix-cache optimization and enterprise workflow orchestration.
</p>

<p align="center">
  🔥 DeepSeek-First · 💰 成本控制 · 🔧 多模型支持 · 🎯 插件系统 · 🛡️ 企业级安全
</p>

<p align="center">
  <a href="#-快速开始">快速开始</a> ·
  <a href="docs/">文档</a> ·
  <a href="#-核心功能">核心功能</a> ·
  <a href="#️-路线图">路线图</a> ·
  <a href="#-参与贡献">参与贡献</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache-2.0" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/DeepSeek-V3/R1-0090FF?logo=deepseek&logoColor=white" alt="DeepSeek" />
  <img src="https://img.shields.io/badge/PRs-welcome-ff69b4" alt="PRs welcome" />
  <img src="https://img.shields.io/badge/status-early%20but%20usable-orange" alt="Status" />
</p>

---

## 🤔 什么是 AgentX

AgentX 是基于 AgentX 架构的 **DeepSeek 原生 AI 编程 Agent 工作台**。它利用 Prefix-Cache 稳定性来降低长会话的 Token 成本，融合了 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 和 [DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix) 的最佳实践，提供企业级工作流编排能力。

### 核心特性

- 🔥 **DeepSeek 原生设计** — 原生支持 DeepSeek-V3、DeepSeek-R1、DeepSeek-Coder-V2，优化 Prefix-Cache 稳定性
- 💰 **成本控制** — Prefix-Cache 优化可实现高达 99.82% 的缓存命中率
- 🔧 **多模型支持** — 支持任何 OpenAI 兼容提供商（Qwen、GPT、Claude 等）
- 🎯 **插件系统** — 一切皆插件：hooks、skills、MCP 服务器、工具
- 🛡️ **企业级安全** — 只读边界、凭据隔离、完整审计
- 📊 **食安客服 Agent** — 专为喜茶等品牌设计的六层架构客服系统

## ✨ 核心功能

### 食安客服 Agent

基于 [heytea-food-safety-agent](https://github.com/sjkncs/heytea-food-safety-agent) 项目：

- **六层架构**：L1 意图分类（14类）→ L2 场景路由（28场景）→ L3 对话状态机 → L4 话术库（38K模板 × 10阶段）→ L5 生成管道
- **多轮对话**：支持食安投诉的10阶段响应模板
- **补偿矩阵**：基于严重程度的5级补偿体系
- **合规审计**：3层输出合规检查

### 数据分析工作台

- 🗄️ **28+ 数据源类型** — PostgreSQL、MySQL、DuckDB、SQLite、MongoDB、Redis 等
- 🧠 **企业语义** — Schema 管理、指标定义、字段关系
- 🔒 **默认安全** — 只读查询、凭据隔离、字段脱敏
- 📊 **完整审计** — 每一步可回放、有证据

---

## 🚀 快速开始

### 环境要求

- Node.js 22+
- npm 或 pnpm
- DeepSeek API Key（或 OpenAI 兼容提供商）

### 安装

```bash
# 克隆仓库
git clone https://github.com/sjkncs/agentx.git
cd agentx

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
```

### 配置

编辑 `.env`:

```bash
LLM_PROVIDER=openai-compatible
LLM_MODEL=deepseek-chat  # 或 qwen-plus, gpt-4o 等
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=your-api-key

AUTH_SESSION_SECRET=replace-with-at-least-32-random-characters
AUTH_PUBLIC_BASE_URL=http://127.0.0.1:3000
AUTH_REGISTRATION_MODE=open
AUTH_EMAIL_DELIVERY=test
```

### 运行

```bash
# 构建所有包
npm run build

# 启动 web + API
npm run start
```

打开 `http://127.0.0.1:3000/login`，注册后访问 `/data-tasks`。

---

## 🏗️ 架构

```
AgentX
├── packages/
│   ├── agent-runtime/       # 核心 Agent 运行时 (ReAct + LATS)
│   ├── harness-core/        # Hooks、插件、MCP、沙箱
│   ├── skills/             # Skill 系统 + 食安 skill
│   ├── contracts/          # 共享 TypeScript 接口
│   └── [其他包]
├── apps/
│   ├── web/               # Next.js Web UI
│   ├── api/               # Express API 服务器
│   └── tui/               # 终端 UI
└── services/
    └── inngest-bridge/    # 事件处理
```

---

## 🎨 UI 配置

AgentX 支持自定义 UI 主题，包括 **DeepSeek 风格深色主题**：

| 主题 | 描述 |
|------|------|
| `dark` | 默认深色主题 |
| `deepseek` | DeepSeek 风格紫色强调 (#7c6cf0) |
| `light` | 浅色主题 |
| `soft` | 低对比度暖色调主题 |

### 自定义选项

- 字体族（System UI、Inter、SF Pro 等）
- 字体大小（小、中、大）
- 主题选择
- 强调色选择器

---

## 📚 文档

| 主题 | 链接 |
|------|------|
| 快速开始 | [docs/zh/quick-start.md](docs/zh/quick-start.md) |
| 架构概述 | [docs/zh/architecture/overview.md](docs/zh/architecture/overview.md) |
| 食安 Agent | [packages/skills/src/food-safety/](packages/skills/src/food-safety/) |
| 安全说明 | [docs/zh/security.md](docs/zh/security.md) |

---

## 🗺️ 路线图

- [x] **DeepSeek 原生运行时** — Prefix-Cache 优化、DeepSeek 模型支持
- [x] **食安客服 Agent** — 六层客服架构
- [x] **数据分析工作台** — 多数据源、完整审计
- [ ] **SQLite 持久化** — 持久化服务端存储
- [ ] **Notebook 沙箱** — 服务端 SQL/Python 执行
- [ ] **统一语义层** — 业务指标和实体

---

## 🤝 参与贡献

欢迎为 AgentX 贡献代码！请：

1. 重大变更前先开 Issue 讨论
2. 保持 PR 聚焦于单一功能/修复
3. 提交前运行 `npm run typecheck`
4. 用户可见变更需更新文档

---

## 🙏 致谢

AgentX 基于以下优秀项目构建：

- [DataFoundry](https://github.com/datagallery-lab/datafoundry) — 基础架构
- [Mastra](https://github.com/mastra-ai/mastra) — Agent 运行时模式
- [AG-UI](https://github.com/ag-ui-protocol/ag-ui) — 事件流协议
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — 插件架构
- [DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix) — Prefix-Cache 优化
- [heytea-food-safety-agent](https://github.com/sjkncs/heytea-food-safety-agent) — 食安 Agent 模式

---

## 📄 许可证

Apache License 2.0。参见 [LICENSE](LICENSE)。
