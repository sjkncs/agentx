/**
 * SQLite schema for cross-datasource federation metadata.
 *
 * Tables:
 *   fed_virtual_tables — registered cross-datasource "federated views"
 *   fed_join_paths    — known join relationships between datasources
 *   fed_execution_log — audit trail for federation queries
 *
 * A "virtual table" is a logical table that spans multiple physical datasources.
 * It has a canonical name and a decomposition plan that tells the federation
 * engine how to pull data from each source and reassemble it.
 */
import type { Database as BetterSqlite3Database } from "better-sqlite3";

const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS fed_virtual_tables (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    decomposition   TEXT NOT NULL DEFAULT '{}',
    -- JSON: {
    --   type: "union" | "join" | "materialize",
    --   sources: [{ datasourceId, tableName, columns: [...], predicate: "" }],
    --   join: { on: [{ left: "col", right: "col" }], type: "inner"|"left" },
    --   keyColumn: "col_name"  -- used for materialization
    -- }
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(workspace_id, name)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_fed_vtables_workspace
     ON fed_virtual_tables(workspace_id, name)`,

  `CREATE TABLE IF NOT EXISTS fed_join_paths (
    id                TEXT PRIMARY KEY,
    workspace_id      TEXT NOT NULL,
    name              TEXT NOT NULL,
    description       TEXT NOT NULL DEFAULT '',
    left_datasource   TEXT NOT NULL,
    left_table        TEXT NOT NULL,
    left_column       TEXT NOT NULL,
    right_datasource  TEXT NOT NULL,
    right_table       TEXT NOT NULL,
    right_column      TEXT NOT NULL,
    join_cardinality  TEXT NOT NULL DEFAULT 'many-to-one',
    -- 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many'
    confidence        REAL NOT NULL DEFAULT 0.8,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_fed_join_workspace
     ON fed_join_paths(workspace_id)`,

  `CREATE INDEX IF NOT EXISTS idx_fed_join_left
     ON fed_join_paths(left_datasource, left_table, left_column)`,

  `CREATE INDEX IF NOT EXISTS idx_fed_join_right
     ON fed_join_paths(right_datasource, right_table, right_column)`,

  `CREATE TABLE IF NOT EXISTS fed_execution_log (
    id                TEXT PRIMARY KEY,
    workspace_id      TEXT NOT NULL,
    user_id           TEXT NOT NULL,
    sql_text          TEXT NOT NULL,
    datasources_used  TEXT NOT NULL DEFAULT '[]',
    -- JSON array of datasource IDs
    plan_type         TEXT NOT NULL,
    -- 'native_pushdown' | 'duckdb_federation' | 'materialized'
    execution_ms      INTEGER,
    row_count         INTEGER,
    status            TEXT NOT NULL,
    error_message     TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_fed_exec_workspace
     ON fed_execution_log(workspace_id, created_at DESC)`,
];

export function ensureFederationSchema(db: BetterSqlite3Database): void {
  for (const stmt of SCHEMA_STATEMENTS) {
    db.exec(stmt);
  }
}
