/**
 * Client-side data model for the in-app Notebook (Jupyter-style cells) and
 * Dashboard templates.
 *
 * Mirrors the persistent storage shape exposed by the future
 * `/api/v1/notebooks` and `/api/v1/dashboards` endpoints so the UI can be
 * developed without the backend by falling back to `localStorage`.
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
  /** When true the table is paginated server-side; we show the first N rows. */
  truncated?: boolean;
}

export interface CellOutputChart {
  kind: "chart";
  chartType: "line" | "bar" | "area" | "scatter";
  series: Array<{
    name: string;
    x: Array<string | number>;
    y: Array<number>;
  }>;
  xLabel?: string;
  yLabel?: string;
}

export interface CellOutputError {
  kind: "error";
  message: string;
  traceback?: string;
}

export interface CellOutputDataSource {
  kind: "data-source";
  /** Reference to a registered datasource id in `/api/v1/datasources`. */
  datasourceId: string;
  /** Optional row limit applied by the SQL execution backend. */
  rowLimit?: number;
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
  /** When kind === "ai-prompt", the model that should answer the prompt. */
  model?: string;
  /** Free-form notes attached to a cell. */
  notes?: string;
  status: CellRunStatus;
  outputs: CellOutput[];
  /** Last execution duration in milliseconds. */
  durationMs?: number;
  /** ISO timestamp of the last successful run. */
  lastRunAt?: string;
  /** True when the cell is currently the "selected" cell in the editor. */
  focused?: boolean;
}

export interface Notebook {
  id: string;
  title: string;
  description?: string;
  /** ISO timestamp of the most recent save. */
  updatedAt: string;
  /** ISO timestamp of the most recent run. */
  lastRunAt?: string;
  /** List of datasource ids used by the notebook. */
  datasources: string[];
  cells: NotebookCell[];
  /** Soft-trash flag, the notebook is kept for 30 days after deletion. */
  archivedAt?: string;
  /** Reference to the workspace this notebook belongs to. */
  workspaceId?: string;
  /** Share-link token (rotates on revoke). */
  shareToken?: string;
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
  /** Optional SQL or python source backing the widget. */
  source?: string;
  /** Optional data-source reference. */
  datasourceId?: string;
  /** 12-column grid placement. */
  layout: {
    col: number;
    row: number;
    width: number;
    height: number;
  };
  /** Auto-refresh interval in milliseconds; 0 = manual refresh only. */
  refreshIntervalMs?: number;
  /** Cache of the latest resolved value — kept so the dashboard can render
   * without re-running the underlying query every paint. */
  cache?: {
    value?: number | string;
    series?: Array<{ name: string; x: Array<string | number>; y: Array<number> }>;
    table?: { columns: string[]; rows: Array<Array<string | number | boolean | null>> };
    markdown?: string;
    updatedAt: string;
    /** Error from the last refresh attempt; surfaces in the widget card UI. */
    error?: string;
    /** True when the last refresh produced no rows. */
    empty?: boolean;
  };
}

export interface DashboardTemplate {
  id: string;
  name: string;
  description: string;
  /** Default widgets rendered when the user picks "Use template". */
  widgets: DashboardWidget[];
  /** Optional cover image / emoji used in the picker card. */
  cover?: string;
}

/**
 * Built-in templates shown in the dashboard picker. Each template's widgets are
 * cloned per-dashboard on creation so the user can rearrange them without
 * mutating the shared definition.
 */
export const DASHBOARD_TEMPLATES: DashboardTemplate[] = [
  {
    id: "ops-overview",
    name: "Ops overview",
    cover: "🛰️",
    description: "Live KPIs for jobs, errors, and active users.",
    widgets: [
      {
        id: "w-kpi-runs",
        kind: "kpi",
        title: "Runs / hour",
        layout: { col: 0, row: 0, width: 3, height: 1 },
        refreshIntervalMs: 60_000,
      },
      {
        id: "w-kpi-errors",
        kind: "kpi",
        title: "Error rate",
        layout: { col: 3, row: 0, width: 3, height: 1 },
        refreshIntervalMs: 60_000,
      },
      {
        id: "w-line-runs",
        kind: "line-chart",
        title: "Run latency",
        layout: { col: 0, row: 1, width: 6, height: 2 },
        refreshIntervalMs: 60_000,
      },
    ],
  },
  {
    id: "sales-funnel",
    name: "Sales funnel",
    cover: "💰",
    description: "Lead → opportunity → closed revenue, weekly cadence.",
    widgets: [
      {
        id: "w-kpi-leads",
        kind: "kpi",
        title: "New leads",
        layout: { col: 0, row: 0, width: 3, height: 1 },
      },
      {
        id: "w-kpi-closed",
        kind: "kpi",
        title: "Closed ARR",
        layout: { col: 3, row: 0, width: 3, height: 1 },
      },
      {
        id: "w-bar-stage",
        kind: "bar-chart",
        title: "Stage breakdown",
        layout: { col: 0, row: 1, width: 6, height: 2 },
      },
    ],
  },
  {
    id: "blank",
    name: "Blank canvas",
    cover: "✨",
    description: "Empty grid — start from scratch.",
    widgets: [],
  },
];

export interface Dashboard {
  id: string;
  title: string;
  description?: string;
  templateId?: string;
  widgets: DashboardWidget[];
  updatedAt: string;
  workspaceId?: string;
}

export const NOTEBOOK_STORAGE_KEY = "dfd:notebook:v1";
export const DASHBOARD_STORAGE_KEY = "dfd:dashboard:v1";

export function emptyNotebook(): Notebook {
  return {
    id: `nb-${Math.random().toString(36).slice(2, 10)}`,
    title: "Untitled notebook",
    description: "",
    updatedAt: new Date().toISOString(),
    datasources: [],
    cells: [
      {
        id: `cell-${Math.random().toString(36).slice(2, 8)}`,
        kind: "markdown",
        source: "# Welcome\n\nUse **Markdown** cells for notes, **SQL** cells for queries,\nand **AI prompt** cells to ask the agent to draft Python for you.",
        status: "idle",
        outputs: [],
      },
    ],
  };
}

export function emptyDashboard(): Dashboard {
  return {
    id: `db-${Math.random().toString(36).slice(2, 10)}`,
    title: "Untitled dashboard",
    description: "",
    widgets: [],
    updatedAt: new Date().toISOString(),
  };
}