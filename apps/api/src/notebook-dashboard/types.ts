/**
 * Server-side domain types for notebooks and dashboards.
 *
 * These types intentionally mirror the surface the web UI expects (see
 * `apps/web/src/app/notebook/notebook-types.ts`) but live in the API package
 * because the API is the source of truth. The web UI is generated from these
 * types via the openapi schema when the API publishes one.
 *
 * Persisted JSON columns carry `cells` / `widgets` verbatim — we *do not*
 * normalise them into tables. Trade-off: cheaper reads, but column-level
 * indexing is impossible. Acceptable for the v1 release because the document
 * is small (cells are typically < 100, widgets < 50 per dashboard).
 */

export type CellKind = "markdown" | "sql" | "python" | "ai-prompt";

export type CellRunStatus =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled";

export interface CellOutputText {
  kind: "text";
  text: string;
}
export interface CellOutputTable {
  kind: "table";
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
  truncated?: boolean | undefined;
}
export interface CellOutputChart {
  kind: "chart";
  chartType: "line" | "bar" | "area" | "scatter";
  series: Array<{ name: string; x: Array<string | number>; y: Array<number> }>;
  xLabel?: string | undefined;
  yLabel?: string | undefined;
}
export interface CellOutputError {
  kind: "error";
  message: string;
  traceback?: string | undefined;
}
export interface CellOutputDataSource {
  kind: "data-source";
  datasourceId: string;
  rowLimit?: number | undefined;
}
export type CellOutput =
  | CellOutputText
  | CellOutputTable
  | CellOutputChart
  | CellOutputError
  | CellOutputDataSource;

export interface NotebookCell {
  id: string;
  kind: CellKind;
  source: string;
  model?: string | undefined;
  notes?: string | undefined;
  status: CellRunStatus;
  outputs: CellOutput[];
  durationMs?: number | undefined;
  lastRunAt?: string | undefined;
  focused?: boolean | undefined;
}

export interface Notebook {
  id: string;
  workspaceId: string;
  ownerId: string;
  title: string;
  description: string;
  datasources: string[];
  cells: NotebookCell[];
  shareToken?: string | undefined;
  archivedAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export type DashboardWidgetKind =
  | "kpi"
  | "line-chart"
  | "bar-chart"
  | "area-chart"
  | "table"
  | "markdown"
  | "trace-mini";

export interface DashboardWidget {
  id: string;
  kind: DashboardWidgetKind;
  title: string;
  source?: string | undefined;
  datasourceId?: string | undefined;
  /** Auto-refresh interval in milliseconds; 0 = manual refresh only. */
  refreshIntervalMs?: number | undefined;
  layout: { col: number; row: number; width: number; height: number };
  cache?: {
    value?: number | string | undefined;
    series?: Array<{ name: string; x: Array<string | number>; y: Array<number> }> | undefined;
    table?: { columns: string[]; rows: Array<Array<string | number | boolean | null>> } | undefined;
    markdown?: string | undefined;
    updatedAt: string;
    /** Error from the last refresh attempt; surfaces in the widget card. */
    error?: string | undefined;
    /** True when the last refresh produced no rows. */
    empty?: boolean | undefined;
  } | undefined;
}

export interface Dashboard {
  id: string;
  workspaceId: string;
  ownerId: string;
  title: string;
  description: string;
  templateId?: string | undefined;
  widgets: DashboardWidget[];
  shareToken?: string | undefined;
  archivedAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface CellRunRecord {
  id: string;
  notebookId: string;
  cellId: string;
  workspaceId: string;
  startedAt: string;
  finishedAt?: string | undefined;
  status: CellRunStatus;
  durationMs?: number | undefined;
  errorMessage?: string | undefined;
  rowCount?: number | undefined;
  auditLogId?: string | undefined;
  /** Sandbox audit fields (populated when the cell ran inside sandbox-python.ts) */
  sandboxId?: string | undefined;
  sandboxStatus?: string | undefined;
  sandboxDurationMs?: number | undefined;
  sandboxBlockedImports?: string[] | undefined;
  sandboxBlockReason?: string | undefined;
  sandboxError?: string | undefined;
  sandboxStartedAt?: string | undefined;
  sandboxFinishedAt?: string | undefined;
}
