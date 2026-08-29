# AgentX ↔ Full-Stack AI Agent Architecture Mapping

> Reference: [Shen Sean Chen — Sketch the AI Agent System Design](https://www.youtube.com/watch?v=CyLYY_xb5bQ)
> Excalidraw: https://excalidraw.com/#json=XmBaOu2WBkIjHwrs4cJlY,hPW1MOB24bPHbLzHFDt9ww

Generated: 2026-08-19 — Phase 5.6 Commercialization

---

## 1. Reference Architecture (from the talk)

| Layer | Components |
|-------|------------|
| **Observability & Evals** | Metrics, alerts, latency p50/p95, automation rate |
| **Gateway** | Auth/SSO, PII scrubbing, rate-limit, deduplication |
| **Policy / Guardrails** | Capability tokens, RBAC, human approval, read-back |
| **Agents** | Router → Planner → Q&A (CEO/brain) + Summary |
| **Memory** | Relational DB + Vector DB (FAQs/Policies) + Scratchpad |
| **Tools** | External APIs (Shopify, Stripe) + Human Approval |

Target KPIs: Automation ≥ 70%, CSAT > 4.5, p50 < 1s, p95 < 2.5s

---

## 2. AgentX Mapping

| Reference concept | AgentX today | Next step |
|-------------------|-------------------|-----------|
| Observability / Metrics | `metrics.ts`, `alerts.ts`, Admin panels at `/admin/metrics`, `/admin/alerts` | OpenTelemetry exporter; eval harness |
| Gateway Auth/SSO | Auth service, CSRF, workspace membership | PII scrubber; request dedupe |
| RateLimit | Sandbox limits, timeouts | Gateway-level RPS quotas per workspace |
| Policy / Guardrails | RBAC roles, SQL guard, sandbox allowlists | Capability tokens; approval gates for high-impact tools |
| Human Approval | Interaction resume / protocol pause | First-class approval queue UI |
| Router Agent | Protocol selection, orchestrator routing | Explicit Router protocol with intent classification |
| Planner Agent | GoalRuntimeAdapter, LATS, task projector | Domain planners as Skill packages |
| Q&A Agent | Mastra chat agent (system prompt + tools) | Keep as always-on conversational surface |
| Function Calling | MCP tools, Mastra tools, federation tools | Patch adapters; NetworkProxy |
| Deterministic workflow | Scheduled tasks, notebook pipelines | Explicit "workflow vs agent" branch in Planner |
| Vector DB (RAG) | Knowledge service, DataLink semantic graph | Policy/FAQ vector index in Planner RAG step |
| Relational DB | SQLite metadata store (WAL pool) | Primary; keep |
| Scratchpad | Working memory (LibSQL), protocol state store | Document/rename as Scratchpad |
| CRM / Payments | MCP marketplace, policy MCP tools | Example Skill: Shopify/Stripe demo vertical |

---

## 3. Phase 5.6 C deliverables (Observability bar)

| Endpoint | Format | Consumer |
|----------|--------|----------|
| `GET /metrics` | Prometheus text | Prometheus / Grafana |
| `GET /api/v1/admin/metrics/active` | ApiResult envelope | Admin Metrics panel |
| `GET /api/v1/admin/alerts` | ApiResult envelope | Admin Alerts panel |
| `GET /api/v1/admin/alerts/prometheus` | Alertmanager format | Alertmanager |

Collectors wired: notebook cell runs, SQL duration, sandbox blocks/timeouts, agent run status — via `wireMetrics()` in `executor.ts`.

Frontend: `/admin/metrics`, `/admin/alerts` tabs; zh-CN + en i18n.

---

## 4. Recommended next phases

| Phase | Focus |
|-------|-------|
| 5.7 | Guardrails & Human Approval — capability tokens, approval queue UI, read-back |
| 5.8 | Router + Domain Planner Skills — intent Router, `return-planner` Skill, workflow/agent branch |
| 5.9 | Evals — offline eval set, automation rate + latency dashboards, CSAT proxy |
