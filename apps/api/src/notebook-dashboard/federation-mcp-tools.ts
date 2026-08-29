/**
 * MCP tools for cross-datasource federation queries.
 *
 * These tools are registered with the MCP tool registry and provide the
 * data-analysis protocol with federation capabilities.
 *
 * Tools:
 *   federation.query  — execute a cross-datasource SQL query
 *   federation.plan   — preview the execution plan without running it
 *   federation.list  — list registered virtual tables and join paths
 *   federation.register_vtable  — register a virtual table spanning multiple datasources
 *   federation.register_join   — register a known join relationship
 */
import { FederationPlanner, FederationExecutor, type ExecutionPlan, type FederationQueryResult } from "./federation-engine.js";
import { SemanticCatalogRepository } from "./semantic-catalog.js";
import { ensureFederationSchema } from "./federation-schema.js";
import type { LocalDataGateway, SqlExecutionResult } from "@agentx/data-gateway";
import type Database from "better-sqlite3";

export interface FederationToolsDeps {
  gateway: LocalDataGateway;
  /** In-memory or file-based SQLite for federation metadata. */
  federationDb?: Database.Database;
  /** Optional DuckDB adapter for cross-dialect federation. */
  duckDbAdapter?: { runSqlReadonly: (sql: string) => Promise<{ columns: string[]; rows: unknown[][]; row_count: number }> };
  /** Semantic catalog repository (for cross-datasource semantic joins). */
  semanticRepo?: SemanticCatalogRepository;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions (MCP tool schema)
// ─────────────────────────────────────────────────────────────────────────────

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const FEDERATION_TOOLS: McpTool[] = [
  {
    name: "federation.query",
    description: "Execute a SQL query that spans multiple datasources. The federation engine automatically detects which datasources are involved and selects the best execution strategy: native pushdown (same dialect), DuckDB federation (cross-dialect), or materialized staging (large datasets).",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SQL query — may reference tables from multiple datasources. Supports standard SQL JOIN, UNION, subqueries." },
        workspace_id: { type: "string", description: "Workspace ID" },
        max_rows_per_side: { type: "number", description: "Maximum rows to fetch per datasource in DuckDB federation mode. Default: 100000." },
      },
      required: ["sql", "workspace_id"],
    },
  },
  {
    name: "federation.plan",
    description: "Preview the federation execution plan without executing the query. Shows which datasources will be used, the chosen execution strategy, and any warnings.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SQL query to plan" },
        workspace_id: { type: "string", description: "Workspace ID" },
      },
      required: ["sql", "workspace_id"],
    },
  },
  {
    name: "federation.list_virtual_tables",
    description: "List all registered virtual tables in a workspace. Virtual tables are logical tables that span multiple physical datasources.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string", description: "Workspace ID" },
      },
      required: ["workspace_id"],
    },
  },
  {
    name: "federation.register_virtual_table",
    description: "Register a virtual table — a logical table decomposed across multiple datasources. Useful for creating reusable cross-datasource abstractions.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string", description: "Workspace ID" },
        name: { type: "string", description: "Canonical name for the virtual table (e.g. 'customer_orders')" },
        description: { type: "string", description: "Human-readable description" },
        decomposition: {
          type: "object",
          description: "Decomposition spec: { type: 'union'|'join'|'materialize', sources: [...], join?: {...} }",
          properties: {
            type: { type: "string", enum: ["union", "join", "materialize"] },
            sources: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  datasource_id: { type: "string" },
                  table_name: { type: "string" },
                  columns: { type: "array", items: { type: "string" } },
                  predicate: { type: "string" },
                },
                required: ["datasource_id", "table_name"],
              },
            },
            key_column: { type: "string", description: "Column used for join or materialization" },
          },
          required: ["type", "sources"],
        },
      },
      required: ["workspace_id", "name", "decomposition"],
    },
  },
  {
    name: "federation.register_join_path",
    description: "Register a known join relationship between two tables. This enables the federation planner to automatically detect cross-datasource joins in natural-language queries.",
    inputSchema: {
      type: "object",
      properties: {
        workspace_id: { type: "string" },
        name: { type: "string", description: "Name of the join relationship (e.g. 'orders_to_customers')" },
        left_datasource_id: { type: "string", description: "Datasource of the left table" },
        left_table: { type: "string" },
        left_column: { type: "string" },
        right_datasource_id: { type: "string", description: "Datasource of the right table" },
        right_table: { type: "string" },
        right_column: { type: "string" },
        cardinality: {
          type: "string",
          enum: ["one-to-one", "one-to-many", "many-to-one", "many-to-many"],
          default: "many-to-one",
        },
        confidence: { type: "number", minimum: 0, maximum: 1, default: 0.8 },
      },
      required: ["workspace_id", "name", "left_datasource_id", "left_table", "left_column", "right_datasource_id", "right_table", "right_column"],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool implementations
// ─────────────────────────────────────────────────────────────────────────────

export class FederationTools {
  private planner: FederationPlanner;
  private executor: FederationExecutor;
  private db: Database.Database;

  constructor(private deps: FederationToolsDeps) {
    const db = deps.federationDb ?? new (require("better-sqlite3"))(":memory:") as Database.Database;
    ensureFederationSchema(db);
    this.db = db;

    this.planner = new FederationPlanner({
      gateway: deps.gateway,
      listDataSources: async (workspaceId, userId) => deps.gateway.listDataSources({ user_id: userId }),
      inspectSchema: async (input) => deps.gateway.inspectSchema(input),
    });

    this.executor = new FederationExecutor({
      gateway: deps.gateway,
      planner: this.planner,
      ...(deps.duckDbAdapter !== undefined
        ? { duckDbAdapter: { runSqlReadonly: async (sql: string) => deps.duckDbAdapter!.runSqlReadonly(sql) as unknown as SqlExecutionResult } }
        : {}),
    });
  }

  async invoke(name: string, input: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "federation.query":
        return this.query(input as unknown as FederationQueryInput);
      case "federation.plan":
        return this.plan(input as unknown as { sql: string; workspace_id: string });
      case "federation.list_virtual_tables":
        return this.listVirtualTables(input as unknown as { workspace_id: string });
      case "federation.register_virtual_table":
        return this.registerVirtualTable(input as unknown as RegisterVirtualTableInput);
      case "federation.register_join_path":
        return this.registerJoinPath(input as unknown as RegisterJoinPathInput);
      default:
        throw new Error(`Unknown federation tool: ${name}`);
    }
  }

  private async query(input: FederationQueryInput): Promise<FederationQueryResult> {
    return this.executor.execute({
      workspaceId: input.workspace_id,
      userId: input.user_id ?? "system",
      sql: input.sql,
      ...(input.max_rows_per_side !== undefined ? { maxRowsPerSide: input.max_rows_per_side } : {}),
    });
  }

  private async plan(input: { sql: string; workspace_id: string }): Promise<{
    strategy: string;
    steps: string[];
    warnings: string[];
    estimatedRowsPerSide: number;
  }> {
    const plan = await this.planner.plan({
      sql: input.sql,
      workspaceId: input.workspace_id,
      userId: "system",
    });
    return {
      strategy: plan.strategy.type,
      steps: plan.steps.map((s) => `${s.kind}: ${JSON.stringify(s)}`),
      warnings: plan.warnings,
      estimatedRowsPerSide: plan.estimatedRowsPerSide,
    };
  }

  private listVirtualTables(input: { workspace_id: string }): { items: VirtualTableRecord[] } {
    const rows = this.db.prepare(
      "SELECT * FROM fed_virtual_tables WHERE workspace_id = ? ORDER BY name",
    ).all(input.workspace_id) as VirtualTableRow[];
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        decomposition: JSON.parse(r.decomposition),
        createdAt: r.created_at,
      })),
    };
  }

  private registerVirtualTable(input: RegisterVirtualTableInput): VirtualTableRecord {
    const id = `vtable-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO fed_virtual_tables
      (id,workspace_id,name,description,decomposition,created_at,updated_at)
      VALUES (@id,@workspace_id,@name,@description,@decomposition,@created_at,@updated_at)`).run({
      id, workspace_id: input.workspace_id, name: input.name,
      description: input.description ?? "",
      decomposition: JSON.stringify(input.decomposition),
      created_at: now, updated_at: now,
    });
    return {
      id, name: input.name,
      description: input.description ?? "",
      decomposition: input.decomposition,
      createdAt: now,
    };
  }

  private registerJoinPath(input: RegisterJoinPathInput): JoinPathRecord {
    const id = `join-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO fed_join_paths
      (id,workspace_id,name,description,left_datasource,left_table,left_column,
       right_datasource,right_table,right_column,join_cardinality,confidence,created_at)
      VALUES (@id,@workspace_id,@name,@description,@left_datasource,@left_table,@left_column,
              @right_datasource,@right_table,@right_column,@join_cardinality,@confidence,@created_at)`).run({
      id, workspace_id: input.workspace_id, name: input.name,
      description: input.description ?? "",
      left_datasource: input.left_datasource_id,
      left_table: input.left_table,
      left_column: input.left_column,
      right_datasource: input.right_datasource_id,
      right_table: input.right_table,
      right_column: input.right_column,
      join_cardinality: input.cardinality ?? "many-to-one",
      confidence: input.confidence ?? 0.8,
      created_at: now,
    });
    return { id, ...input, createdAt: now };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Input types
// ─────────────────────────────────────────────────────────────────────────────

interface FederationQueryInput {
  sql: string;
  workspace_id: string;
  user_id?: string;
  max_rows_per_side?: number;
  signal?: AbortSignal;
}

interface RegisterVirtualTableInput {
  workspace_id: string;
  name: string;
  description?: string;
  decomposition: {
    type: "union" | "join" | "materialize";
    sources: Array<{
      datasource_id: string;
      table_name: string;
      columns?: string[];
      predicate?: string;
    }>;
    key_column?: string;
  };
}

interface RegisterJoinPathInput {
  workspace_id: string;
  name: string;
  description?: string;
  left_datasource_id: string;
  left_table: string;
  left_column: string;
  right_datasource_id: string;
  right_table: string;
  right_column: string;
  cardinality?: string;
  confidence?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Row types
// ─────────────────────────────────────────────────────────────────────────────

interface VirtualTableRow {
  id: string; workspace_id: string; name: string;
  description: string; decomposition: string; created_at: string; updated_at: string;
}

interface VirtualTableRecord {
  id: string; name: string; description: string;
  decomposition: RegisterVirtualTableInput["decomposition"];
  createdAt: string;
}

interface JoinPathRecord extends RegisterJoinPathInput {
  id: string;
  createdAt: string;
}
