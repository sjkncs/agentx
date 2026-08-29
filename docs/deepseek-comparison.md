# DeepSeek / Cursor / OpenAI Codex CLI — Comparison with AgentX

> Generated: 2026-08-19. Scope: comparison of three open-source AI coding agent ecosystems
> against the **AgentX** project at `e:\FFD-Downloader-Windows\agentx-enhanced\`.
> All claims about AgentX are grounded in source under `packages/agent-runtime/src/`,
> `packages/harness-core/src/`, and the surrounding `packages/`, `apps/`, `docker/`,
> `services/` trees.

---

## 1. Subject projects

### 1.1 DeepSeek model family (DeepSeek-V3, DeepSeek-R1, DeepSeek-Coder-V2)
DeepSeek-AI is an open-weights model family, not an "agent runtime" per se. It is the
**base layer** that an agent harness like AgentX would wrap. Recent and current
specs as of 2026:

- **DeepSeek-V3** — 671B sparse Mixture-of-Experts, 37B activated per token, 128K
  context, Multi-head Latent Attention (MLA) with low-rank KV compression, auxiliary
  loss-free MoE balancing, multi-token prediction objective, FP8 mixed precision.
  Pre-trained on 14.8T tokens. ([arxiv.org/abs/2412.19437](https://arxiv.org/abs/2412.19437))
- **DeepSeek-R1** — Same 671B MoE skeleton as V3 but post-trained with a 4-stage
  pipeline (cold-start SFT → reasoning RL with GRPO → rejection-sampling SFT → RL
  for all scenarios). Pushed open-weights reasoning to parity with OpenAI o1.
  ([Nature, s41586-025-09422-z](https://www.nature.com/articles/s41586-025-09422-z),
  [DeepSeek-R1 paper notes](https://cameronrwolfe.substack.com/p/grpo))
- **DeepSeek-Coder-V2** — 236B/21B-active (Standard) and 16B/2.4B-active (Lite) MoE
  variants derived from a DeepSeek-V2 mid-checkpoint, extended to 128K via YARN,
  supporting 338 languages. Lite variant uses **Fill-in-the-Middle (PSM)** at 50%
  pretraining rate; instruct models are SFT + GRPO RL on compiler/test feedback.
  ([emergentmind: DeepSeek-Coder-V2 paper](https://www.emergentmind.com/papers/2406.11931))

**Architectural strengths**
- Cost-efficient inference through sparse activation (37B/671B) and MLA-compressed KV
  cache — single-8× H800 training run for V3.
- Strong code + math reasoning when chained: Coder-V2 for code generation, R1 for
  multi-step planning, V3 as the chat fallback. The community has standardised on this
  three-model stack as an open alternative to GPT-4 / Claude 3.5 / o1.
- Open weights under permissive terms → inference can run on-prem or on third-party
  APIs (Fireworks, DeepInfra, Together, local vLLM/SGLang). This is precisely why
  Aider ships DeepSeek as a first-class provider.

**Architectural limits relevant to agentic use**
- No native agent loop, no native tool-use protocol, no built-in sandboxing, no
  state persistence beyond what the application layer (Aider / Cursor / Codex /
  AgentX) adds.
- MoE routing makes tool-call JSON constraints fragile on the base model; most
  harnesses feed DeepSeek with function-calling schemas only via SGLang or
  LiteLLM-rewritten prompts, never the raw Hugging Face checkpoint.
- R1's chain-of-thought is exposed by default and is expensive at 37B activated per
  token; budgets grow fast.

### 1.2 Open-source Cursor-style agents: Continue, Aider, Cline
Cursor itself is closed-source. The three projects the question singles out are the
open-source descendants that share the same lineage (LLM + IDE + agent loop +
multi-file edit):

- **Continue (continuedev/continue)** — Multi-tier (IDE plugin → Core → GUI →
  LLM abstraction over 40+ providers). Now in maintenance ("final 2.0.0") after
  Continue's acquisition by Cursor. Configured via `config.yaml`; ships an
  end-to-end message-passing protocol (`ToCoreProtocol`, `FromCoreProtocol`,
  `Pass-Through` lists). Mission Control for scheduled/event-driven agent workflows.
  ([GitHub: continuedev/continue](https://github.com/continuedev/continue),
  [DeepWiki architecture](https://deepwiki.com/continuedev/continue/2-architecture))
- **Aider (Aider-AI/aider)** — Terminal-native, Git-native, **model-agnostic** via
  `litellm`. Coder base class is the central orchestrator; command/slash system
  builds on top. Five edit strategies (`diff` = SEARCH/REPLACE blocks, `whole` =
  rewrite, `udiff` = unified diff, `patch` = V4A, `func` = JSON tool-calling).
  Architect mode pairs a frontier planner with a cheap editor for cost. Auto-commit
  per turn into a local Git history that doubles as an undo log. Repo-map context
  generation (no whole-tree read). ([DeepWiki: Core Architecture](https://deepwiki.com/Aider-AI/aider/2-core-architecture),
  [Edit Strategies](https://deepwiki.com/Aider-AI/aider/3-edit-strategies-and-code-modification))
- **Cline (cline/cline)** — VS Code extension (now multi-surface: CLI, JetBrains,
  SDK) using a `Controller` → `Task` → `McpHub` core. **HostProvider** abstraction
  over VSCode/JetBrains/CLI hosts. McpHub centralises MCP server lifecycle
  (stdio/SSE/streamable-HTTP transports), chokidar-watched JSON settings, OAuth
  flows, marketplace installation. Strong plugin system on top of an SDK and a
  `.clinerules` project-rule convention. ([DeepWiki: Extension Architecture](https://deepwiki.com/cline/cline/2-extension-architecture),
  [MCP Architecture](https://deepwiki.com/cline/cline/9.1-mcp-architecture))

### 1.3 OpenAI Codex CLI
Open-sourced 2025-04-16, Apache-2.0, written in Rust (`codex-rs/`). ~107k GitHub
stars as of 2026-08. Three surfaces share one engine: TUI, CLI exec mode, and
IDE app-server (VS Code, JetBrains, Cursor, Windsurf). Codex Web + Codex Cloud
for offloaded jobs. ([GitHub: openai/codex](https://github.com/openai/codex),
[DeepWiki: Architecture Overview](https://deepwiki.com/openai/codex/1.3-architecture-overview),
[Bhavishya Pandit substack](https://bhavishyapandit9.substack.com/p/everything-about-codex-the-complete))

Key ideas:
- **ThreadManager + CodexThread + Submission/EventMsg queue** — async, interruptible,
  cancellable from any surface.
- **ToolRouter → built-in shell/patch + McpManager** for external tools. Built-in
  sandbox: `FileSystemSandboxPolicy` plus a network policy proxy.
- **Context compaction + prompt caching** to keep long turns cheap.
- **Git worktrees** isolate parallel jobs on separate working copies of the same
  repo.
- **AGENTS.md** + **SKILL.md** (`~/.agents/skills/`) — project rule + skill format
  that is now cross-platform standard (Cursor, Claude Code, Gemini CLI all read it).
- Skills shipped Dec 2025; create-plan, review-and-reflect patterns are the
  default playbook.
- Approval modes (`suggest`, `auto-edit`, `full-auto`) gate what the agent may touch
  before review.

### 1.4 AgentX (the project under review)
AgentX is a data-analysis-oriented agent harness: `Mastra`-based agent
runtime on top of a custom `harness-core` that exposes hooks, plugins, subagents,
MCP, sandbox, gates, multi-runtime routing, IDE workflows, and a deterministic
session event log. The full code is split into:

- `packages/agent-runtime/` — the `createAgentX` factory. Implements the ReAct
  loop over Mastra tools, AG-UI stream normalisation, context budget processors,
  protocol-based dispatch (`general-task`, `data-analysis`), LATS tree-search
  (optional), long-term memory, working memory (read-only), token-usage correlation
  for per-step display. ([agent-runtime/src/index.ts:301](packages/agent-runtime/src/index.ts))
- `packages/harness-core/` — 10-phase framework: hook bus, session event log,
  Cordis-style plugins, runtime manager (local/remote/VM), subagent
  orchestrator (sequential/parallel/pipeline/fan-out), MCP transport/client/server,
  sandbox (process/vm/docker/webcontainer/wasm), deterministic gates
  (lint/test/typecheck/build/format/coverage), Cursor SDK adapters (Local + Cloud),
  worktree helper, quarantine, marketplace.
  ([harness-core/README_FINAL.md](packages/harness-core/README_FINAL.md))
- `packages/skills/`, `packages/files/`, `packages/knowledge/`, `packages/artifacts/`,
  `packages/data-gateway/`, `packages/providers/`, `packages/supabase-bridge/`,
  `packages/contracts/`, `packages/counterfactual/`, `packages/metadata/`,
  `packages/harness/` — domain-specific services.
- `apps/web`, `apps/api`, `apps/cli`, `apps/tui`, `apps/desktop`,
  `apps/desktop-pyqt` — front-ends and the CLI.
- `docker/python-sandbox/` — Python execution sandbox image bootstrap.

It is closer in spirit to Cursor + Cordis + Codex CLI than to Continue/Aider/Cline,
because it cares about protocols, sandbox policy, pluggable runtimes, and IDE
integration. But its emphasis on **structured data analysis** (data-analysis
protocol, semantic providers, requirement extraction & grounding) is unique.

---

## 2. Axis-by-axis comparison

### 2.1 Agent loop / ReAct pattern

**DeepSeek family** — none. The models are inference-only; they emit text or
function-call JSON. Any loop must be built outside (vLLM tool-call parser, SGLang
function-call, TRL-style agents).

**Continue** — A clear agent loop with perceive → reason → act → observe until a stop
condition. Implementation lives in `core/core.ts` with `invoke()` (request/response)
and `send()` (fire-and-forget) message-passing; config-bound model and tools
([continuedev/continue architecture](https://deepwiki.com/continuedev/continue/2-architecture)).

**Aider** — ReAct-style but tilted toward commit-as-tool-call. The `Coder` base class
(aider/coders/base_coder.py) owns the loop; each iteration renders the prompt,
calls the LLM, parses a chosen edit format, applies the diff, and `git commit`s.
Architect mode separates planner from executor
([DigitalApplied 2026 Aider deep dive](https://www.digitalapplied.com/blog/aider-deep-dive-cli-agentic-coding-tutorial-2026)).

**Cline** — Task is the unit of work. The Controller orchestrates `Task` objects; the
Task runs a ReAct loop that consumes `McpHub` tools, applies edits, requests user
approval at HITL checkpoints, and emits streaming events back to the UI
([DeepWiki Extension Architecture](https://deepwiki.com/cline/cline/2-extension-architecture)).

**OpenAI Codex CLI** — Single coherent loop expressed as a `Submission` → `Op` →
`EventMsg` queue around a `ThreadManager`/`CodexThread`. A "turn" repeats
inference + tool calls until completion. Cancellation interrupts the queue at any
boundary ([DeepWiki Architecture Overview](https://deepwiki.com/openai/codex/1.3-architecture-overview)).

**AgentX** — `createAgentX` builds a Mastra `Agent` with:
- `maxSteps: AGENT_MAX_STEPS` (default 80, configurable via
  `AGENTX_AGENT_MAX_STEPS`, bounds [10, 500]).
- A `GovernedToolFactory` that wraps every tool call with a single dispatcher,
  feeding both `LatsRuntime` and `sessionOutput` ingest.
- Two protocols registered: `general-task` and `data-analysis`. The active
  protocol is selected by `createModelProtocolClassifier` (or `explicitProtocol`)
  and gates which action names (`general.answer.commit`, `analysis.requirements.commit`,
  `data.query.*`, `protocol.handoff.propose`) are even routable
  ([agent-runtime/src/index.ts:538](packages/agent-runtime/src/index.ts)).
- Optional **LATS (Language Agent Tree Search)** mode is a parallel control
  surface — a `MultiPathTrajectory` records tool steps, generates Reflexion text
  for failures, and emits `tree.*` AG-UI custom events for DAG rendering. When
  `enabled: false` (default) the runtime is pure ReAct
  ([agent-runtime/src/lats/lats-runtime.ts:1](packages/agent-runtime/src/lats/lats-runtime.ts)).
- `GoalRuntimeAdapter` wraps Mastra's native goal loop for long-running,
  multi-step objectives with a `judge` model and `maxRuns` (default 10).
- HITL tools (`ask_user`, `submit_plan`) suspend the run and resume on
  `interaction`.

**Gap analysis & recommendations for AgentX**
- *Strength vs peers:* the LATS side-car is something none of the open-source
  peers ship out of the box. The protocol classifier + handoff coordinator is also
  more explicit than Aider's or Continue's ad-hoc mode switching.
- *Gap vs Codex:* Codex's single queue with cancel-from-anywhere is a proven
  pattern for streaming UIs. AgentX's protocol-event path already
  pre-buffers events into `deferredProtocolEvents` and flushes on
  `flushProtocolEvents()` — that is a synchronous handoff. Adding a true
  Submission/EventMsg queue (so an HTTP disconnect / SSE close can drop the run
  mid-turn) would harden cancellation parity with Codex.
- *Recommendation:* tighten the public loop boundary (current
  `createAgentX` returns an `agent: Agent` plus a
  `flushProtocolEvents()`; introduce an explicit `cancel(runId)` /
  `interrupt()` that tears down the queue and aborts in-flight tool calls,
  mirroring Codex). Promote LATS into a first-class peer to ReAct (currently
  `enabled: false` by default).

### 2.2 Context window / token management

**DeepSeek-V3 / R1** — 128K context window with MLA-compressed KV cache, designed
to keep long contexts cheap. No prompt-caching layer in the model itself.

**Continue** — Pipeline of chunking → indexing → retrieval → pruning. Indexes
code via `CodebaseIndexer`; pulls in only relevant snippets.

**Aider** — **Repo-map** is the headline innovation. Instead of stuffing the
window, Aider builds a structural summary of the repo (function/class signatures,
imports) at the level the LLM can absorb. Switched in/out with `/tokens`,
`/map`, `/drop`.

**Cline** — Per-task context, gathered on demand; uses host APIs to read files.

**OpenAI Codex CLI** — Explicit *context compaction* (an OpenAI endpoint that
summarises the conversation when it would overflow) plus heavy prompt caching.
Conversation history can include many turns but the prompt stays small.

**AgentX** — Multiple coordinated layers, the most thorough of any peer:
1. `AgentModelContextProfile` declares per-model `contextWindow`,
   `outputReserve`, `safetyMargin`, `messageOverhead`,
   `toolSchemaOverhead`. Providers return a profile and the runtime respects it.
2. `MastraContextBudgetProcessor` (input) builds a `ContextPackage` per step,
   runs `ContextSourcePolicy` against it, then `ContextStepPlanner` to plan
   which sources land in which planning group, and a
   `ContextPromptMaterializer` to emit the final `ContextPromptView`. Output
   side mirrors with `MastraContextProtocolAdapter`.
3. `contextMaxTokens` (default 32 000, configurable via
   `AGENTX_CONTEXT_MAX_TOKENS`, max 1 000 000) and `contextMaxChars`
   (default 32 000, max 4 000 000) bound what enters the package.
4. **Long-term memory** records (`AgentLongTermMemoryRecord`) are surfaced via a
   `longTermMemory` field and a `readOnlyWorkingMemoryProcessor` exposes
   Mastra's WorkingMemory in markdown template form. Three memory modes:
   `off`, `shadow`, `working-memory-readonly` (configurable via
   `parseAgentMemoryMode`).
5. `TokenUsageCorrelationStore` emits `token_usage.correlation` events so the UI
   can render per-step token counts.
6. `NonEmptyMessageContentCompatProcessor` fixes provider quirks where
   content comes back empty for compatibility.

**Gap analysis & recommendations for AgentX**
- *Strength:* AgentX is **ahead** of every peer here. The policy → planner →
  materializer pipeline is a real production-grade system, not a TODO. Aider's
  repo-map is elegant but lossy by design; AgentX's package model keeps
  full provenance.
- *Gap vs Codex:* Codex uses server-side compaction. AgentX could add a
  similar in-runtime summarizer that fires when `contextMaxTokens` is breached,
  rather than dropping items.
- *Recommendation:* expose `AgentModelContextProfile` as user-facing config
  (today it's an internal type), document the four budget knobs
  (`contextMaxTokens`, `contextMaxChars`, `outputReserve`,
  `safetyMargin`), and add a hookable `compaction` strategy so Codex-style
  summarisation can plug in without rewriting the budget processor.

### 2.3 Tool use protocol (MCP, function calling, custom)

**DeepSeek family** — Native function-calling on the chat-completions endpoint;
no native MCP. Hosts (vLLM, SGLang) implement tool-calling parsers.

**Continue** — MCP via `ConfigHandler` (auto-refresh when MCP connections change).
Tools declared in `config.yaml`. JSON Schema for tool inputs.

**Aider** — JSON function-calling when the model supports it (e.g. `func`
strategy); for older models it parses text. Supports MCP as a relatively recent
addition.

**Cline** — MCP is a first-class concern. `McpHub` (apps/vscode/src/services/mcp/
McpHub.ts) is the singleton manager for all MCP server lifecycles. Three
transports: `StdioClientTransport`, `SSEClientTransport`,
`StreamableHTTPClientTransport`. Tools are `callTool`, resources `readResource`,
prompts `getPrompt`. Settings file (`cline_mcp_settings.json`) is Zod-validated
and chokidar-watched; a `lastConnectionFingerprint` prevents restart loops.
Marketplace `installMarketplaceEntry` reconciles new servers into the hub
([DeepWiki MCP Architecture](https://deepwiki.com/cline/cline/9.1-mcp-architecture),
[Server Management](https://deepwiki.com/cline/cline/9.2-mcp-server-management)).

**OpenAI Codex CLI** — `ToolRouter` dispatches to either built-in shell/patch
tools (with `ShellCommandHandler` + `FileSystemSandboxPolicy`) or external
servers through `McpManager` + `NetworkProxy`. Network policy and FS policy are
explicit.

**AgentX** — Both native function-calling (via Mastra tools) **and** a
self-contained MCP implementation in `harness-core/src/mcp/`:
- `mcp-types.ts` — full JSON-RPC types for requests, responses, notifications.
- `mcp-transport.ts` — `StdioMcpTransport` (spawns child process), HTTP SSE,
  WebSocket, and an `InProcess` transport for tests/embedded use.
- `mcp-client.ts` — JSON-RPC client over any transport.
- `mcp-server.ts` — server that exposes tools/resources/prompts to other
  clients.
- `mcp-bridge.ts` — adapter into AgentX's runtime.
- In `agent-runtime/src/index.ts:533` MCP tools are accepted via
  `mcpTools?: Record<string, ToolAction>` and `mcpToolNames?: string[]` and
  merged into the final `selectedTools` object that the Mastra `Agent`
  receives. The governed factory then routes every call through the same
  policy/dispatcher pipeline.
- The runtime itself also ships built-in tools (`STATIC_AGENT_TOOL_NAMES`):
  `ask_user`, `edit_file`, `execute_command`, `file_stat`, `grep`,
  `inspect_schema`, `list_data_sources`, `list_files`, `mkdir`,
  `preview_table`, `promote_workspace_file`, `list_workspace_files`,
  `read_workspace_file`, `read_file`, `retrieve_knowledge`, `run_sql_readonly`,
  `skill`, `skill_read`, `skill_search`, `submit_plan`, `task_check`,
  `task_complete`, `task_update`, `task_write`, `write_file`, plus a
  `web_search` tool and the data-analysis-only `analysis_requirements_commit`
  and `protocol_handoff` tools. Tool selection is policy-driven: skills carry
  an `allowedTools` / `deniedTools` list and the runtime intersects them with
  an `alwaysAllowTools` set for platform-level guarantees
  (`selectToolsByPolicy`).

**Gap analysis & recommendations for AgentX**
- *Strength:* richer transport set than Cline (Cline has stdio/SSE/streamable-HTTP;
  AgentX also has WebSocket + InProcess). The InProcess transport is a
  nice embedded/test affordance.
- *Gap vs Cline:* no marketplace integration or chokidar-style config
  hot-reload. No OAuth flows for remote MCP servers. No Zod-validated settings
  file.
- *Gap vs Codex:* no built-in `NetworkProxy` for enforcing outbound policy at
  the transport layer.
- *Recommendation:* add a Zod-validated `agentx-mcp.json` settings file
  with chokidar watcher, plumb the OAuth flow used by Cline, expose the
  marketplace install path, and surface network policy as a first-class
  field on `StdioMcpTransport` / `HttpMcpTransport` config.

### 2.4 Multi-file edit / diff application

**DeepSeek family** — Not applicable; downstream agents do the editing.

**Continue** — Inline edits through the IDE; multi-file via the agent's tool
calls. Diff UX is left to the host (VS Code shows the standard diff view).

**Aider** — This is where Aider shines. Strategy-pattern `Coder` subclasses for
five formats: `diff` (SEARCH/REPLACE blocks), `whole` (rewrite the file),
`udiff` (unified diff), `patch` (V4A), `func` (JSON function-call). `diffs.py`
streams partial updates during the model response. Robust fuzzy-matching
prevents "lazy" edits. Architect mode uses `editor-diff` / `editor-whole`
internally. Every accepted edit lands as an atomic Git commit with a
generated message
([DeepWiki: Edit Strategies](https://deepwiki.com/Aider-AI/aider/3-edit-strategies-and-code-modification)).

**Cline** — Per-file edits through `write_to_file` and `replace_in_file` MCP-style
tools, with checkpointing (Git-based checkpoint system per task) so the user can
diff and revert any change.

**OpenAI Codex CLI** — `apply_patch` is the canonical edit format. Codex also
provides a local review agent (`codex review`) that diffs a PR-equivalent change
set against the base.

**AgentX** — Multi-file edits happen through Mastra workspace tools:
`write_file`, `edit_file`, `execute_command`, `mkdir`, `read_file`, `list_files`,
`file_stat`, `grep`. Each successful write is **auto-ingested into session
output** by `maybeIngestSessionFileOutput` / `maybeIngestSessionFileToolResult`
and, when run inside the governed tool factory, lands in the same trace as
every other tool call. There is no dedicated patch-format parser — the harness
relies on the LLM/Mastra tool schema to emit complete files or simple edits.
A `WorktreeHelper` in `harness-core/src/worktree/worktree.ts` provides diff
request/result/file shapes for downstream integration, and a `Quarantine`
module (`harness-core/src/quarantine/quarantine.ts`) gates suspect output
before it lands in the session. `Gates` provide deterministic verification:
lint/test/typecheck/build/format/coverage through pluggable
`GateExecutor`s.

**Gap analysis & recommendations for AgentX**
- *Strength:* the **gating + quarantine + worktree** trio is unusual. Most
  peers lean on user approval; AgentX can require automated verification
  before allowing an edit to leave the sandbox.
- *Gap vs Aider:* no `apply_patch`-style parser. Models that emit Aider's
  SEARCH/REPLACE format won't be understood; models that emit V4A `*** Begin
  Patch` won't be understood. Right now the only edit formats are
  "Mastra tools + zod schemas".
- *Gap vs Cline:* no built-in checkpoint system that snapshots the workspace
  per turn (Cline ships Git-based checkpointing; AgentX has the
  primitives but no UI-driven checkpoint/revert).
- *Recommendation:* add a small patch-format adapter (Aider-style
  SEARCH/REPLACE blocks, V4A `*** Begin Patch`, and Codex `apply_patch`)
  that converts to Mastra `edit_file` calls. Layer in a per-task Git
  checkpoint stored alongside the session event log; reuse `WorktreeHelper`
  + `Quarantine` for snapshot/restore.

### 2.5 Subagent / parallel execution

**DeepSeek family** — Not applicable.

**Continue** — Mission Control schedules agents but they are single-threaded.

**Aider** — Single in-process Coder; no first-class subagents. `Architect mode`
is a planner/editor split within one loop, not parallel.

**Cline** — Multi-agent teams via the Cline SDK (separate `apps/` for
"agents", SDK can register tools and lifecycle hooks). It's the only one of
the three that ships an SDK for building custom multi-agent systems
([cline/cline README](https://github.com/cline/cline)).

**OpenAI Codex CLI** — **Subagents with separate working contexts.** Codex uses
git worktrees so parallel tasks operate on separate working copies; a manager
decomposes work and dispatches it to parallel workers, each with a dedicated
context window. This is the headline Codex parallel pattern
([Bhavishya Pandit substack](https://bhavishyapandit9.substack.com/p/everything-about-codex-the-complete)).

**AgentX** — Two-tier subagent system:
1. **`harness-core/src/subagent/`** — `Subagent` + `SubagentManager` +
   `Orchestrator`. The orchestrator supports four execution modes
   (`sequential`, `parallel`, `pipeline`, `fan-out`), validates the DAG, and
   produces an `OrchestrationResult { taskResults, completedTasks,
   failedTasks, duration, output }`. Subagents carry a `role`, `prompt`,
   dependency list, and can be `fork`ed or `resume`d.
2. **`GoalRuntimeAdapter`** — long-running multi-run objectives with a
   judge model and `maxRuns` (default 10). Different from
   `SubagentManager`: it's about the *outer* "try until success" loop,
   not multi-agent coordination inside one run.
3. **LATS** is the third control surface — tree-search across branches of
   one task, with UCB selection and reflexion on failure.

**Gap analysis & recommendations for AgentX**
- *Strength:* Three orthogonal control surfaces (subagent, goal, LATS)
  is genuinely richer than Codex's single subagent manager and far richer
  than Aider/Continue/Cline (which mostly lack this).
- *Gap vs Codex:* subagents in AgentX share the same filesystem and
  context by default; Codex gives each subagent its own git worktree.
  AgentX has `WorktreeHelper` but it is not wired into the orchestrator.
- *Gap vs Cline:* no SDK to spawn AgentX subagents from external
  processes.
- *Recommendation:* wire `WorktreeHelper` into the `Orchestrator` so each
  parallel `subagent` gets an isolated working copy; expose a public
  `runSubagent({ worktree: true })` flag. Add an opt-in "Codex-style"
  parallel plan-execute-collect flow on top of the existing `fan-out`
  mode.

### 2.6 Memory / state persistence

**DeepSeek family** — Stateless from the model's perspective. State is
provided by the host.

**Continue** — IDE-side state for sessions; persistent via the IDE's own
storage. Configuration persisted via `config.yaml`.

**Aider** — Minimal: chat history per session, repo-map cached. No persistent
"user memory". Git history doubles as change-log memory.

**Cline** — Per-task files and history (`Task Storage`); Git-based checkpoint
system for state snapshots. VS Code `GlobalState` for settings.

**OpenAI Codex CLI** — Session state lives inside Codex Cloud (the
`chatgpt.com/codex` workspace) plus local `~/.codex` config; long history is
server-side. `AGENTS.md` and `~/.agents/skills/` are the persistent knowledge
channels.

**AgentX** — Multi-layer memory:
1. **Long-term memory records** (`AgentLongTermMemoryRecord`) scoped to
   `datasource | session | user` with `confidence`, `kind`, `source_run_id`,
   `datasource_id` — surfaced as `evidenceContextItems`.
2. **Task state runtime** — LibSQLStore-backed Mastra `Memory` instance,
   exposed through `createTaskStateRuntime({ databasePath })`. Same store
   powers tasks (`task_check`, `task_complete`, `task_update`, `task_write`),
   collaboration (`ask_user`, `submit_plan`), and the working-memory bridge.
3. **Working memory** — read-only, markdown template
   `# Conversation Summary\n- Range:\n- Durable facts:\n- User constraints:\n- Open questions:`
   bridged through `MastraConversationMemoryBridge` with mirror-to-thread.
4. **Three memory modes** — `off`, `shadow`, `working-memory-readonly`,
   parsed via `parseAgentMemoryMode` (default `shadow`).
5. **Session event log** (`harness-core/src/eventlog/`) — append-only,
   immutable, supports replay, analytics, timeline recording.
6. **File assets** (`packages/files/`) — promote a session file to the
   cross-session workspace root so other sessions can read it.
7. **Skill cache** — materialised per session into a `skills/` subdir.
8. **Token-usage correlation store** — keeps step ↔ tool-call ↔ token
   alignment for UI display.

**Gap analysis & recommendations for AgentX**
- *Strength:* clearly the richest memory model of any peer. Aider has
  almost none; Continue has IDE sessions; Cline has per-task files; Codex
  has cloud sessions + AGENTS.md. AgentX spans long-term records,
  working memory, event log, file assets, and skill cache in one product.
- *Gap vs Codex:* no `AGENTS.md` reader (AgentX has Skills via
  `packages/skills/` and `selectToolsByPolicy`, but the project-rule
  Markdown convention is different from Codex's `AGENTS.md` / Cursor's
  `CLAUDE.md` / Claude Code's `AGENTS.md`).
- *Recommendation:* read `AGENTS.md` at session start and prepend its
  contents to the system prompt when present, behind a feature flag. Keep
  Skill format for richer packs but allow thin `AGENTS.md` to opt-in
  without a full skill install.

### 2.7 Permission / sandbox model

**DeepSeek family** — Pure inference; no sandbox.

**Continue** — IDE-mediated; user's local permissions apply. Approval is
modelled at the diff level in the IDE.

**Aider** — All edits are user-confirmed by default; auto-commit is opt-in
per session. No OS-level sandbox.

**Cline** — Approval flow per tool call, with explicit HITL checkpoints.

**OpenAI Codex CLI** — **Strongest sandbox story of the peers.** Three
approval modes (`suggest`, `auto-edit`, `full-auto`), an explicit
`FileSystemSandboxPolicy`, and a `NetworkProxy` that enforces outbound
network policy at the tool boundary. Cloud tasks run on a sandboxed VM
preloaded with the repo
([DeepWiki: Architecture Overview](https://deepwiki.com/openai/codex/1.3-architecture-overview)).

**AgentX** — Multi-layer sandbox model in
`packages/harness-core/src/sandbox/` and `packages/agent-runtime/src/`:
- **Five sandbox types** in `sandbox-types.ts`:
  - `process` (subprocess isolation)
  - `vm` (Node.js VM)
  - `docker` (container)
  - `webcontainer` (browser)
  - `wasm` (WebAssembly)
  - `none` (no isolation)
- **Permissions** — `FilePermission` (glob-pattern read/write/execute),
  `NetworkPermission` (host/port/protocol), `EnvPermission` (var name
  pattern + allow flag), `allowSubprocess`, `allowNetwork`.
- **Resource limits** — `maxMemoryMB`, `maxCpuPercent`, `maxExecutionMs`,
  `maxDiskMB`.
- **Status machine** — `created` → `running` → `stopped`/`error`,
  with `EventEmitter` `status:change`, `execution:start`, `execution:end`,
  `error`, `destroy` events.
- **Quarantine** (`harness-core/src/quarantine/quarantine.ts`) — gates
  suspect tool output before it lands in the session.
- **In agent-runtime** — every tool call goes through
  `GovernedToolFactory`, which dispatches observations and runs
  `maybeIngestSessionFileToolResult` so writes are mirrored into session
  output only when eligible (drafts/scripts stay workspace-only). Aborts are
  respected via `throwIfAborted` on the `abortSignal`.
- **Workspace isolation** — `createRunWorkspace` resolves a
  `sessionDir = {workspaceRoot}/{userId}/{sessionId}/...` so sessions cannot
  see each other's drafts; `promote_workspace_file` is the explicit
  cross-session bridge.
- **Python sandbox** — `docker/python-sandbox/sandbox-bootstrap.py` (194
  lines) is a Docker-based Python sandbox image; resolves a Python runtime
  via `resolvePythonRuntime`.
- **Isolation mode** — `createAgentX` returns `isolation: "bwrap" |
  "none" | "seatbelt"` (Linux bubblewrap, none, macOS sandbox-exec). The
  Docker sandbox is wired separately.

**Gap analysis & recommendations for AgentX**
- *Strength:* five sandbox types + a quarantine layer + a governed tool
  factory + abort signals is materially more thorough than Aider/Continue/
  Cline. Closer in spirit to Codex's `FileSystemSandboxPolicy`.
- *Gap vs Codex:* no `NetworkProxy`. No approval-mode toggle that the
  user picks up-front (`suggest | auto-edit | full-auto`). The closest
  thing is `commandExecutionEnabled` (a boolean on the workspace) and
  `HITL_TOOL_NAMES` (`ask_user`, `submit_plan`).
- *Gap vs Codex:* cloud-side sandbox VM is not present; AgentX runs
  everything on the user's box today. This is the single biggest UX gap
  with Codex Cloud.
- *Recommendation:* introduce a `RunPolicy { approvalMode, fsPolicy,
  netPolicy }` that mirrors Codex's three-mode approval and pass it
  through `createAgentX`. Add a `NetworkProxy` guard in
  `McpTransport`. Document the `bwrap | seatbelt | none` isolation mode
  picker; consider a Windows-native alternative (AppContainer / WSL2) for
  parity with `bwrap` on Linux and `seatbelt` on macOS.

### 2.8 Telemetry / observability

**DeepSeek family** — None at the model layer; downstream tooling does it.

**Continue** — Anonymous telemetry was *removed* in the final 2.0.0 release
([continuedev/continue README](https://github.com/continuedev/continue)).

**Aider** — Lightweight: `aider --analytics` opt-in; token counts visible
per session.

**Cline** — Per-task history in VS Code storage; no central telemetry
plumbing.

**OpenAI Codex CLI** — OpenAI-side observability for cloud tasks;
local-side session logging; AGENTS.md / SKILL.md logs.

**AgentX** — Strongest observability story of any peer:
1. **AG-UI custom events** are emitted for everything: `goal.updated`,
   `tree.*`, `token_usage.correlation`, protocol events, context compiled
   events, custom events via `createCustomEvent`. The web app
   (`apps/web/src/app/data-tasks/components/task-console/`) renders them in
   `live-run-state.ts`.
2. **Context-budget compiled events** (`mastra-context-compiled-event`)
   capture the source-policy decisions per step so the user can see why
   context was dropped.
3. **Token-usage correlation** — `createTokenUsageCorrelationStore` keeps a
   step ↔ tool-call-id ↔ tool-name map, emitted as
   `token_usage.correlation`.
4. **Event-log** — append-only, immutable session event log + timeline
   recorder + analytics.
5. **Hook bus** — every event can be intercepted; `hook:blocked` system
   event lets listeners react to a blocked tool call.
6. **Performance test** — `harness-core/src/__tests__/performance.test.ts`
   exists; smoke scripts in `scripts/` (`smoke-trace-sections.mjs`,
   `smoke-context-compilation.mjs`, `smoke-agent.log`, etc.) verify the
   trace sections and context compilation pipeline end-to-end.

**Gap analysis & recommendations for AgentX**
- *Strength:* **ahead of every peer** in this category.
- *Gap:* no OpenTelemetry export. A grep for `opentelemetry`, `otel`,
  `tracing` finds no first-class OTEL exporter in the agent-runtime or
  harness-core source.
- *Recommendation:* add an OTEL bridge that exports AG-UI custom events
  as spans. Specifically: one span per agent step, child spans per tool
  call, attributes for `agent.run.id`, `agent.run.user_id`, `agent.run.session_id`,
  `tool.name`, `tool.call_id`, token counts. Drop-in exporters for OTLP/HTTP
  and a console exporter for dev.

### 2.9 Extension points (plugins, hooks)

**DeepSeek family** — None.

**Continue** — `config.yaml` profiles, MCP servers, custom slash commands.

**Aider** — `/commands`, voice loop, model swap. Limited plugin API.

**Cline** — **Strongest extension story** of the three: plugin SDK,
`@cline/core`, `@cline/agents`, `.clinerules` project rules, MCP marketplace,
custom tools via SDK
([cline/cline README](https://github.com/cline/cline)).

**OpenAI Codex CLI** — `AGENTS.md`, `~/.agents/skills/`, MCP servers,
approval modes.

**AgentX** — Most explicit of any peer:
- **Hook bus** (`harness-core/src/hooks/`) — typed `HookEvent`s, `HookBus`,
  `HookRegistry`, `HookExecutor`, `HookAdapter`. Listeners can `block`
  execution by returning `{ blocked: true }`. Filters on `toolName`,
  `toolPattern`, `errorType`, `phase`. Default timeout 60s, configurable
  concurrency.
- **Plugin system** — `PluginRegistry`, `ServiceRegistry`, `Profile`,
  `Bundle`, `createPlugin`. Cordis-style `apply(ctx)` lifecycle that can
  `ctx.registerService('name', impl)`.
- **Marketplace** (`harness-core/src/marketplace/`) — entry points for
  installing plugins/skills.
- **Multi-runtime** — `LocalRuntime`, `RemoteRuntime`, `RuntimeManager`,
  `routing.ts` to pick a runtime per task.
- **MCP** as both client and server.
- **Skills** as a packaged extension (zip or `SKILL.md`) with
  `allowedTools` / `deniedTools`, `defaultDbIds`, `defaultKbIds`,
  `defaultMcpIds`, `defaultEnabled`, `modelProfileId`. Format is similar
  in spirit to Codex's `~/.agents/skills/` but with stricter typed
  packaging.
- **Gates** — pluggable `GateExecutor`s (lint, test, typecheck, build,
  format, coverage).

**Gap analysis & recommendations for AgentX**
- *Strength:* Cordis-style service registry + hook bus + pluggable gate
  executors + marketplace + skills is the most layered extension model
  of any project reviewed.
- *Gap vs Cline:* no published SDK npm package; the `packages/harness/`
  package exists but isn't framed as a public SDK.
- *Gap vs Codex:* skills format overlaps with `~/.agents/skills/`, but
  the import/install story (`zip` + YAML manifest) is heavier than Codex's
  plain `SKILL.md`.
- *Recommendation:* repackage the harness core + hook bus + plugin
  registry as `@agentx/sdk`, document the hook event surface as a
  stable contract (deprecate fields with grace periods), and align the
  skills format with the cross-platform `SKILL.md` convention so a Codex/
  Claude/Cursor skill can be loaded unchanged.

---

## 3. Summary scorecard

| Axis | DeepSeek family | Continue | Aider | Cline | OpenAI Codex CLI | AgentX | Lead |
|------|------------------|----------|-------|-------|------------------|-------------|------|
| Agent loop / ReAct | n/a | Solid | Coder-centric, Git-native | Controller + Task | Queue-based, interruptible | ReAct + LATS + Goal + Protocol | AgentX (control surfaces) / Codex (cancellable queue) |
| Context / tokens | 128K + MLA | Index pipeline | Repo-map | On-demand gather | Compaction + caching | Policy → planner → materializer, profile-driven | AgentX |
| Tool use | Function-call | config.yaml + MCP | Function-call + strategies | MCP-first (3 transports) | ToolRouter + McpManager + NetworkProxy | 4 MCP transports + governed tool factory | Cline / AgentX tie |
| Multi-file edit | n/a | IDE diff | 5 strategies + Git commit | Per-file + checkpoints | apply_patch + review agent | Mastra tools + gating + quarantine + worktree | Aider (format richness) / AgentX (verification) |
| Subagents | n/a | Mission Control (single) | Architect (1 split) | SDK multi-agent | Worktree-isolated parallel | Orchestrator + Goal + LATS | AgentX |
| Memory / state | None | IDE sessions | Git history | Task storage | Cloud sessions + AGENTS.md | LTM + working memory + event log + files + skills | AgentX |
| Permission / sandbox | None | IDE | Confirm-per-edit | Per-tool approval | `FileSystemSandboxPolicy`, 3 approval modes, NetworkProxy, cloud VM | 5 sandbox types + permissions + governed factory + quarantine | Codex (NetworkProxy, cloud VM) / AgentX (sandbox breadth) |
| Telemetry / observability | None | Removed | Token counts | Task history | Cloud logging | AG-UI events + event log + token correlation + context-budget events + hooks | AgentX |
| Extension points | None | config.yaml + MCP | `/commands` | Plugin SDK + MCP marketplace + `.clinerules` | AGENTS.md + skills + MCP | Hooks + plugins + marketplace + skills + gates + multi-runtime | AgentX |

---

## 4. Recommendations — what AgentX should adopt

Ranked by expected leverage:

1. **Adopt Codex's `FileSystemSandboxPolicy` + 3-mode approval pattern.**
   Introduce a `RunPolicy { approvalMode: "suggest" | "auto-edit" |
   "full-auto", fsPolicy, netPolicy }` and pipe it through `createAgentX`.
   This single change brings AgentX to parity with Codex's most-loved
   safety feature while reusing the existing governed factory.

2. **Add a `NetworkProxy` at the MCP / web-search boundary.** Codex and Cline
   treat outbound network as a typed policy object; AgentX currently
   doesn't. Add it to `StdioMcpTransport` and `HttpMcpTransport` config and
   surface it as a hook on `web_search` tool.

3. **Wire `WorktreeHelper` into `Orchestrator`** so a `parallel` subagent run
   gets one worktree per branch (matches Codex's git-worktree isolation).
   Single-line change in the orchestrator; large UX win.

4. **Adopt the cross-platform `AGENTS.md` convention** as a thin alternative
   to the heavier Skill package. Read at session start, prepend to system
   prompt, no install required. Backward compatible.

5. **Patch-format adapters.** Add Aider-style SEARCH/REPLACE and Codex
   `apply_patch` adapters that translate to `edit_file` tool calls. Lets
   AgentX use models that were tuned for those formats without
   retraining.

6. **OpenTelemetry exporter** for AG-UI custom events. One span per step,
   child spans per tool call, attributes for IDs and token counts. Drop-in
   for any OTEL-compatible backend.

7. **Cancellation as a first-class API.** Mirror Codex's `Submission`
   cancellation — `cancel(runId)` that aborts the in-flight LLM call and
   tool calls, tears down the governed factory, and emits a final event.

8. **Context compaction summarizer** that fires when `contextMaxTokens` is
   breached. Codex uses a server-side endpoint for this; AgentX can
   do it client-side via a small model call or hookable strategy.

9. **Publish `@agentx/sdk`** so external processes can spawn
   AgentX subagents (parity with Cline SDK). The hook bus, plugin
   registry, and runtime manager are already the right shape.

10. **Stable skill format that cross-loads with Codex/Claude/Cursor.**
    Today AgentX requires the zip + YAML manifest; a thin `SKILL.md`
    import path lowers the friction for users migrating from other tools.

---

## 5. Sources

- DeepSeek-V3 — [arxiv.org/abs/2412.19437](https://arxiv.org/abs/2412.19437),
  [DeepWiki MoE](https://deepwiki.com/deepseek-ai/DeepSeek-V3/4.3-mixture-of-experts-(moe))
- DeepSeek-R1 — [Nature, s41586-025-09422-z](https://www.nature.com/articles/s41586-025-09422-z),
  [UnfoldAI overview](https://unfoldai.com/deepseek-r1/),
  [Fireworks deepdive](https://fireworks.ai/blog/deepseek-r1-deepdive),
  [GRPO explainer](https://cameronrwolfe.substack.com/p/grpo)
- DeepSeek-Coder-V2 — [Emergent Mind paper](https://www.emergentmind.com/papers/2406.11931),
  [DeepWiki architecture](https://deepwiki.com/deepseek-ai/DeepSeek-Coder-V2/2-model-architecture)
- Continue — [github.com/continuedev/continue](https://github.com/continuedev/continue),
  [DeepWiki architecture](https://deepwiki.com/continuedev/continue/2-architecture)
- Aider — [DeepWiki: Core Architecture](https://deepwiki.com/Aider-AI/aider/2-core-architecture),
  [DeepWiki: Edit Strategies](https://deepwiki.com/Aider-AI/aider/3-edit-strategies-and-code-modification),
  [DigitalApplied 2026 deep dive](https://www.digitalapplied.com/blog/aider-deep-dive-cli-agentic-coding-tutorial-2026)
- Cline — [github.com/cline/cline](https://github.com/cline/cline),
  [DeepWiki: Extension Architecture](https://deepwiki.com/cline/cline/2-extension-architecture),
  [DeepWiki: MCP Architecture](https://deepwiki.com/cline/cline/9.1-mcp-architecture),
  [DeepWiki: MCP Server Management](https://deepwiki.com/cline/cline/9.2-mcp-server-management)
- OpenAI Codex CLI — [github.com/openai/codex](https://github.com/openai/codex),
  [DeepWiki: Architecture Overview](https://deepwiki.com/openai/codex/1.3-architecture-overview),
  [Bhavishya Pandit, Everything About Codex](https://bhavishyapandit9.substack.com/p/everything-about-codex-the-complete),
  [Techjack 2026 guide](https://techjacksolutions.com/ai-tools/openai-codex/),
  [Medium 2026 skills overview](https://medium.com/@unicodeveloper/9-must-have-skills-for-codex-in-2026-b5124b375eec)
- AgentX — `packages/agent-runtime/src/index.ts`,
  `packages/agent-runtime/src/runtime-limits.ts`,
  `packages/agent-runtime/src/config/agent-runtime-limits.ts`,
  `packages/agent-runtime/src/lats/lats-runtime.ts`,
  `packages/agent-runtime/src/memory/task-state-runtime.ts`,
  `packages/agent-runtime/src/memory/conversation-memory-bridge.ts`,
  `packages/agent-runtime/src/context/protocol/mastra/mastra-context-budget-processor.ts`,
  `packages/agent-runtime/src/stream/token-usage-correlation.ts`,
  `packages/harness-core/README_FINAL.md`,
  `packages/harness-core/src/hooks/hook-bus.ts`,
  `packages/harness-core/src/subagent/orchestrator.ts`,
  `packages/harness-core/src/sandbox/sandbox.ts`,
  `packages/harness-core/src/sandbox/sandbox-types.ts`,
  `packages/harness-core/src/mcp/mcp-transport.ts`,
  `packages/harness-core/src/worktree/worktree.ts`,
  `packages/harness-core/src/quarantine/quarantine.ts`,
  `packages/harness-core/src/marketplace/marketplace.ts`,
  `packages/skills/src/index.ts`,
  `docker/python-sandbox/sandbox-bootstrap.py`