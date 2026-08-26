# AgentX

<p align="center">
  <strong>DeepSeek-native AI coding agent harness</strong> — engineered around prefix-cache stability, multi-model support, and enterprise-grade workflow orchestration.<br />
  基于 DeepSeek Prefix-Cache 稳定性的 AI 编程 Agent，支持多模型和工作流编排。
</p>

<p align="center">
  🔥 DeepSeek-First · 💰 Cost Control · 🔧 Multi-Model · 🎯 Plugin System · 🛡️ Enterprise Ready
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> ·
  <a href="docs/">Docs</a> ·
  <a href="#-features">Features</a> ·
  <a href="#️-roadmap">Roadmap</a> ·
  <a href="#-contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache-2.0" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/DeepSeek-V3/R1-0090FF?logo=deepseek&logoColor=white" alt="DeepSeek" />
  <img src="https://img.shields.io/badge/PRs-welcome-ff69b4" alt="PRs welcome" />
  <img src="https://img.shields.io/badge/status-early%20but%20usable-orange" alt="Status" />
</p>

---

## 🤔 What Is AgentX

AgentX is a **DeepSeek-native AI coding agent harness** built on the DataFoundry foundation. It leverages prefix-cache stability to minimize token costs across long coding sessions, combining the best practices from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and [DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix) with enterprise-grade workflow orchestration.

### Key Features

- 🔥 **DeepSeek-First Design** — Native support for DeepSeek-V3, DeepSeek-R1, and DeepSeek-Coder-V2 with optimized prefix-cache stability
- 💰 **Cost Control** — Prefix-cache optimization reduces token costs by up to 99.82% cache hit rate
- 🔧 **Multi-Model Support** — Works with any OpenAI-compatible provider (Qwen, GPT, Claude, etc.)
- 🎯 **Plugin System** — Everything is a plugin: hooks, skills, MCP servers, tools
- 🛡️ **Enterprise Security** — Read-only boundaries, credential isolation, audit trails
- 📊 **Food Safety Agent** — Specialized customer service agent for HXX with 6-layer architecture

## ✨ Core Capabilities

### Food Safety Customer Service Agent

Based on the [HXX-food-safety-agent](https://github.com/sjkncs/HXX-food-safety-agent) project:

- **6-Layer Architecture**: L1 intent classification (14 types) → L2 scenario routing (28 scenarios) → L3 dialogue state machine → L4 script library (38K templates × 10 stages) → L5 generation pipeline
- **Multi-turn Conversation**: Supports 10-stage response templates for food safety complaints
- **Compensation Matrix**: 5-level compensation system based on severity
- **Compliance Auditing**: 3-layer output compliance checking

### Data Analysis Workbench

- 🗄️ **28+ datasource types** — PostgreSQL, MySQL, DuckDB, SQLite, MongoDB, Redis, and more
- 🧠 **Enterprise semantics** — Schema management, metric definitions, field relationships
- 🔒 **Safe by default** — Read-only queries, credential isolation, field masking
- 📊 **Full audit trail** — Every step replayable with evidence

---

## 🚀 Quick Start

### Prerequisites

- Node.js 22+
- npm or pnpm
- DeepSeek API key (or OpenAI-compatible provider)

### Installation

```bash
# Clone the repository
git clone https://github.com/sjkncs/agentx.git
cd agentx

# Install dependencies
npm install

# Configure environment
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
```

### Configuration

Edit `.env`:

```bash
LLM_PROVIDER=openai-compatible
LLM_MODEL=deepseek-chat  # or qwen-plus, gpt-4o, etc.
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=your-api-key

AUTH_SESSION_SECRET=replace-with-at-least-32-random-characters
AUTH_PUBLIC_BASE_URL=http://127.0.0.1:3000
AUTH_REGISTRATION_MODE=open
AUTH_EMAIL_DELIVERY=test
```

### Run

```bash
# Build all packages
npm run build

# Start web + API
npm run start
```

Open `http://127.0.0.1:3000/login`, register, and go to `/data-tasks`.

---

## 🏗️ Architecture

```
AgentX
├── packages/
│   ├── agent-runtime/       # Core agent runtime (ReAct + LATS)
│   ├── harness-core/        # Hooks, plugins, MCP, sandbox
│   ├── skills/             # Skill system + food-safety skill
│   ├── contracts/          # Shared TypeScript interfaces
│   └── [other packages]
├── apps/
│   ├── web/               # Next.js web UI
│   ├── api/               # Express API server
│   └── tui/               # Terminal UI
└── services/
    └── inngest-bridge/    # Event processing
```

---

## 🎨 UI Configuration

AgentX supports customizable UI themes including a **DeepSeek-style dark theme**:

| Theme | Description |
|-------|-------------|
| `dark` | Default dark theme |
| `deepseek` | DeepSeek-style purple accent (#7c6cf0) |
| `light` | Light theme |
| `soft` | Low-contrast warm theme |

### Customization Options

- Font family (System UI, Inter, SF Pro, etc.)
- Font size (Small, Medium, Large)
- Theme selection
- Accent color picker

---

## 📚 Documentation

| Topic | Link |
|-------|------|
| Quick Start | [docs/en/quick-start.md](docs/en/quick-start.md) |
| Architecture | [docs/en/architecture/overview.md](docs/en/architecture/overview.md) |
| Food Safety Agent | [packages/skills/src/food-safety/](packages/skills/src/food-safety/) |
| Security | [docs/en/security.md](docs/en/security.md) |

---

## 🗺️ Roadmap

- [x] **DeepSeek-native runtime** — Prefix-cache optimization, DeepSeek model support
- [x] **Food Safety Agent** — 6-layer customer service architecture
- [x] **Data Analysis Workbench** — Multi-datasource, full audit trail
- [ ] **SQLite persistence** — Durable server-side storage
- [ ] **Real notebook sandbox** — Server-side SQL/Python execution
- [ ] **Unified semantic layer** — Business metrics and entities

---

## 🤝 Contributing

AgentX welcomes contributions! Please:

1. Open an issue for major changes
2. Keep PRs focused on one feature/fix
3. Run `npm run typecheck` before submitting
4. Update docs for user-facing changes

---

## 🙏 Acknowledgements

AgentX is built on the shoulders of giants:

- [DataFoundry](https://github.com/datagallery-lab/datafoundry) — Foundation architecture
- [Mastra](https://github.com/mastra-ai/mastra) — Agent runtime patterns
- [AG-UI](https://github.com/ag-ui-protocol/ag-ui) — Event stream protocol
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — Plugin architecture
- [DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix) — Prefix-cache optimization
- [HXX-food-safety-agent](https://github.com/sjkncs/HXX-food-safety-agent) — Food safety agent patterns

---

## 📄 License

Apache License 2.0. See [LICENSE](LICENSE).
