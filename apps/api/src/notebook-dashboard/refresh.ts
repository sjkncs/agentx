/**
 * Dashboard widget refresh engine.
 *
 * Each widget has an optional `source` (SQL) and `datasourceId`. The
 * refresher runs the source through `LocalDataGateway.runSqlReadonly`,
 * coerces the result into the widget's expected `cache` shape, and
 * returns it. Errors are returned as `cache.error` rather than raised
 * so a single broken widget never breaks the whole dashboard.
 *
 * Refresh semantics:
 * - `force=false` (default): if the widget's `refreshIntervalMs` has not
 *   elapsed since `cache.updatedAt`, return the existing cache.
 * - `force=true`: always re-run.
 */

import type { LocalDataGateway } from "@datafoundry/data-gateway";

import type { DashboardWidget } from "./types.js";

export interface WidgetRefreshContext {
  workspaceId: string;
  userId: string;
  gateway: LocalDataGateway;
  /** Hard ceiling on total refresh time per call. */
  timeoutMs?: number;
}

export interface WidgetRefreshOutput {
  widgetId: string;
  cache: DashboardWidget["cache"];
  /** True if this call actually re-ran the query. */
  fresh: boolean;
}

export interface RefreshRequest {
  widgetIds: string[];
  force?: boolean;
}

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;

export async function refreshDashboardWidgets(
  widgets: DashboardWidget[],
  request: RefreshRequest,
  ctx: WidgetRefreshContext,
): Promise<WidgetRefreshOutput[]> {
  const timeoutMs = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const start = Date.now();
  const outputs: WidgetRefreshOutput[] = [];
  for (const widget of widgets) {
    if (request.widgetIds.length > 0 && !request.widgetIds.includes(widget.id)) {
      continue;
    }
    if (Date.now() - start > timeoutMs) {
      // Stop early — the client can poll again.
      outputs.push({
        widgetId: widget.id,
        cache: widget.cache
          ? { ...widget.cache, error: "refresh timeout" }
          : { updatedAt: new Date().toISOString(), error: "refresh timeout" },
        fresh: false,
      });
      continue;
    }
    outputs.push(await refreshOne(widget, request.force ?? false, ctx));
  }
  return outputs;
}

async function refreshOne(
  widget: DashboardWidget,
  force: boolean,
  ctx: WidgetRefreshContext,
): Promise<WidgetRefreshOutput> {
  if (!widget.source || !widget.datasourceId) {
    // No backing data — return the existing cache untouched.
    return { widgetId: widget.id, cache: widget.cache, fresh: false };
  }
  const intervalMs = widget.refreshIntervalMs ?? DEFAULT_INTERVAL_MS;
  if (!force && widget.cache && Date.now() - Date.parse(widget.cache.updatedAt) < intervalMs) {
    return { widgetId: widget.id, cache: widget.cache, fresh: false };
  }
  try {
    const result = await ctx.gateway.runSqlReadonly({
      user_id: ctx.userId,
      workspace_id: ctx.workspaceId,
      datasource_id: widget.datasourceId,
      sql: widget.source,
    });
    const cache = coerceCache(widget, result);
    return { widgetId: widget.id, cache, fresh: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cache: DashboardWidget["cache"] = widget.cache
      ? { ...widget.cache, error: message, updatedAt: new Date().toISOString() }
      : { updatedAt: new Date().toISOString(), error: message };
    return { widgetId: widget.id, cache, fresh: false };
  }
}

function coerceCache(
  widget: DashboardWidget,
  result: { columns: string[]; rows: unknown[][]; row_count: number },
): DashboardWidget["cache"] {
  const updatedAt = new Date().toISOString();
  switch (widget.kind) {
    case "kpi": {
      const value = result.rows[0]?.[0];
      return {
        value: typeof value === "number" || typeof value === "string" ? value : value == null ? "—" : String(value),
        updatedAt,
        empty: result.row_count === 0,
      };
    }
    case "line-chart":
    case "bar-chart":
    case "area-chart": {
      if (result.columns.length < 2) {
        return {
          markdown: "Chart source must return at least two columns.",
          updatedAt,
          empty: result.row_count === 0,
        };
      }
      const xCol = result.columns[0]!;
      const seriesColumns = result.columns.slice(1);
      const xValues = result.rows.map((row) => row[0]);
      const series = seriesColumns.map((name, idx) => ({
        name,
        x: xValues as Array<string | number>,
        y: result.rows.map((row) => Number(row[idx + 1])),
      }));
      return { series, updatedAt, empty: result.row_count === 0 };
    }
    case "table": {
      return {
        table: {
          columns: result.columns,
          rows: result.rows.map((row) =>
            row.map((cell) => {
              if (cell === null || cell === undefined) return null;
              if (
                typeof cell === "string" ||
                typeof cell === "number" ||
                typeof cell === "boolean"
              ) {
                return cell;
              }
              return String(cell);
            }),
          ),
        },
        updatedAt,
        empty: result.row_count === 0,
      };
    }
    case "markdown":
    case "trace-mini":
    default:
      return { markdown: "", updatedAt };
  }
}