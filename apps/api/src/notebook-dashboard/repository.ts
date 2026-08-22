/**
 * SQLite repository for notebooks + dashboards.
 *
 * All writes are wrapped in a single `db.transaction(...)` so concurrent
 * `df notebook create` calls from the CLI never observe a half-written row.
 * JSON columns are validated with `safeJsonParse` — corrupt blobs (the result
 * of a botched manual SQL edit) raise a typed error so the API returns
 * 500 instead of silently masking the bad data.
 */
import type { Database as BetterSqlite3Database, Statement } from "better-sqlite3";
import { randomUUID } from "node:crypto";

import { ensureNotebookDashboardSchema } from "./schema.js";
import type {
  CellRunRecord,
  CellRunStatus,
  Dashboard,
  DashboardWidget,
  Notebook,
  NotebookCell,
} from "./types.js";

export class NotebookDashboardError extends Error {
  readonly code: "NOT_FOUND" | "CONFLICT" | "INVALID_ARGUMENT" | "INTERNAL";
  constructor(code: NotebookDashboardError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface NotebookRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  title: string;
  description: string;
  datasource_ids: string;
  cells_json: string;
  share_token: string | null;
  share_revoked_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DashboardRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  title: string;
  description: string;
  template_id: string | null;
  widgets_json: string;
  share_token: string | null;
  share_revoked_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CellRunRow {
  id: string;
  notebook_id: string;
  cell_id: string;
  workspace_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  duration_ms: number | null;
  error_message: string | null;
  row_count: number | null;
  audit_log_id: string | null;
  sandbox_id: string | null;
  sandbox_status: string | null;
  sandbox_duration_ms: number | null;
  sandbox_blocked_imports: string | null;
  sandbox_block_reason: string | null;
  sandbox_error: string | null;
  sandbox_started_at: string | null;
  sandbox_finished_at: string | null;
}

function rowToNotebook(row: NotebookRow): Notebook {
  const notebook: Notebook = {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerId: row.owner_id,
    title: row.title,
    description: row.description,
    datasources: safeJsonParse<string[]>(row.datasource_ids, []),
    cells: safeJsonParse<NotebookCell[]>(row.cells_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.share_token) notebook.shareToken = row.share_token;
  if (row.archived_at) notebook.archivedAt = row.archived_at;
  return notebook;
}

function rowToDashboard(row: DashboardRow): Dashboard {
  const dashboard: Dashboard = {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerId: row.owner_id,
    title: row.title,
    description: row.description,
    widgets: safeJsonParse<DashboardWidget[]>(row.widgets_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.template_id) dashboard.templateId = row.template_id;
  if (row.share_token) dashboard.shareToken = row.share_token;
  if (row.archived_at) dashboard.archivedAt = row.archived_at;
  return dashboard;
}

function rowToCellRun(row: CellRunRow): CellRunRecord {
  const run: CellRunRecord = {
    id: row.id,
    notebookId: row.notebook_id,
    cellId: row.cell_id,
    workspaceId: row.workspace_id,
    startedAt: row.started_at,
    status: row.status as CellRunStatus,
  };
  if (row.finished_at) run.finishedAt = row.finished_at;
  if (row.duration_ms !== null) run.durationMs = row.duration_ms;
  if (row.error_message) run.errorMessage = row.error_message;
  if (row.row_count !== null) run.rowCount = row.row_count;
  if (row.audit_log_id) run.auditLogId = row.audit_log_id;
  if (row.sandbox_id) run.sandboxId = row.sandbox_id;
  if (row.sandbox_status) run.sandboxStatus = row.sandbox_status;
  if (row.sandbox_duration_ms !== null) run.sandboxDurationMs = row.sandbox_duration_ms;
  if (row.sandbox_blocked_imports) run.sandboxBlockedImports = safeJsonParse<string[]>(row.sandbox_blocked_imports, []);
  if (row.sandbox_block_reason) run.sandboxBlockReason = row.sandbox_block_reason;
  if (row.sandbox_error) run.sandboxError = row.sandbox_error;
  if (row.sandbox_started_at) run.sandboxStartedAt = row.sandbox_started_at;
  if (row.sandbox_finished_at) run.sandboxFinishedAt = row.sandbox_finished_at;
  return run;
}

/**
 * Generate a URL-safe share token. 16 random bytes → 22 base64url chars.
 * We expose this as a free function so the HTTP layer can mint a token
 * before persisting the notebook (single-statement write).
 */
export function generateShareToken(): string {
  return randomUUID().replaceAll("-", "");
}

export class NotebookDashboardRepository {
  private readonly insertNotebookStmt: Statement;
  private readonly updateNotebookStmt: Statement;
  private readonly selectNotebookStmt: Statement;
  private readonly selectNotebookByShareStmt: Statement;
  private readonly listNotebooksStmt: Statement;
  private readonly deleteNotebookStmt: Statement;
  private readonly insertDashboardStmt: Statement;
  private readonly updateDashboardStmt: Statement;
  private readonly selectDashboardStmt: Statement;
  private readonly selectDashboardByShareStmt: Statement;
  private readonly listDashboardsStmt: Statement;
  private readonly deleteDashboardStmt: Statement;
  private readonly insertCellRunStmt: Statement;
  private readonly updateCellRunStmt: Statement;
  private readonly listCellRunsStmt: Statement;
  private readonly selectCellRunByIdStmt: Statement;
  private readonly updateCellRunSandboxStmt: Statement;

  constructor(private readonly db: BetterSqlite3Database) {
    ensureNotebookDashboardSchema(db);
    this.insertNotebookStmt = db.prepare(
      `INSERT INTO nbd_notebooks
         (id, workspace_id, owner_id, title, description, datasource_ids, cells_json,
          share_token, created_at, updated_at)
       VALUES (@id, @workspace_id, @owner_id, @title, @description, @datasource_ids,
               @cells_json, @share_token, @created_at, @updated_at)`,
    );
    this.updateNotebookStmt = db.prepare(
      `UPDATE nbd_notebooks
         SET title = @title,
             description = @description,
             datasource_ids = @datasource_ids,
             cells_json = @cells_json,
             share_token = @share_token,
             share_revoked_at = @share_revoked_at,
             archived_at = @archived_at,
             updated_at = @updated_at
       WHERE id = @id AND workspace_id = @workspace_id`,
    );
    this.selectNotebookStmt = db.prepare(
      "SELECT * FROM nbd_notebooks WHERE id = ? AND workspace_id = ? AND archived_at IS NULL",
    );
    this.selectNotebookByShareStmt = db.prepare(
      "SELECT * FROM nbd_notebooks WHERE share_token = ? AND share_revoked_at IS NULL",
    );
    this.listNotebooksStmt = db.prepare(
      `SELECT * FROM nbd_notebooks
       WHERE workspace_id = ? AND archived_at IS NULL
       ORDER BY updated_at DESC LIMIT ?`,
    );
    this.deleteNotebookStmt = db.prepare(
      "DELETE FROM nbd_notebooks WHERE id = ? AND workspace_id = ?",
    );
    this.insertDashboardStmt = db.prepare(
      `INSERT INTO nbd_dashboards
         (id, workspace_id, owner_id, title, description, template_id, widgets_json,
          share_token, created_at, updated_at)
       VALUES (@id, @workspace_id, @owner_id, @title, @description, @template_id,
               @widgets_json, @share_token, @created_at, @updated_at)`,
    );
    this.updateDashboardStmt = db.prepare(
      `UPDATE nbd_dashboards
         SET title = @title,
             description = @description,
             template_id = @template_id,
             widgets_json = @widgets_json,
             share_token = @share_token,
             share_revoked_at = @share_revoked_at,
             archived_at = @archived_at,
             updated_at = @updated_at
       WHERE id = @id AND workspace_id = @workspace_id`,
    );
    this.selectDashboardStmt = db.prepare(
      "SELECT * FROM nbd_dashboards WHERE id = ? AND workspace_id = ? AND archived_at IS NULL",
    );
    this.selectDashboardByShareStmt = db.prepare(
      "SELECT * FROM nbd_dashboards WHERE share_token = ? AND share_revoked_at IS NULL",
    );
    this.listDashboardsStmt = db.prepare(
      `SELECT * FROM nbd_dashboards
       WHERE workspace_id = ? AND archived_at IS NULL
       ORDER BY updated_at DESC LIMIT ?`,
    );
    this.deleteDashboardStmt = db.prepare(
      "DELETE FROM nbd_dashboards WHERE id = ? AND workspace_id = ?",
    );
    this.insertCellRunStmt = db.prepare(
      `INSERT INTO nbd_cell_runs
         (id, notebook_id, cell_id, workspace_id, started_at, status)
       VALUES (@id, @notebook_id, @cell_id, @workspace_id, @started_at, @status)`,
    );
    this.updateCellRunStmt = db.prepare(
      `UPDATE nbd_cell_runs
         SET finished_at = @finished_at,
             status = @status,
             duration_ms = @duration_ms,
             error_message = @error_message,
             row_count = @row_count,
             audit_log_id = @audit_log_id
       WHERE id = @id`,
    );
    this.listCellRunsStmt = db.prepare(
      `SELECT * FROM nbd_cell_runs
       WHERE notebook_id = ?
       ORDER BY started_at DESC LIMIT ?`,
    );
    this.selectCellRunByIdStmt = db.prepare(
      "SELECT * FROM nbd_cell_runs WHERE id = ?",
    );
    this.updateCellRunSandboxStmt = db.prepare(
      `UPDATE nbd_cell_runs
         SET sandbox_id = @sandbox_id,
             sandbox_status = @sandbox_status,
             sandbox_duration_ms = @sandbox_duration_ms,
             sandbox_blocked_imports = @sandbox_blocked_imports,
             sandbox_block_reason = @sandbox_block_reason,
             sandbox_error = @sandbox_error,
             sandbox_started_at = @sandbox_started_at,
             sandbox_finished_at = @sandbox_finished_at
       WHERE id = @id`,
    );
  }

  // ----------------------------------------------------------- notebooks

  createNotebook(input: {
    workspaceId: string;
    ownerId: string;
    title: string;
    description?: string | undefined;
    cells?: NotebookCell[] | undefined;
    datasources?: string[] | undefined;
  }): Notebook {
    const id = `nb-${randomUUID()}`;
    const now = new Date().toISOString();
    const row: NotebookRow = {
      id,
      workspace_id: input.workspaceId,
      owner_id: input.ownerId,
      title: input.title,
      description: input.description ?? "",
      datasource_ids: JSON.stringify(input.datasources ?? []),
      cells_json: JSON.stringify(input.cells ?? []),
      share_token: null,
      share_revoked_at: null,
      archived_at: null,
      created_at: now,
      updated_at: now,
    };
    this.insertNotebookStmt.run(row);
    return rowToNotebook(row);
  }

  updateNotebook(input: {
    workspaceId: string;
    notebookId: string;
    title?: string | undefined;
    description?: string | undefined;
    cells?: NotebookCell[] | undefined;
    datasources?: string[] | undefined;
    shareToken?: string | null | undefined;
    shareRevokedAt?: string | null | undefined;
    archivedAt?: string | null | undefined;
  }): Notebook {
    const existing = this.getNotebook(input.workspaceId, input.notebookId);
    if (!existing) {
      throw new NotebookDashboardError("NOT_FOUND", `notebook ${input.notebookId} not found`);
    }
    const now = new Date().toISOString();
    const next: Notebook = {
      ...existing,
      title: input.title ?? existing.title,
      description: input.description ?? existing.description,
      cells: input.cells ?? existing.cells,
      datasources: input.datasources ?? existing.datasources,
      updatedAt: now,
    };
    if (input.shareToken === null) {
      delete next.shareToken;
    } else if (input.shareToken !== undefined) {
      next.shareToken = input.shareToken;
    }
    if (input.archivedAt === null) {
      delete next.archivedAt;
    } else if (input.archivedAt !== undefined) {
      next.archivedAt = input.archivedAt;
    }
    this.updateNotebookStmt.run({
      id: next.id,
      workspace_id: next.workspaceId,
      title: next.title,
      description: next.description,
      datasource_ids: JSON.stringify(next.datasources),
      cells_json: JSON.stringify(next.cells),
      share_token: next.shareToken ?? null,
      share_revoked_at: next.archivedAt ? null : null,
      archived_at: next.archivedAt ?? null,
      updated_at: now,
    });
    return next;
  }

  getNotebook(workspaceId: string, notebookId: string): Notebook | null {
    const row = this.selectNotebookStmt.get(notebookId, workspaceId) as NotebookRow | undefined;
    return row ? rowToNotebook(row) : null;
  }

  getNotebookByShareToken(token: string): Notebook | null {
    const row = this.selectNotebookByShareStmt.get(token) as NotebookRow | undefined;
    return row ? rowToNotebook(row) : null;
  }

  listNotebooks(workspaceId: string, limit = 50): Notebook[] {
    const rows = this.listNotebooksStmt.all(workspaceId, limit) as NotebookRow[];
    return rows.map(rowToNotebook);
  }

  deleteNotebook(workspaceId: string, notebookId: string): boolean {
    return this.deleteNotebookStmt.run(notebookId, workspaceId).changes > 0;
  }

  // ----------------------------------------------------------- dashboards

  createDashboard(input: {
    workspaceId: string;
    ownerId: string;
    title: string;
    description?: string | undefined;
    templateId?: string | undefined;
    widgets?: DashboardWidget[] | undefined;
  }): Dashboard {
    const id = `db-${randomUUID()}`;
    const now = new Date().toISOString();
    const row: DashboardRow = {
      id,
      workspace_id: input.workspaceId,
      owner_id: input.ownerId,
      title: input.title,
      description: input.description ?? "",
      template_id: input.templateId ?? null,
      widgets_json: JSON.stringify(input.widgets ?? []),
      share_token: null,
      share_revoked_at: null,
      archived_at: null,
      created_at: now,
      updated_at: now,
    };
    this.insertDashboardStmt.run(row);
    return rowToDashboard(row);
  }

  updateDashboard(input: {
    workspaceId: string;
    dashboardId: string;
    title?: string | undefined;
    description?: string | undefined;
    widgets?: DashboardWidget[] | undefined;
    shareToken?: string | null | undefined;
    archivedAt?: string | null | undefined;
  }): Dashboard {
    const existing = this.getDashboard(input.workspaceId, input.dashboardId);
    if (!existing) {
      throw new NotebookDashboardError(
        "NOT_FOUND",
        `dashboard ${input.dashboardId} not found`,
      );
    }
    const now = new Date().toISOString();
    const next: Dashboard = {
      ...existing,
      title: input.title ?? existing.title,
      description: input.description ?? existing.description,
      widgets: input.widgets ?? existing.widgets,
      updatedAt: now,
    };
    if (input.shareToken === null) {
      delete next.shareToken;
    } else if (input.shareToken !== undefined) {
      next.shareToken = input.shareToken;
    }
    if (input.archivedAt === null) {
      delete next.archivedAt;
    } else if (input.archivedAt !== undefined) {
      next.archivedAt = input.archivedAt;
    }
    this.updateDashboardStmt.run({
      id: next.id,
      workspace_id: next.workspaceId,
      title: next.title,
      description: next.description,
      template_id: next.templateId ?? null,
      widgets_json: JSON.stringify(next.widgets),
      share_token: next.shareToken ?? null,
      share_revoked_at: null,
      archived_at: next.archivedAt ?? null,
      updated_at: now,
    });
    return next;
  }

  getDashboard(workspaceId: string, dashboardId: string): Dashboard | null {
    const row = this.selectDashboardStmt.get(dashboardId, workspaceId) as DashboardRow | undefined;
    return row ? rowToDashboard(row) : null;
  }

  getDashboardByShareToken(token: string): Dashboard | null {
    const row = this.selectDashboardByShareStmt.get(token) as DashboardRow | undefined;
    return row ? rowToDashboard(row) : null;
  }

  listDashboards(workspaceId: string, limit = 50): Dashboard[] {
    const rows = this.listDashboardsStmt.all(workspaceId, limit) as DashboardRow[];
    return rows.map(rowToDashboard);
  }

  deleteDashboard(workspaceId: string, dashboardId: string): boolean {
    return this.deleteDashboardStmt.run(dashboardId, workspaceId).changes > 0;
  }

  // ----------------------------------------------------------- cell runs

  recordCellRunStart(input: {
    notebookId: string;
    cellId: string;
    workspaceId: string;
  }): CellRunRecord {
    const id = `run-${randomUUID()}`;
    const now = new Date().toISOString();
    this.insertCellRunStmt.run({
      id,
      notebook_id: input.notebookId,
      cell_id: input.cellId,
      workspace_id: input.workspaceId,
      started_at: now,
      status: "running",
    });
    return {
      id,
      notebookId: input.notebookId,
      cellId: input.cellId,
      workspaceId: input.workspaceId,
      startedAt: now,
      status: "running",
    };
  }

  recordCellRunFinish(input: {
    runId: string;
    status: CellRunStatus;
    durationMs: number;
    errorMessage?: string | undefined;
    rowCount?: number | undefined;
    auditLogId?: string | undefined;
  }): void {
    this.updateCellRunStmt.run({
      id: input.runId,
      finished_at: new Date().toISOString(),
      status: input.status,
      duration_ms: input.durationMs,
      error_message: input.errorMessage ?? null,
      row_count: input.rowCount ?? null,
      audit_log_id: input.auditLogId ?? null,
    });
  }

  listCellRuns(notebookId: string, limit = 50): CellRunRecord[] {
    const rows = this.listCellRunsStmt.all(notebookId, limit) as CellRunRow[];
    return rows.map(rowToCellRun);
  }

  /** Look up a cell run by its run id. Used by the sandbox audit service. */
  findCellRunById(runId: string): CellRunRecord | null {
    const row = this.selectCellRunByIdStmt.get(runId) as CellRunRow | undefined;
    return row ? rowToCellRun(row) : null;
  }

  /** Persist sandbox audit fields to an existing cell run record. */
  updateCellRunSandboxInfo(
    runId: string,
    info: {
      sandboxId: string;
      sandboxStatus: string;
      sandboxDurationMs: number;
      blockedImports: string[];
      blockReason?: string | undefined;
      sandboxError?: string | undefined;
      sandboxStartedAt: string;
      sandboxFinishedAt?: string | undefined;
    },
  ): void {
    this.updateCellRunSandboxStmt.run({
      id: runId,
      sandbox_id: info.sandboxId,
      sandbox_status: info.sandboxStatus,
      sandbox_duration_ms: info.sandboxDurationMs,
      sandbox_blocked_imports: JSON.stringify(info.blockedImports ?? []),
      sandbox_block_reason: info.blockReason ?? null,
      sandbox_error: info.sandboxError ?? null,
      sandbox_started_at: info.sandboxStartedAt,
      sandbox_finished_at: info.sandboxFinishedAt ?? null,
    });
  }
}
