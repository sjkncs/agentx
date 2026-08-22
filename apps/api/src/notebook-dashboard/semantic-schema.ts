/**
 * SQLite schema for the semantic catalog.
 *
 * Design principles:
 *   - "Catalog" = workspace-scoped collection of semantic metadata
 *   - "Column description" = per-column human-readable description + semantic type
 *   - "Glossary term" = business-term → physical-name mapping
 *   - "Data contract" = schema-level expectations (nullability, range, freshness)
 *   - "Semantic binding" = links a requirement to specific catalog entities
 *
 * All tables are created idempotently so the server can be initialised at boot.
 */
import type { Database as BetterSqlite3Database } from "better-sqlite3";

const SCHEMA_STATEMENTS: readonly string[] = [
  // ── Semantic catalogs ───────────────────────────────────────────────────────
  // A catalog is a workspace-scoped collection of datasource schema metadata.
  `CREATE TABLE IF NOT EXISTS sem_catalogs (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    datasource_id TEXT NOT NULL,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    version       TEXT NOT NULL DEFAULT '1',
    revision      TEXT NOT NULL DEFAULT '0',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_sem_catalogs_workspace
     ON sem_catalogs(workspace_id, datasource_id)`,

  // ── Column descriptions ────────────────────────────────────────────────────
  // Per-column semantic metadata.  One row per catalog × table × column.
  `CREATE TABLE IF NOT EXISTS sem_column_descs (
    id              TEXT PRIMARY KEY,
    catalog_id      TEXT NOT NULL,
    table_name      TEXT NOT NULL,
    column_name     TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    semantic_type   TEXT NOT NULL DEFAULT '',
    -- semantic_type examples:
    --   "currency.amount", "person.email", "time.datetime", "geo.city",
    --   "identifier.order_id", "ratio.percentage", "category.status"
    -- empty string = no semantic type inferred / user didn't fill it in
    data_type       TEXT NOT NULL DEFAULT '',
    nullable         INTEGER NOT NULL DEFAULT 1,
    sample_values    TEXT NOT NULL DEFAULT '[]',
    -- JSON array of up to 5 sample values for quick reference
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(catalog_id, table_name, column_name)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_sem_column_descs_catalog
     ON sem_column_descs(catalog_id, table_name)`,

  // ── Glossary terms ─────────────────────────────────────────────────────────
  // Business term → physical column mappings.  One term may map to multiple columns.
  `CREATE TABLE IF NOT EXISTS sem_glossary_terms (
    id            TEXT PRIMARY KEY,
    catalog_id    TEXT NOT NULL,
    term          TEXT NOT NULL,
    -- e.g. "customer_id", "order_value", "churn_date"
    definition    TEXT NOT NULL DEFAULT '',
    business_type TEXT NOT NULL DEFAULT '',
    -- e.g. "identifier", "monetary_amount", "temporal_date"
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_sem_glossary_catalog
     ON sem_glossary_terms(catalog_id, term)`,

  // ── Glossary term → column bindings ────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS sem_term_bindings (
    id          TEXT PRIMARY KEY,
    term_id     TEXT NOT NULL,
    column_desc_id TEXT NOT NULL,
    confidence  REAL NOT NULL DEFAULT 1.0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(term_id, column_desc_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_sem_term_bindings_term
     ON sem_term_bindings(term_id)`,

  `CREATE INDEX IF NOT EXISTS idx_sem_term_bindings_col
     ON sem_term_bindings(column_desc_id)`,

  // ── Data contracts ─────────────────────────────────────────────────────────
  // Schema-level expectations for a table, used to validate query results.
  `CREATE TABLE IF NOT EXISTS sem_data_contracts (
    id            TEXT PRIMARY KEY,
    catalog_id    TEXT NOT NULL,
    table_name    TEXT NOT NULL,
    version       TEXT NOT NULL DEFAULT '1',
    description   TEXT NOT NULL DEFAULT '',
    expectations  TEXT NOT NULL DEFAULT '{}',
    -- JSON: { "column_name": { "not_null": true, "min": 0, "max": 100, "regex": null }, ... }
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_sem_data_contracts_catalog
     ON sem_data_contracts(catalog_id, table_name)`,

  // ── Semantic requirement bindings ───────────────────────────────────────────
  // Links analysis requirements (from the data-analysis protocol) to catalog entities.
  `CREATE TABLE IF NOT EXISTS sem_requirement_bindings (
    id                  TEXT PRIMARY KEY,
    catalog_id          TEXT NOT NULL,
    requirement_id     TEXT NOT NULL,
    -- e.g. "USER_REVENUE_TOTAL" — matches AnalysisRequirement.id from the protocol
    requirement_label  TEXT NOT NULL DEFAULT '',
    -- human-readable: "Total revenue by user"
    datasource_id      TEXT NOT NULL,
    table_name          TEXT NOT NULL,
    column_name         TEXT NOT NULL,
    binding_type        TEXT NOT NULL DEFAULT 'column',
    -- 'column' | 'aggregate' | 'join'
    sql_snippet         TEXT NOT NULL DEFAULT '',
    -- e.g. "SUM(order_amount)" for aggregates
    confidence          REAL NOT NULL DEFAULT 1.0,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_sem_req_bindings_catalog
     ON sem_requirement_bindings(catalog_id, requirement_id)`,

  `CREATE INDEX IF NOT EXISTS idx_sem_req_bindings_req
     ON sem_requirement_bindings(requirement_id)`,
];

export function ensureSemanticCatalogSchema(db: BetterSqlite3Database): void {
  for (const stmt of SCHEMA_STATEMENTS) {
    db.exec(stmt);
  }
}
