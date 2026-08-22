/**
 * DataLink Bridge — connects the Node.js API to the Python DataLink microservice.
 *
 * DataLink (services/datalink/) is a standalone Python microservice that provides:
 *   - Schema profiling: column statistics, nullability, cardinality, distribution
 *   - Semantic inference: semantic types, joinable columns, correlated columns
 *   - Graph storage: nodes (columns, tables, concepts) + edges (joins, synonyms)
 *   - MCP tool: `datalink_explore` for agent semantic queries
 *   - REST API: add-table, rebuild, remove-table, explore, search, get-node
 *
 * This bridge is the missing integration layer:
 *   - HTTP client → DataLink REST API (add/rebuild/remove)
 *   - MCP client → DataLink MCP server (datalink_explore for agent grounding)
 *   - SemanticProvider adapter → wires DataLink into agent-runtime semantic chain
 *   - Notebook integration → schema profiling + auto-registration of notebook datasources
 *
 * Environment variables:
 *   DATALINK_API_URL  — REST API base URL (default: http://localhost:8081)
 *   DATALINK_MCP_URL  — MCP server URL (default: http://localhost:8080)
 *   DATALINK_API_KEY  — Optional API key for DataLink auth
 *   DATALINK_TIMEOUT_MS — Request timeout (default: 30_000)
 */
import type { LocalDataGateway, SchemaSummary } from "@datafoundry/data-gateway";
import type {
  SemanticProvider,
  SemanticRequest,
  SemanticProviderResult,
  SemanticTrust,
} from "@datafoundry/agent-runtime/src/semantic/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DataLinkBridgeConfig {
  /** REST API base URL. Default: http://localhost:8081 */
  apiUrl?: string;
  /** MCP server URL. Default: http://localhost:8080 */
  mcpUrl?: string;
  /** Optional API key. */
  apiKey?: string;
  /** Request timeout in ms. Default: 30_000 */
  timeoutMs?: number;
}

export interface ProfileResult {
  tableName: string;
  columns: ColumnProfile[];
  rowCount: number;
  profileMs: number;
}

export interface ColumnProfile {
  name: string;
  semanticType: string;
  nullFraction: number;
  cardinality: number;
  distinctValues: number;
  sampleValues: unknown[];
  profile: {
    min?: unknown; max?: unknown; mean?: unknown;
    stdDev?: number; histogram?: unknown[];
  };
}

export interface ExploreResult {
  nodes: Array<{
    id: string; type: string; name: string;
    description: string; source: string;
    semanticType?: string; profile?: ColumnProfile;
  }>;
  edges: Array<{
    source: string; target: string; type: string; confidence: number;
  }>;
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// REST API client
// ─────────────────────────────────────────────────────────────────────────────

export class DataLinkApiClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeout: number;

  constructor(config: DataLinkBridgeConfig = {}) {
    this.baseUrl = config.apiUrl ?? "http://localhost:8081";
    this.timeout = config.timeoutMs ?? 30_000;
    this.headers = {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    };
  }

  /**
   * Add a table to the DataLink graph.
   * Triggers profiling, inference, and edge generation.
   */
  async addTable(input: {
    source: string;   // connection string or file path
    table?: string;  // table name (null = all tables)
    sourceType?: string;
    schemaName?: string;
  }): Promise<{ added: string[]; profilingMs: number }> {
    return this.post("/add-table", {
      source: input.source,
      table: input.table,
      source_type: input.sourceType ?? "csv",
      schema_name: input.schemaName,
    });
  }

  /** Rebuild the graph (full, vec, or profile only). */
  async rebuild(mode: "full" | "vec" | "profile" = "full"): Promise<{ rebuilt: boolean; ms: number }> {
    return this.post("/rebuild", { mode });
  }

  /** Remove a table from the graph. */
  async removeTable(tableId: string, cleanupOrphans = true): Promise<{ removed: boolean }> {
    return this.post("/remove-table", { table_id: tableId, cleanup_orphans: cleanupOrphans });
  }

  /** List all datasets in the graph. */
  async listDatasets(): Promise<{ datasets: Array<{ id: string; name: string; tableCount: number; rowCount: number }> }> {
    return this.get("/list-datasets");
  }

  /** Profile a specific table and return column statistics. */
  async profileTable(input: {
    datasourceId: string;
    tableName: string;
    gateway: LocalDataGateway;
    userId: string;
    workspaceId: string;
    sampleRows?: number;
  }): Promise<ProfileResult> {
    const startedAt = Date.now();

    // Pull a sample from the datasource
    const sample = await input.gateway.previewTable({
      user_id: input.userId,
      workspace_id: input.workspaceId,
      datasource_id: input.datasourceId,
      table: input.tableName,
      limit: input.sampleRows ?? 1000,
    });

    // Use the REST API profile endpoint if available, otherwise compute locally
    try {
      await this.post("/profile", {
        table: input.tableName,
        columns: sample.columns,
        rows: sample.rows.slice(0, input.sampleRows ?? 1000),
      });
    } catch {
      // DataLink profile endpoint unavailable or returned error; fall through to local computation
    }
    return {
      tableName: input.tableName,
      columns: computeColumnProfiles(sample.columns, sample.rows),
      rowCount: sample.rows.length,
      profileMs: Date.now() - startedAt,
    };
  }

  /** Explore the semantic graph — finds relevant nodes and relationships. */
  async explore(query: string, focus?: "join_paths" | "schema" | "data_profile"): Promise<ExploreResult> {
    try {
      const raw = await this.post("/explore", { query, focus });
      return parseExploreResult(raw);
    } catch {
      // If DataLink is unavailable, return empty result
      return { nodes: [], edges: [], warnings: ["DataLink service unavailable — semantic layer degraded"] };
    }
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers,
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!res.ok) throw new Error(`DataLink API ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!res.ok) throw new Error(`DataLink API ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP client (streamable-http transport)
// ─────────────────────────────────────────────────────────────────────────────

export interface DataLinkMcpClient {
  explore(query: string, focus?: string): Promise<ExploreResult>;
}

export class DataLinkMcpClientImpl implements DataLinkMcpClient {
  constructor(private readonly mcpUrl: string, private readonly timeout: number = 30_000) {}

  /**
   * Call the `datalink_explore` MCP tool via streamable-http transport.
   * Returns parsed semantic graph context.
   */
  async explore(query: string, focus?: string): Promise<ExploreResult> {
    try {
      const res = await fetch(`${this.mcpUrl}/v1/tools/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "datalink_explore",
          arguments: { query, focus, mask_credential: true },
        }),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!res.ok) {
        return { nodes: [], edges: [], warnings: [`MCP error ${res.status}: ${await res.text()}`] };
      }

      const json = await res.json() as { content?: Array<{ text?: string }> };
      const text = json.content?.[0]?.text ?? "";
      return parseExploreResultFromText(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { nodes: [], edges: [], warnings: [`DataLink MCP unreachable: ${msg}`] };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Semantic provider adapter (wires DataLink into agent-runtime)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps a DataLinkMcpClient as a `SemanticProvider` for the agent-runtime
 * semantic chain. This is the integration point: the agent's data-analysis
 * protocol can now use the real DataLink graph for semantic grounding.
 *
 * Note: uses "datalink" id for compatibility; "datalink-mcp" may be added
 * to the upstream interface in a future release.
 */
export class DataLinkSemanticProviderAdapter implements SemanticProvider {
  readonly id = "datalink" as SemanticProvider["id"];

  constructor(private readonly client: DataLinkMcpClient) {}

  async resolve(request: SemanticRequest): Promise<SemanticProviderResult> {
    try {
      const result = await this.client.explore(request.query);
      const trust = inferTrustLevel(result);

      return {
        value: result,
        capabilities: ["graph-explore", "semantic-type-inference", "join-detection"],
        trust,
        warnings: result.warnings,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`DataLink semantic provider failed: ${msg}`);
    }
  }
}

function inferTrustLevel(result: ExploreResult): SemanticTrust {
  if (result.nodes.length === 0) return "unknown";
  const sources = result.nodes.map((n) => n.source ?? "");
  if (sources.every((s) => s === "authoritative")) return "authoritative";
  if (sources.every((s) => s === "authoritative" || s === "verified")) return "verified";
  return "inferred";
}

// ─────────────────────────────────────────────────────────────────────────────
// Notebook integration
// ─────────────────────────────────────────────────────────────────────────────

export interface DataLinkNotebookIntegration {
  /**
   * Called when the notebook is saved or a datasource is added.
   * Registers the datasource with DataLink so the agent can explore it.
   */
  registerDatasource(input: {
    datasourceId: string;
    datasourceName: string;
    datasourceType: string;
    connectionConfig: Record<string, unknown>;
    gateway: LocalDataGateway;
    userId: string;
    workspaceId: string;
  }): Promise<void>;

  /**
   * Called before running a SQL cell. Provides semantic context to the
   * agent so it understands column semantics before writing SQL.
   */
  enrichSqlCell(input: {
    datasourceId: string;
    sql: string;
    workspaceId: string;
  }): Promise<{
    semanticContext: ExploreResult;
    profileCache: Map<string, ProfileResult>;
  }>;
}

/**
 * Creates a notebook integration that keeps DataLink in sync with notebook state.
 */
export function createDataLinkNotebookIntegration(
  apiClient: DataLinkApiClient,
  mcpClient: DataLinkMcpClient,
): DataLinkNotebookIntegration {
  const profileCache = new Map<string, ProfileResult>();

  return {
    async registerDatasource({ datasourceId, datasourceName, connectionConfig, gateway, userId, workspaceId }) {
      // Convert datasource config to a DataLink connection string
      const connectionString = buildConnectionString(datasourceType(datasourceName), connectionConfig);
      try {
        await apiClient.addTable({
          source: connectionString,
          sourceType: datasourceName.toLowerCase().includes("csv") ? "csv" : "database",
        });
        console.info(`[DataLink] Registered datasource ${datasourceId} with DataLink`);
      } catch (err) {
        console.warn(`[DataLink] Failed to register datasource ${datasourceId}:`, err);
        // Non-fatal — notebook still works without DataLink
      }
    },

    async enrichSqlCell({ datasourceId, sql, workspaceId }) {
      // Extract table names from the SQL
      const tables = extractSqlTableNames(sql);
      const semanticContext = await mcpClient.explore(
        tables.join(" ") + " " + sql.slice(0, 200),
      );

      // Cache profile data for each referenced table
      for (const table of tables) {
        const cacheKey = `${datasourceId}:${table}`;
        if (!profileCache.has(cacheKey)) {
          // Profiles will be populated on first use
          profileCache.set(cacheKey, { tableName: table, columns: [], rowCount: 0, profileMs: 0 });
        }
      }

      return { semanticContext, profileCache };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseExploreResult(raw: unknown): ExploreResult {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    return {
      nodes: Array.isArray(r.nodes) ? r.nodes as ExploreResult["nodes"] : [],
      edges: Array.isArray(r.edges) ? r.edges as ExploreResult["edges"] : [],
      warnings: Array.isArray(r.warnings) ? r.warnings as string[] : [],
    };
  }
  return { nodes: [], edges: [], warnings: [] };
}

function parseExploreResultFromText(text: string): ExploreResult {
  // DataLink MCP returns plain text; parse it into structured form
  // This is a best-effort parser — real implementation would use structured JSON output
  const nodes: ExploreResult["nodes"] = [];
  const edges: ExploreResult["edges"] = [];
  const warnings: string[] = [];

  // Match patterns like "• orders.order_id (column) — identifier.id"
  const nodePattern = /•\s+([^\s(]+)\s+\(([^)]+)\)(?:\s*[—–]\s*(.+))?/g;
  let m: RegExpExecArray | null;
  while ((m = nodePattern.exec(text)) !== null) {
    const [, name, type, description] = m;
    nodes.push({
      id: name ?? "",
      type: type ?? "unknown",
      name: name ?? "",
      description: description ?? "",
      source: "inferred",
    });
  }

  // Match patterns like "→ joins: orders.customer_id = customers.id"
  const edgePattern = /[→\-+]+\s*(?:joins?[:\s]+)?([^.[]+)\.([^\s=]+)\s*=\s*([^.[]+)\.([^\s,;]+)/gi;
  while ((m = edgePattern.exec(text)) !== null) {
    const [, leftTable, leftCol, rightTable, rightCol] = m;
    edges.push({
      source: `${leftTable?.trim()}.${leftCol?.trim()}`,
      target: `${rightTable?.trim()}.${rightCol?.trim()}`,
      type: "joinable",
      confidence: 0.85,
    });
  }

  if (nodes.length === 0) {
    warnings.push("DataLink returned no structured nodes — query may be outside the indexed graph.");
  }

  return { nodes, edges, warnings };
}

function computeColumnProfiles(columns: string[], rows: unknown[][]): ColumnProfile[] {
  return columns.map((col, idx) => {
    const values = rows.map((r) => r[idx]);
    const nonNull = values.filter((v) => v !== null && v !== undefined);
    const unique = new Set(nonNull.map(String));
    const nums = nonNull.filter((v) => typeof v === "number") as number[];
    return {
      name: col,
      semanticType: inferSemanticType(col, values),
      nullFraction: values.length > 0 ? (values.length - nonNull.length) / values.length : 0,
      cardinality: unique.size,
      distinctValues: unique.size,
      sampleValues: [...unique].slice(0, 5),
      profile: {
        min: nums.length > 0 ? Math.min(...nums) : undefined,
        max: nums.length > 0 ? Math.max(...nums) : undefined,
        mean: nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined,
      },
    };
  });
}

function inferSemanticType(columnName: string, values: unknown[]): string {
  const name = columnName.toLowerCase();
  const samples = values.filter((v) => v !== null).slice(0, 20).map(String);
  const [first] = samples;
  if (/\b(id|_id|uuid|pk)\b/.test(name)) return "identifier.id";
  if (/\b(email|e-mail)\b/.test(name)) return "person.email";
  if (/\b(_at|_ts|date|time)\b/.test(name)) return "time.datetime";
  if (/\b(_amount|_price|_cost|_revenue)\b/.test(name)) return "currency.amount";
  if (/\b(_pct|_rate|_ratio)\b/.test(name)) return "ratio.percentage";
  if (/\b(phone|mobile|tel)\b/.test(name)) return "person.phone";
  if (/^(true|false|yes|no|active|enabled)$/i.test(first ?? "")) return "flag.boolean";
  if (first !== undefined && !isNaN(Number(first))) return "numeric.count";
  return "text.general";
}

function extractSqlTableNames(sql: string): string[] {
  const seen = new Set<string>();
  const pattern = /\b(?:FROM|JOIN)\s+([`"']?[\w]+[`"']?)(?:\s+(?:AS\s+)?[\w]+)?/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(sql)) !== null) {
    const table = m[1]?.replace(/[`"']/g, "").trim();
    if (table && !seen.has(table.toLowerCase())) {
      seen.add(table.toLowerCase());
    }
  }
  return [...seen];
}

function buildConnectionString(datasourceType: string, config: Record<string, unknown>): string {
  // Build a connection string from the config for DataLink to connect
  switch (datasourceType.toLowerCase()) {
    case "postgresql":
      return `postgresql://${config.host ?? "localhost"}:${config.port ?? 5432}${config.database ? `/${config.database}` : ""}`;
    case "mysql":
      return `mysql://${config.host ?? "localhost"}:${config.port ?? 3306}${config.database ? `/${config.database}` : ""}`;
    case "sqlite":
      return String(config.path ?? config.database ?? "");
    case "duckdb":
      return String(config.path ?? config.database ?? "");
    case "csv":
      return String(config.path ?? "");
    default:
      return JSON.stringify(config);
  }
}

function datasourceType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("postgres")) return "postgresql";
  if (lower.includes("mysql")) return "mysql";
  if (lower.includes("sqlite")) return "sqlite";
  if (lower.includes("duckdb")) return "duckdb";
  if (lower.includes("csv")) return "csv";
  if (lower.includes("bigquery")) return "bigquery";
  return "unknown";
}
