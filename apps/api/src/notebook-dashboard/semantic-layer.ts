/**
 * Semantic Layer MVP — metrics, entities, lineage.
 *
 * Builds on top of the existing semantic-catalog (column descriptions, glossary,
 * contracts) to add the three pillars of a real semantic layer:
 *
 *   1. Metrics — first-class definitions of business KPIs
 *      (e.g., "GMV", "D7 Retention") with their SQL expressions, dimensions,
 *      and owners.  Metrics are versioned and can be approved by a steward.
 *
 *   2. Entities — real-world things (customer, order, product) with their
 *      canonical primary key, classification, and member tables.
 *
 *   3. Lineage — graph of "what flows into what" across SQL queries,
 *      datasets, and dashboards.  Backed by a write-optimised adjacency table.
 *
 * Usage:
 *   const lineage = new SemanticLayerRepository(db);
 *   await lineage.upsertMetric({ id, name, expression, dimensions, ... });
 *   const result = await lineage.resolveMetricsForQuery("SELECT SUM(amount) FROM orders");
 */

import type { Database as BetterSqlite3Database, Statement } from "better-sqlite3";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type MetricType = "sum" | "count" | "average" | "ratio" | "multiplier" | "custom";

export interface Metric {
  id: string;
  catalogId: string;
  name: string;
  displayName: string;
  description: string;
  metricType: MetricType;
  /** Canonical SQL expression — e.g. "SUM(order_amount * (1 - discount_rate))" */
  expression: string;
  /** SQL to wrap the expression — e.g. "SELECT brand, expression FROM orders" */
  baseQuery: string;
  /** JSON-encoded string[] */
  dimensions: string[];
  /** JSON-encoded string[] */
  filters: string[];
  /** Granular counter table (1 = monthly, 2 = daily, ...) */
  aggregationTimeframe: string;
  unitOfMeasurement: string;
  ownerEmail: string;
  status: "draft" | "active" | "deprecated";
  approvedBy: string;
  approvedAt: string;
  /** Monotonic version - bumped on every edit */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type EntityClassification = "core" | "supporting" | "lookup" | "log";

export interface Entity {
  id: string;
  catalogId: string;
  name: string;
  displayName: string;
  description: string;
  classification: EntityClassification;
  primaryKeyColumns: string[]; // JSON array
  /** Comma-separated tables that represent this entity */
  memberTables: string[];
  /** Optional join paths (JSON array of {source,target,on} objects) */
  joinPaths: string;
  ownerEmail: string;
  createdAt: string;
  updatedAt: string;
}

export type LineageEdgeType = "derives" | "references" | "aggregates" | "filters" | "joins";

export interface LineageNode {
  id: string;
  catalogId: string;
  nodeType: "table" | "column" | "metric" | "dashboard" | "notebook" | "query";
  resourceId: string;
  displayName: string;
  datasourceId: string;
  workspaceId: string;
  metadata: string; // JSON
  createdAt: string;
}

export interface LineageEdge {
  id: string;
  catalogId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: LineageEdgeType;
  /** Optional transform (e.g. SQL expression) */
  transform: string;
  confidence: number;
  createdAt: string;
}

export interface ResolveResult {
  matchedMetrics: Metric[];
  matchedEntities: Entity[];
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

export function ensureSemanticLayerSchema(db: BetterSqlite3Database): void {
  db.exec(`
    -- ── Metrics ────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS sem_metrics (
      id                    TEXT PRIMARY KEY,
      catalog_id            TEXT NOT NULL,
      name                  TEXT NOT NULL,
      display_name          TEXT NOT NULL,
      description           TEXT NOT NULL DEFAULT '',
      metric_type           TEXT NOT NULL DEFAULT 'custom',
      expression            TEXT NOT NULL,
      base_query            TEXT NOT NULL DEFAULT '',
      dimensions            TEXT NOT NULL DEFAULT '[]',
      filters               TEXT NOT NULL DEFAULT '[]',
      aggregation_timeframe TEXT NOT NULL DEFAULT '',
      unit_of_measurement   TEXT NOT NULL DEFAULT '',
      owner_email           TEXT NOT NULL DEFAULT '',
      status                TEXT NOT NULL DEFAULT 'draft',
      approved_by           TEXT NOT NULL DEFAULT '',
      approved_at           TEXT NOT NULL DEFAULT '',
      version               INTEGER NOT NULL DEFAULT 1,
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sem_metrics_catalog ON sem_metrics(catalog_id, status);
    CREATE INDEX IF NOT EXISTS idx_sem_metrics_name ON sem_metrics(catalog_id, name);

    -- ── Entities ───────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS sem_entities (
      id                    TEXT PRIMARY KEY,
      catalog_id            TEXT NOT NULL,
      name                  TEXT NOT NULL,
      display_name          TEXT NOT NULL,
      description           TEXT NOT NULL DEFAULT '',
      classification        TEXT NOT NULL DEFAULT 'core',
      primary_key_columns   TEXT NOT NULL DEFAULT '[]',
      member_tables         TEXT NOT NULL DEFAULT '',
      join_paths            TEXT NOT NULL DEFAULT '',
      owner_email           TEXT NOT NULL DEFAULT '',
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sem_entities_catalog ON sem_entities(catalog_id);
    CREATE INDEX IF NOT EXISTS idx_sem_entities_name ON sem_entities(catalog_id, name);

    -- ── Lineage nodes ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS sem_lineage_nodes (
      id                    TEXT PRIMARY KEY,
      catalog_id            TEXT NOT NULL,
      node_type             TEXT NOT NULL,
      resource_id           TEXT NOT NULL,
      display_name          TEXT NOT NULL,
      datasource_id         TEXT NOT NULL DEFAULT '',
      workspace_id          TEXT NOT NULL DEFAULT '',
      metadata              TEXT NOT NULL DEFAULT '{}',
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sem_lineage_nodes_resource
      ON sem_lineage_nodes(catalog_id, resource_id);
    CREATE INDEX IF NOT EXISTS idx_sem_lineage_nodes_type
      ON sem_lineage_nodes(catalog_id, node_type);

    -- ── Lineage edges ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS sem_lineage_edges (
      id                    TEXT PRIMARY KEY,
      catalog_id            TEXT NOT NULL,
      source_node_id        TEXT NOT NULL,
      target_node_id        TEXT NOT NULL,
      edge_type             TEXT NOT NULL,
      transform             TEXT NOT NULL DEFAULT '',
      confidence            REAL NOT NULL DEFAULT 1.0,
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sem_lineage_edges_source
      ON sem_lineage_edges(source_node_id);
    CREATE INDEX IF NOT EXISTS idx_sem_lineage_edges_target
      ON sem_lineage_edges(target_node_id);
    CREATE INDEX IF NOT EXISTS idx_sem_lineage_edges_type
      ON sem_lineage_edges(catalog_id, edge_type);
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────────────────────────────────────

export class SemanticLayerRepository {
  private readonly s: {
    // Metrics
    insertMetric: Statement;
    updateMetric: Statement;
    getMetric: Statement;
    listMetrics: Statement;
    deleteMetric: Statement;
    searchMetricsByName: Statement;
    // Entities
    insertEntity: Statement;
    updateEntity: Statement;
    getEntity: Statement;
    listEntities: Statement;
    deleteEntity: Statement;
    // Lineage nodes
    insertNode: Statement;
    getNode: Statement;
    findNode: Statement;
    listNodes: Statement;
    // Lineage edges
    insertEdge: Statement;
    listEdgesBySource: Statement;
    listEdgesByTarget: Statement;
    listEdgesByNode: Statement;
    deleteEdgesByNode: Statement;
  };

  constructor(private readonly db: BetterSqlite3Database) {
    ensureSemanticLayerSchema(db);
    const d = db;

    this.s = {
      insertMetric: d.prepare(`INSERT INTO sem_metrics
        (id, catalog_id, name, display_name, description, metric_type, expression,
         base_query, dimensions, filters, aggregation_timeframe, unit_of_measurement,
         owner_email, status, approved_by, approved_at, version, created_at, updated_at)
        VALUES (@id, @catalog_id, @name, @display_name, @description, @metric_type,
         @expression, @base_query, @dimensions, @filters, @aggregation_timeframe,
         @unit_of_measurement, @owner_email, @status, @approved_by, @approved_at,
         @version, @created_at, @updated_at)`),

      updateMetric: d.prepare(`UPDATE sem_metrics SET
        display_name = @display_name, description = @description,
        metric_type = @metric_type, expression = @expression,
        base_query = @base_query, dimensions = @dimensions,
        filters = @filters, aggregation_timeframe = @aggregation_timeframe,
        unit_of_measurement = @unit_of_measurement,
        owner_email = @owner_email, status = @status,
        approved_by = @approved_by, approved_at = @approved_at,
        version = @version, updated_at = @updated_at
        WHERE id = @id`),

      getMetric: d.prepare(`SELECT * FROM sem_metrics WHERE id = @id`),
      listMetrics: d.prepare(`SELECT * FROM sem_metrics
        WHERE catalog_id = @catalog_id
        ORDER BY name ASC`),
      deleteMetric: d.prepare(`DELETE FROM sem_metrics WHERE id = @id`),
      searchMetricsByName: d.prepare(`SELECT * FROM sem_metrics
        WHERE catalog_id = @catalog_id AND (
          LOWER(name) LIKE @pattern OR LOWER(display_name) LIKE @pattern
        ) ORDER BY name ASC LIMIT 100`),

      insertEntity: d.prepare(`INSERT INTO sem_entities
        (id, catalog_id, name, display_name, description, classification,
         primary_key_columns, member_tables, join_paths, owner_email,
         created_at, updated_at)
        VALUES (@id, @catalog_id, @name, @display_name, @description,
         @classification, @primary_key_columns, @member_tables, @join_paths,
         @owner_email, @created_at, @updated_at)`),

      updateEntity: d.prepare(`UPDATE sem_entities SET
        display_name = @display_name, description = @description,
        classification = @classification, primary_key_columns = @primary_key_columns,
        member_tables = @member_tables, join_paths = @join_paths,
        owner_email = @owner_email, updated_at = @updated_at
        WHERE id = @id`),

      getEntity: d.prepare(`SELECT * FROM sem_entities WHERE id = @id`),
      listEntities: d.prepare(`SELECT * FROM sem_entities
        WHERE catalog_id = @catalog_id ORDER BY name ASC`),
      deleteEntity: d.prepare(`DELETE FROM sem_entities WHERE id = @id`),

      insertNode: d.prepare(`INSERT OR REPLACE INTO sem_lineage_nodes
        (id, catalog_id, node_type, resource_id, display_name, datasource_id,
         workspace_id, metadata, created_at)
        VALUES (@id, @catalog_id, @node_type, @resource_id, @display_name,
         @datasource_id, @workspace_id, @metadata, @created_at)`),

      getNode: d.prepare(`SELECT * FROM sem_lineage_nodes WHERE id = @id`),
      findNode: d.prepare(`SELECT * FROM sem_lineage_nodes
        WHERE catalog_id = @catalog_id AND resource_id = @resource_id
        LIMIT 1`),
      listNodes: d.prepare(`SELECT * FROM sem_lineage_nodes
        WHERE catalog_id = @catalog_id
        ORDER BY created_at DESC LIMIT 1000`),

      insertEdge: d.prepare(`INSERT INTO sem_lineage_edges
        (id, catalog_id, source_node_id, target_node_id, edge_type, transform,
         confidence, created_at)
        VALUES (@id, @catalog_id, @source_node_id, @target_node_id, @edge_type,
         @transform, @confidence, @created_at)`),

      listEdgesBySource: d.prepare(`SELECT * FROM sem_lineage_edges
        WHERE source_node_id = @source_node_id`),
      listEdgesByTarget: d.prepare(`SELECT * FROM sem_lineage_edges
        WHERE target_node_id = @target_node_id`),
      listEdgesByNode: d.prepare(`SELECT * FROM sem_lineage_edges
        WHERE source_node_id = @node_id OR target_node_id = @node_id`),
      deleteEdgesByNode: d.prepare(`DELETE FROM sem_lineage_edges
        WHERE source_node_id = @node_id OR target_node_id = @node_id`),
    };
  }

  // ── Metrics CRUD ──────────────────────────────────────────────────────────

  upsertMetric(input: Omit<Metric, "createdAt" | "updatedAt" | "version"> & { version?: number }): Metric {
    const now = new Date().toISOString();
    const existing = this.getMetric(input.id);

    const record: Metric = {
      id: input.id,
      catalogId: input.catalogId,
      name: input.name,
      displayName: input.displayName,
      description: input.description,
      metricType: input.metricType,
      expression: input.expression,
      baseQuery: input.baseQuery,
      dimensions: input.dimensions,
      filters: input.filters,
      aggregationTimeframe: input.aggregationTimeframe,
      unitOfMeasurement: input.unitOfMeasurement,
      ownerEmail: input.ownerEmail,
      status: input.status,
      approvedBy: input.approvedBy,
      approvedAt: input.approvedAt,
      version: existing ? existing.version + 1 : (input.version ?? 1),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (existing) {
      this.s.updateMetric.run(toSnakeMetric(record));
    } else {
      this.s.insertMetric.run(toSnakeMetric(record));
    }
    return record;
  }

  getMetric(id: string): Metric | undefined {
    const row = this.s.getMetric.get({ id }) as Record<string, unknown> | undefined;
    return row ? rowToMetric(row) : undefined;
  }

  listMetrics(catalogId: string): Metric[] {
    return (this.s.listMetrics.all({ catalog_id: catalogId }) as Record<string, unknown>[]).map(rowToMetric);
  }

  searchMetrics(catalogId: string, query: string): Metric[] {
    const pattern = `%${query.toLowerCase()}%`;
    return (this.s.searchMetricsByName.all({ catalog_id: catalogId, pattern }) as Record<string, unknown>[]).map(rowToMetric);
  }

  deleteMetric(id: string): boolean {
    return this.s.deleteMetric.run({ id }).changes > 0;
  }

  /**
   * Approve a metric — moves status from "draft" to "active" and stamps approver.
   */
  approveMetric(id: string, approverEmail: string): Metric | undefined {
    const metric = this.getMetric(id);
    if (!metric) return undefined;
    return this.upsertMetric({
      ...metric,
      status: "active",
      approvedBy: approverEmail,
      approvedAt: new Date().toISOString(),
    });
  }

  // ── Entities CRUD ────────────────────────────────────────────────────────

  upsertEntity(input: Omit<Entity, "createdAt" | "updatedAt">): Entity {
    const now = new Date().toISOString();
    const existing = this.getEntity(input.id);
    const record: Entity = {
      ...input,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (existing) {
      this.s.updateEntity.run(toSnakeEntity(record));
    } else {
      this.s.insertEntity.run(toSnakeEntity(record));
    }
    return record;
  }

  getEntity(id: string): Entity | undefined {
    const row = this.s.getEntity.get({ id }) as Record<string, unknown> | undefined;
    return row ? rowToEntity(row) : undefined;
  }

  listEntities(catalogId: string): Entity[] {
    return (this.s.listEntities.all({ catalog_id: catalogId }) as Record<string, unknown>[]).map(rowToEntity);
  }

  deleteEntity(id: string): boolean {
    return this.s.deleteEntity.run({ id }).changes > 0;
  }

  // ── Lineage ────────────────────────────────────────────────────────────

  upsertNode(input: Omit<LineageNode, "createdAt"> & { createdAt?: string }): LineageNode {
    const now = new Date().toISOString();
    const record: LineageNode = {
      id: input.id,
      catalogId: input.catalogId,
      nodeType: input.nodeType,
      resourceId: input.resourceId,
      displayName: input.displayName,
      datasourceId: input.datasourceId,
      workspaceId: input.workspaceId,
      metadata: input.metadata,
      createdAt: input.createdAt ?? now,
    };
    this.s.insertNode.run(toSnakeNode(record));
    return record;
  }

  findNode(catalogId: string, resourceId: string): LineageNode | undefined {
    const row = this.s.findNode.get({ catalog_id: catalogId, resource_id: resourceId }) as Record<string, unknown> | undefined;
    return row ? rowToLineageNode(row) : undefined;
  }

  upsertEdge(input: Omit<LineageEdge, "createdAt"> & { createdAt?: string }): LineageEdge {
    const record: LineageEdge = {
      ...input,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.s.insertEdge.run(toSnakeEdge(record));
    return record;
  }

  getLineageAt(nodeId: string, depth = 1): { node: LineageNode; upstream: LineageNode[]; downstream: LineageNode[] } | undefined {
    const node = this.s.getNode.get({ id: nodeId }) as Record<string, unknown> | undefined;
    if (!node) return undefined;

    const upstream: LineageNode[] = [];
    const downstream: LineageNode[] = [];

    const upstreamEdges = this.s.listEdgesByTarget.all({ target_node_id: nodeId }) as Record<string, unknown>[];
    const downstreamEdges = this.s.listEdgesBySource.all({ source_node_id: nodeId }) as Record<string, unknown>[];

    for (const e of upstreamEdges) {
      const source = this.s.getNode.get({ id: e.source_node_id }) as Record<string, unknown> | undefined;
      if (source) upstream.push(rowToLineageNode(source));
    }
    for (const e of downstreamEdges) {
      const target = this.s.getNode.get({ id: e.target_node_id }) as Record<string, unknown> | undefined;
      if (target) downstream.push(rowToLineageNode(target));
    }

    return { node: rowToLineageNode(node), upstream, downstream };
  }

  deleteLineageForNode(nodeId: string): number {
    return this.s.deleteEdgesByNode.run({ node_id: nodeId }).changes;
  }

  // ── Resolution ────────────────────────────────────────────────────────

  /**
   * Resolve a free-text query against the metric & entity catalogs.
   * Used by analysis tools to find canonical metric definitions matching
   * what the user is asking about.
   */
  resolveForQuery(catalogId: string, query: string): ResolveResult {
    const warnings: string[] = [];
    const lower = query.toLowerCase();

    const metricNames = new Set(this.listMetrics(catalogId).map((m) => m.name.toLowerCase()));
    const entityNames = new Set(this.listEntities(catalogId).map((e) => e.name.toLowerCase()));

    const matchedMetrics: Metric[] = [];
    const matchedEntities: Entity[] = [];

    // Match metrics by token appearance
    const tokens = lower.match(/[\w_]+/g) ?? [];
    for (const metric of this.listMetrics(catalogId)) {
      const name = metric.name.toLowerCase();
      const display = metric.displayName.toLowerCase();
      if (tokens.some((t) => name.includes(t) || display.includes(t))) {
        matchedMetrics.push(metric);
      }
    }

    // Match entities by token appearance
    for (const entity of this.listEntities(catalogId)) {
      const name = entity.name.toLowerCase();
      const display = entity.displayName.toLowerCase();
      if (tokens.some((t) => name.includes(t) || display.includes(t))) {
        matchedEntities.push(entity);
      }
    }

    if (matchedMetrics.length === 0 && matchedEntities.length === 0) {
      warnings.push("No metrics or entities matched the query terms.");
    }

    return { matchedMetrics, matchedEntities, warnings };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Row mappers
// ─────────────────────────────────────────────────────────────────────────────

function rowToMetric(row: Record<string, unknown>): Metric {
  return {
    id: String(row.id),
    catalogId: String(row.catalog_id),
    name: String(row.name),
    displayName: String(row.display_name),
    description: String(row.description),
    metricType: String(row.metric_type) as MetricType,
    expression: String(row.expression),
    baseQuery: String(row.base_query),
    dimensions: safeJsonParse(row.dimensions, []),
    filters: safeJsonParse(row.filters, []),
    aggregationTimeframe: String(row.aggregation_timeframe),
    unitOfMeasurement: String(row.unit_of_measurement),
    ownerEmail: String(row.owner_email),
    status: String(row.status) as "draft" | "active" | "deprecated",
    approvedBy: String(row.approved_by),
    approvedAt: String(row.approved_at),
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToEntity(row: Record<string, unknown>): Entity {
  return {
    id: String(row.id),
    catalogId: String(row.catalog_id),
    name: String(row.name),
    displayName: String(row.display_name),
    description: String(row.description),
    classification: String(row.classification) as EntityClassification,
    primaryKeyColumns: safeJsonParse(row.primary_key_columns, []),
    memberTables: String(row.member_tables).split(",").map((s) => s.trim()).filter(Boolean),
    joinPaths: String(row.join_paths),
    ownerEmail: String(row.owner_email),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToLineageNode(row: Record<string, unknown>): LineageNode {
  return {
    id: String(row.id),
    catalogId: String(row.catalog_id),
    nodeType: String(row.node_type) as LineageNode["nodeType"],
    resourceId: String(row.resource_id),
    displayName: String(row.display_name),
    datasourceId: String(row.datasource_id),
    workspaceId: String(row.workspace_id),
    metadata: String(row.metadata),
    createdAt: String(row.created_at),
  };
}

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// ── snake_case mappers for prepared-statement parameters ────────────────────
// better-sqlite3 binds only named params that appear in the SQL, and the
// SQL uses snake_case — so we have to translate our camelCase domain types.

function toSnakeMetric(m: Metric): Record<string, unknown> {
  return {
    id: m.id,
    catalog_id: m.catalogId,
    name: m.name,
    display_name: m.displayName,
    description: m.description,
    metric_type: m.metricType,
    expression: m.expression,
    base_query: m.baseQuery,
    dimensions: JSON.stringify(m.dimensions),
    filters: JSON.stringify(m.filters),
    aggregation_timeframe: m.aggregationTimeframe,
    unit_of_measurement: m.unitOfMeasurement,
    owner_email: m.ownerEmail,
    status: m.status,
    approved_by: m.approvedBy,
    approved_at: m.approvedAt,
    version: m.version,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
  };
}

function toSnakeEntity(e: Entity): Record<string, unknown> {
  return {
    id: e.id,
    catalog_id: e.catalogId,
    name: e.name,
    display_name: e.displayName,
    description: e.description,
    classification: e.classification,
    primary_key_columns: JSON.stringify(e.primaryKeyColumns),
    member_tables: e.memberTables.join(","),
    join_paths: e.joinPaths,
    owner_email: e.ownerEmail,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
  };
}

function toSnakeNode(n: LineageNode): Record<string, unknown> {
  return {
    id: n.id,
    catalog_id: n.catalogId,
    node_type: n.nodeType,
    resource_id: n.resourceId,
    display_name: n.displayName,
    datasource_id: n.datasourceId,
    workspace_id: n.workspaceId,
    metadata: n.metadata,
    created_at: n.createdAt,
  };
}

function toSnakeEdge(e: LineageEdge): Record<string, unknown> {
  return {
    id: e.id,
    catalog_id: e.catalogId,
    source_node_id: e.sourceNodeId,
    target_node_id: e.targetNodeId,
    edge_type: e.edgeType,
    transform: e.transform,
    confidence: e.confidence,
    created_at: e.createdAt,
  };
}
