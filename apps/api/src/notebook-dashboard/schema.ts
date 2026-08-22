/**
 * Production-grade persistence for `notebook` and `dashboard` resources.
 *
 * Tables (`nbd_*`) live in the same SQLite file as the rest of the workbench
 * metadata store. They are created on demand by `ensureNotebookDashboardSchema`,
 * so the package can be initialised both at server startup and inside the
 * hermetic test suite (which spins up an in-memory `Database`).
 *
 * Schema is intentionally minimal — JSON columns carry the rich document
 * payload (cells, widgets, layouts) while dedicated columns give us the
 * cheap OLTP fields used for listing, pagination, and audit-trail writes.
 */
import type { Database as BetterSqlite3Database } from "better-sqlite3";

const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS nbd_notebooks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    datasource_ids TEXT NOT NULL DEFAULT '[]',
    cells_json TEXT NOT NULL DEFAULT '[]',
    share_token TEXT,
    share_revoked_at TEXT,
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_nbd_notebooks_workspace_updated
     ON nbd_notebooks(workspace_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_nbd_notebooks_share_token
     ON nbd_notebooks(share_token) WHERE share_token IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS nbd_dashboards (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    template_id TEXT,
    widgets_json TEXT NOT NULL DEFAULT '[]',
    share_token TEXT,
    share_revoked_at TEXT,
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_nbd_dashboards_workspace_updated
     ON nbd_dashboards(workspace_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_nbd_dashboards_share_token
     ON nbd_dashboards(share_token) WHERE share_token IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS nbd_cell_runs (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL,
    cell_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT,
    status TEXT NOT NULL,
    duration_ms INTEGER,
    error_message TEXT,
    row_count INTEGER,
    audit_log_id TEXT,
    sandbox_id TEXT,
    sandbox_status TEXT,
    sandbox_duration_ms INTEGER,
    sandbox_blocked_imports TEXT,
    sandbox_block_reason TEXT,
    sandbox_error TEXT,
    sandbox_started_at TEXT,
    sandbox_finished_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_nbd_cell_runs_notebook
     ON nbd_cell_runs(notebook_id, started_at DESC)`,
];

/**
 * Idempotent — safe to call on every server boot.
 */
export function ensureNotebookDashboardSchema(db: BetterSqlite3Database): void {
  for (const stmt of SCHEMA_STATEMENTS) {
    try {
      db.exec(stmt);
    } catch (err) {
      console.error("[nbd-schema] exec failed:", stmt.substring(0, 80), err);
      throw err;
    }
  }
}
