import { randomUUID } from "node:crypto";
import { ensureFederationSchema } from "./federation-schema.js";
import type { Database as Statement } from "better-sqlite3";
import type { LocalDataGateway, SqlExecutionResult, InspectSchemaInput } from "@agentx/data-gateway";
import type { DataSourceSummary } from "@agentx/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FederationQueryInput {
  workspaceId: string;
  userId: string;
  sql: string;
  datasourceIds?: string[];
  maxRowsPerSide?: number;
  signal?: AbortSignal;
}

export type ExecutionStrategy =
  | { type: "native_pushdown"; sourceDialect: string }
  | { type: "duckdb_federation"; sides: string[] }
  | { type: "materialized_staging"; stages: string[] };

export interface FederationQueryResult extends SqlExecutionResult {
  executionStrategy: ExecutionStrategy;
  datasourcesUsed: string[];
  executionPlan: string;
}

export interface FederatedTable {
  datasourceId: string;
  tableName: string;
  alias?: string;
  columns: string[];
  predicate?: string;
}

export type JoinType = "inner" | "left" | "right" | "full";

export interface JoinPair {
  left: FederatedTable;
  right: FederatedTable;
  leftColumn: string;
  rightColumn: string;
  joinType: "inner" | "left" | "right" | "full";
}

export type PlanStep =
  | { kind: "pushdown"; sql: string; datasourceId: string }
  | { kind: "fetch"; datasourceId: string; sql: string; alias: string; limit: number }
  | { kind: "duckdb_join"; sql: string }
  | { kind: "materialize"; datasourceId: string; tableName: string; sql: string }
  | { kind: "drop"; tableName: string };

export interface ExecutionPlan {
  strategy: ExecutionStrategy;
  steps: PlanStep[];
  estimatedRowsPerSide: number;
  warnings: string[];
  duckDbRewrite?: string;
}

// ---------------------------------------------------------------------------
// extractTableReferences
// ---------------------------------------------------------------------------

export function extractTableReferences(sql: string): Array<{ tableName: string; alias?: string }> {
  const results: Array<{ tableName: string; alias?: string }> = [];
  const seen = new Set<string>();
  let stripped = sql;
  let prev = "";
  while (prev !== stripped) {
    prev = stripped;
    stripped = stripped.replace(/\([^()]*\)/g, " ");
  }
  const re = /\b(?:FROM|JOIN)\b\s+(.+?)(?=\s+(?:WHERE|GROUP|ORDER|HAVING|LIMIT|OFFSET|UNION|INTERSECT|EXCEPT|ON|JOIN|FROM)\b|;|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const raw = (m[1] || "").trim();
    if (!raw) continue;
    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      const aliasMatch = part.match(/^([^\s]+)(?:\s+(?:AS\s+)?([^\s]+))?$/i);
      if (!aliasMatch) continue;
      const tableName = (aliasMatch[1] || "").replace(/^[`"]|[`"]$/g, "").trim();
      const alias = aliasMatch[2] ? aliasMatch[2].replace(/^[`"]|[`"]$/g, "").trim() : undefined;
      if (!tableName) continue;
      const key = tableName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ tableName, ...(alias !== undefined ? { alias } : {}) });
    }
  }
  return results;
}

export function detectJoins(sql: string, tables: FederatedTable[]): JoinPair[] {
  const joins: JoinPair[] = [];
  const tableMap = new Map<string, FederatedTable>();
  for (const t of tables) {
    tableMap.set(t.tableName.toLowerCase(), t);
    if (t.alias) tableMap.set(t.alias.toLowerCase(), t);
  }
  const re = /\b([A-Za-z_][\w]*)\.([A-Za-z_"][\w"]*)\s*=\s*([A-Za-z_][\w]*)\.([A-Za-z_"][\w"]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const leftAlias = m[1]!.toLowerCase();
    const leftCol = m[2]!.replace(/^"|"$/g, "");
    const rightAlias = m[3]!.toLowerCase();
    const rightCol = m[4]!.replace(/^"|"$/g, "");
    const leftTable = tableMap.get(leftAlias);
    const rightTable = tableMap.get(rightAlias);
    if (leftTable && rightTable) {
      joins.push({
        left: leftTable,
        right: rightTable,
        leftColumn: leftCol,
        rightColumn: rightCol,
        joinType: "inner",
      });
    }
  }
  return joins;
}

// ---------------------------------------------------------------------------
// FederationPlannerDeps
// ---------------------------------------------------------------------------

export interface FederationPlannerDeps {
  gateway: LocalDataGateway;
  listDataSources: (workspaceId: string, userId: string) => Promise<DataSourceSummary[]>;
  inspectSchema: (input: InspectSchemaInput) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// FederationPlanner
// ---------------------------------------------------------------------------

export class FederationPlanner {
  constructor(private deps: FederationPlannerDeps) {}

  async plan(query: {
    sql: string;
    workspaceId: string;
    userId: string;
    maxRowsPerSide?: number;
  }): Promise<ExecutionPlan> {
    const { sql, workspaceId, userId, maxRowsPerSide = 10000 } = query;
    const warnings: string[] = [];

    // Step 1: extract table references from SQL
    const refs = extractTableReferences(sql);
    if (refs.length === 0) {
      throw new Error("No table references found in query");
    }

    // Step 2: resolve each table ref to its datasource via inspectSchema
    const datasources = await this.deps.listDataSources(workspaceId, userId);
    const federatedTables: Array<FederatedTable & { dialect: string }> = [];

    for (const ref of refs) {
      for (const ds of datasources) {
        if (ds.status === "disabled") continue;
        try {
          const schema = await this.deps.inspectSchema({
            user_id: userId,
            workspace_id: workspaceId,
            datasource_id: ds.id,
          }) as { tables: Array<{ name: string }> };
          const found = schema.tables.find(
            (t) => t.name.toLowerCase() === ref.tableName.toLowerCase(),
          );
          if (found) {
            federatedTables.push({
              datasourceId: ds.id,
              tableName: ref.tableName,
              columns: [],
              dialect: this.dialectForType(ds.type),
              ...(ref.alias !== undefined ? { alias: ref.alias } : {}),
            });
            break;
          }
        } catch { /* datasource not reachable */ }
      }
    }

    // Step 3: detect joins
    const joinPairs = detectJoins(sql, federatedTables);

    // Step 4: select execution strategy based on datasource diversity
    const datasourceIds = new Set(federatedTables.map((t) => t.datasourceId));

    if (datasourceIds.size === 1) {
      const strategy: ExecutionStrategy = {
        type: "native_pushdown",
        sourceDialect: federatedTables[0]!.dialect,
      };
      if (federatedTables.length > 3) {
        warnings.push(
          `Query references ${federatedTables.length} tables. Consider creating a virtual table.`,
        );
      }
      return {
        strategy,
        steps: [{ kind: "pushdown", sql, datasourceId: federatedTables[0]!.datasourceId }],
        estimatedRowsPerSide: maxRowsPerSide,
        warnings,
      };
    }

    // Multiple datasources — DuckDB federation
    const sides = [...datasourceIds];
    const strategy: ExecutionStrategy = { type: "duckdb_federation", sides };

    if (federatedTables.length > 3) {
      warnings.push(`Query references ${federatedTables.length} tables across ${datasourceIds.size} datasources. Consider creating a virtual table.`);
    }

    return {
      strategy,
      steps: federatedTables.map((t) => ({
        kind: "fetch" as const,
        datasourceId: t.datasourceId,
        sql,
        alias: t.alias ?? t.tableName,
        limit: maxRowsPerSide,
      })),
      estimatedRowsPerSide: maxRowsPerSide,
      warnings,
    };
  }

  private dialectForType(type: string): string {
    const map: Record<string, string> = {
      postgresql: "postgres", mysql: "mysql", mariadb: "mysql",
      duckdb: "duckdb", sqlite: "sqlite", csv: "duckdb",
      bigquery: "bigquery", snowflake: "snowflake",
      clickhouse: "clickhouse", redshift: "postgres",
      tidb: "mysql", oceanbase: "mysql",
    };
    return map[type] ?? type;
  }
}

// ---------------------------------------------------------------------------
// FederationExecutor
// ---------------------------------------------------------------------------

interface DuckDbAdapter {
  runSqlReadonly(sql: string): Promise<SqlExecutionResult>;
}

export class FederationExecutor {
  constructor(private deps: {
    gateway: LocalDataGateway;
    planner: FederationPlanner;
    duckDbAdapter?: DuckDbAdapter;
  }) {}

  async execute(input: FederationQueryInput): Promise<FederationQueryResult> {
    const plan = await this.deps.planner.plan({
      sql: input.sql,
      workspaceId: input.workspaceId,
      userId: input.userId,
      ...(input.maxRowsPerSide !== undefined ? { maxRowsPerSide: input.maxRowsPerSide } : {}),
    });

    const strategy = plan.strategy;

    if (strategy.type === "native_pushdown") {
      return this.executePushdown(input, plan);
    }

    if (strategy.type === "duckdb_federation") {
      return this.executeDuckDbFederation(input, plan);
    }

    return this.executeMaterialized(input, plan);
  }

  private async executePushdown(
    input: FederationQueryInput,
    plan: ExecutionPlan
  ): Promise<FederationQueryResult> {
    const step = plan.steps.find((s) => s.kind === "pushdown");
    if (!step || step.kind !== "pushdown") {
      throw new Error("Expected pushdown step");
    }

    const result = await this.deps.gateway.runSqlReadonly({
      workspace_id: input.workspaceId,
      user_id: input.userId,
      sql: step.sql,
      datasource_id: step.datasourceId,
      signal: input.signal,
    });

    return {
      ...result,
      executionStrategy: plan.strategy,
      datasourcesUsed: [step.datasourceId],
      executionPlan: this.describePlan(plan),
    };
  }

  private async executeDuckDbFederation(
    input: FederationQueryInput,
    plan: ExecutionPlan
  ): Promise<FederationQueryResult> {
    if (!this.deps.duckDbAdapter) {
      throw new Error("DuckDB adapter not configured for duckdb_federation strategy");
    }

    const rewrite = plan.duckDbRewrite ?? input.sql;
    const result = await this.deps.duckDbAdapter.runSqlReadonly(rewrite);

    const sides = plan.strategy.type === "duckdb_federation" ? plan.strategy.sides : [];
    return {
      ...result,
      executionStrategy: plan.strategy,
      datasourcesUsed: sides,
      executionPlan: this.describePlan(plan),
    };
  }

  private async executeMaterialized(
    input: FederationQueryInput,
    plan: ExecutionPlan
  ): Promise<FederationQueryResult> {
    const fetchSteps = plan.steps.filter((s) => s.kind === "fetch");
    const materializeSteps = plan.steps.filter((s) => s.kind === "materialize");

    const rows: Record<string, unknown>[] = [];
    for (const step of fetchSteps) {
      if (step.kind === "fetch") {
        const result = await this.deps.gateway.runSqlReadonly({
          workspace_id: input.workspaceId,
          user_id: input.userId,
          sql: step.sql,
          datasource_id: step.datasourceId,
          signal: input.signal,
        });
        rows.push(...(result.rows as unknown as Record<string, unknown>[]));
      }
    }

    for (const step of materializeSteps) {
      if (step.kind === "materialize") {
        // materialize is a no-op here; data already fetched
      }
    }

    return {
      columns: input.sql.includes("SELECT") ? Object.keys(rows[0] ?? {}) : [],
      rows: rows as unknown as unknown[][],
      row_count: rows.length,
      audit_log_id: "",
      elapsed_ms: 0,
      executionStrategy: plan.strategy,
      datasourcesUsed: fetchSteps.map((s) => (s.kind === "fetch" ? s.datasourceId : "")),
      executionPlan: this.describePlan(plan),
    };
  }

  private describePlan(plan: ExecutionPlan): string {
    return JSON.stringify(plan, null, 2);
  }
}
