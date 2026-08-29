/**
 * Notebook Dashboard Module — public API surface.
 *
 * Re-exports all public types, repository, executor, routes, and bridges
 * so consumers can import from a single path:
 *
 *   import { NotebookDashboardRepository, executeCell, handleDashboardRequest }
 *     from "@agentx/api/notebook-dashboard";
 *
 * Module structure:
 *
 *   schema.ts         — SQLite schema (3 tables: notebooks, dashboards, cell_runs)
 *   repository.ts    — NotebookDashboardRepository: full CRUD + run audit trail
 *   executor.ts      — executeCell: SQL / Python / AI-prompt cell execution engine
 *   sandbox-python.ts — Python sandbox (import blocklist, disabled builtins, network isolation)
 *   sandbox-executor-bridge.ts — harness-core ProcessSandbox bridge for OS-level enforcement
 *   datalink-bridge.ts — Node.js ↔ DataLink Python microservice integration
 *   routes.ts        — HTTP request routing for notebooks + dashboards
 *   semantic-catalog.ts  — Semantic catalog repository (column descriptions, glossary, contracts)
 *   semantic-grounder.ts — Automatic schema grounding inference engine
 *   semantic-protocol-actions.ts — semantic.context.resolve / analysis.contract.ground implementations
 *   federation-engine.ts   — Cross-datasource federation query planner + executor
 *   federation-mcp-tools.ts — Agent MCP tools for federation (query, plan, register_vtable, register_join)
 */

// ── Schema ────────────────────────────────────────────────────────────────────

export {
  ensureNotebookDashboardSchema,
} from "./schema.js";

// ── Repository ────────────────────────────────────────────────────────────────

export {
  NotebookDashboardRepository,
} from "./repository.js";

// ── Executor ──────────────────────────────────────────────────────────────────

export {
  executeCell,
  type CellExecuteResult,
  type CellExecuteContext,
} from "./executor.js";

export {
  createSandboxExecutorBridge,
  type SandboxExecutorBridgeOptions,
  type ExecutePythonOptions,
  type SandboxLifecycleEvent,
  type PythonExecutionResult,
} from "./sandbox-executor-bridge.js";

// ── Datalink bridge ───────────────────────────────────────────────────────────

export {
  DataLinkApiClient,
  DataLinkMcpClientImpl,
  DataLinkSemanticProviderAdapter,
  createDataLinkNotebookIntegration,
  type DataLinkBridgeConfig,
  type ProfileResult,
  type ColumnProfile,
  type ExploreResult,
  type DataLinkMcpClient,
  type DataLinkNotebookIntegration,
} from "./datalink-bridge.js";

// ── Semantic catalog ─────────────────────────────────────────────────────────

export {
  SemanticCatalogRepository,
  SemanticCatalogError,
} from "./semantic-catalog.js";

export type {
  SemanticCatalog,
  ColumnDescription,
  GlossaryTerm,
  TermBinding,
  DataContract,
  ColumnExpectation,
  RequirementBinding,
} from "./semantic-catalog.js";

export {
  inferSemanticTypes,
  inferGlossaryTerms,
  groundDatasourceSchema,
  type PhysicalSchema,
  type PhysicalTable,
  type PhysicalColumn,
  type SemanticInference,
  type GroundingResult,
} from "./semantic-grounder.js";

export {
  resolveSemanticContext,
  groundAnalysisContract,
  type SemanticContextResolveInput,
  type SemanticContextResolveResult,
  type AnalysisContractGroundInput,
  type AnalysisContractGroundResult,
  type ContractGroundFinding,
} from "./semantic-protocol-actions.js";

export {
  SemanticLayerRepository,
  ensureSemanticLayerSchema,
  type Metric,
  type MetricType,
  type Entity,
  type EntityClassification,
  type LineageNode,
  type LineageEdge,
  type LineageEdgeType,
  type ResolveResult,
} from "./semantic-layer.js";

export {
  handleSemanticLayerRequest,
  type SemanticLayerDeps,
} from "./semantic-layer-routes.js";

// ── Federation ────────────────────────────────────────────────────────────────

export {
  FederationPlanner,
  FederationExecutor,
  extractTableReferences,
  detectJoins,
  type FederatedTable,
  type JoinPair,
  type ExecutionPlan,
  type PlanStep,
  type ExecutionStrategy,
} from "./federation-engine.js";

export {
  FederationTools,
  FEDERATION_TOOLS,
  type McpTool,
  type FederationToolsDeps,
} from "./federation-mcp-tools.js";
