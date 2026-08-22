"use client";

import React from "react";
import { useEffect, useState } from "react";
import type {
  CellOutputChart,
  DashboardWidget,
} from "./notebook-types";

const PALETTE = ["#3f769b", "#3f827f", "#74628f", "#9a6a30", "#a24f49", "#635c8e"];

interface WidgetViewProps {
  widget: DashboardWidget;
  onChange?: (patch: Partial<DashboardWidget>) => void;
  onRemove?: () => void;
  /** When true the widget renders in compact mode (no header chrome). */
  compact?: boolean;
  /** True while the parent store is running a forced refresh. */
  refreshing?: boolean;
}

export function WidgetView(props: WidgetViewProps) {
  const { widget, onChange, onRemove, compact, refreshing } = props;
  const cache = widget.cache;
  const hasError = Boolean(cache?.error);
  const isEmpty = Boolean(cache?.empty);

  return (
    <div
      data-testid={`dashboard-widget-${widget.id}`}
      className="group relative flex h-full flex-col rounded-xl border border-border bg-surface shadow-card transition hover:shadow-card-hover"
    >
      {!compact && (
        <header className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold uppercase text-primary">
            {widget.kind}
          </span>
          <h3 className="flex-1 truncate font-medium text-foreground">{widget.title}</h3>
          {hasError && (
            <span
              title={cache?.error ?? ""}
              className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700"
            >
              error
            </span>
          )}
          {!hasError && isEmpty && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              empty
            </span>
          )}
          {!hasError && !isEmpty && cache && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              live
            </span>
          )}
          {refreshing && (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
              refreshing
            </span>
          )}
          {onChange && (
            <input
              className="hidden w-32 rounded border border-border bg-surface px-2 py-1 text-[11px] group-hover:block focus:border-primary focus:outline-none"
              defaultValue={widget.title}
              onBlur={(e) => onChange({ title: e.target.value })}
            />
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="hidden rounded border border-rose-300 px-2 py-1 text-[11px] text-rose-700 group-hover:block hover:bg-rose-50"
            >
              ×
            </button>
          )}
        </header>
      )}
      <div className="flex-1 p-3">
        {hasError && cache?.error ? (
          <ErrorState message={cache.error} updatedAt={cache.updatedAt} />
        ) : (
          <WidgetBody widget={widget} />
        )}
      </div>
      {!compact && (
        <footer className="flex items-center justify-between border-t border-border bg-surface-subtle px-3 py-1 text-[10px] text-muted">
          <span>{cache?.updatedAt ? new Date(cache.updatedAt).toLocaleTimeString() : "—"}</span>
          {typeof widget.refreshIntervalMs === "number" && widget.refreshIntervalMs > 0 ? (
            <CountdownChip intervalMs={widget.refreshIntervalMs} updatedAt={cache?.updatedAt} />
          ) : (
            <span>manual</span>
          )}
        </footer>
      )}
    </div>
  );
}

function CountdownChip({
  intervalMs,
  updatedAt,
}: {
  intervalMs: number;
  updatedAt?: string;
}) {
  const [remaining, setRemaining] = useState<number>(() =>
    computeRemaining(intervalMs, updatedAt),
  );
  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(computeRemaining(intervalMs, updatedAt));
    }, 1_000);
    return () => clearInterval(id);
  }, [intervalMs, updatedAt]);
  if (remaining <= 0) {
    return <span className="text-amber-700">refreshing…</span>;
  }
  return <span>next refresh in {Math.ceil(remaining / 1000)}s</span>;
}

function computeRemaining(intervalMs: number, updatedAt?: string): number {
  if (!updatedAt) return intervalMs;
  const elapsed = Date.now() - Date.parse(updatedAt);
  return Math.max(0, intervalMs - elapsed);
}

function WidgetBody({ widget }: { widget: DashboardWidget }) {
  switch (widget.kind) {
    case "kpi":
      return <KpiWidget value={widget.cache?.value} />;
    case "table":
      return widget.cache?.table ? (
        <TableWidget columns={widget.cache.table.columns} rows={widget.cache.table.rows} />
      ) : (
        <EmptyState text="No data cached yet." />
      );
    case "markdown":
      return widget.cache?.markdown ? (
        <MarkdownWidget markdown={widget.cache.markdown} />
      ) : (
        <EmptyState text="Add markdown in the widget editor." />
      );
    case "line-chart":
    case "area-chart":
    case "bar-chart":
      return widget.cache?.series ? (
        <ChartWidget
          chartType={widget.kind === "area-chart" ? "area" : widget.kind === "bar-chart" ? "bar" : "line"}
          series={widget.cache.series}
        />
      ) : (
        <EmptyState text="No series cached yet." />
      );
    case "trace-mini":
      return <TraceMiniWidget />;
    default:
      return <EmptyState text="Unknown widget." />;
  }
}

function KpiWidget({ value }: { value?: number | string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <span className="text-3xl font-semibold tabular-nums text-foreground">
        {value ?? "—"}
      </span>
    </div>
  );
}

function TableWidget({
  columns,
  rows,
}: {
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
}) {
  if (rows.length === 0) {
    return <EmptyState text="Empty table." />;
  }
  return (
    <div className="h-full overflow-auto">
      <table className="min-w-full text-xs">
        <thead className="sticky top-0 bg-surface">
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                className="border-b border-border bg-surface-subtle px-3 py-1 text-left font-semibold text-foreground"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rIdx) => (
            <tr key={rIdx} className="odd:bg-surface even:bg-surface-subtle">
              {row.map((value, cIdx) => (
                <td key={cIdx} className="border-b border-border px-3 py-1 text-foreground">
                  {String(value ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarkdownWidget({ markdown }: { markdown: string }) {
  return (
    <div className="prose prose-sm max-w-none text-foreground">
      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{markdown}</pre>
    </div>
  );
}

function ChartWidget({
  chartType,
  series,
}: {
  chartType: CellOutputChart["chartType"];
  series: CellOutputChart["series"];
}) {
  const bounds = series.reduce(
    (acc, s) => {
      for (const y of s.y) {
        if (y < acc.min) acc.min = y;
        if (y > acc.max) acc.max = y;
      }
      return acc;
    },
    { min: 0, max: 1 },
  );
  const span = Math.max(1e-6, bounds.max - bounds.min);
  const step = series[0]?.x.length <= 1 ? 0 : 280 / (series[0].x.length - 1);
  return (
    <div className="flex h-full flex-col">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px]">
        {series.map((s, i) => (
          <span key={s.name} className="flex items-center gap-1 text-foreground">
            <span
              className="inline-block h-2 w-3 rounded-full"
              style={{ background: PALETTE[i % PALETTE.length] }}
            />
            {s.name}
          </span>
        ))}
      </div>
      <svg viewBox="0 0 320 100" className="flex-1">
        {series.map((s, idx) => {
          const points = s.y
            .map((y, i) => {
              const px = 20 + i * step;
              const py = 90 - ((y - bounds.min) / span) * 70;
              return `${px.toFixed(2)},${py.toFixed(2)}`;
            })
            .join(" ");
          const color = PALETTE[idx % PALETTE.length];
          if (chartType === "bar") {
            return (
              <g key={s.name}>
                {s.y.map((y, i) => {
                  const px = 20 + i * step;
                  const py = 90 - ((y - bounds.min) / span) * 70;
                  return (
                    <rect
                      key={i}
                      x={px - 6}
                      y={py}
                      width={12}
                      height={90 - py}
                      fill={color}
                      rx={2}
                    />
                  );
                })}
              </g>
            );
          }
          if (chartType === "area") {
            return (
              <g key={s.name}>
                <polyline
                  points={`20,90 ${points} 300,90`}
                  fill={color}
                  fillOpacity={0.2}
                  stroke="none"
                />
                <polyline
                  points={points}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                />
              </g>
            );
          }
          if (chartType === "scatter") {
            return (
              <g key={s.name}>
                {s.y.map((y, i) => {
                  const px = 20 + i * step;
                  const py = 90 - ((y - bounds.min) / span) * 70;
                  return <circle key={i} cx={px} cy={py} r={3.5} fill={color} />;
                })}
              </g>
            );
          }
          return (
            <g key={s.name}>
              <polyline points={points} fill="none" stroke={color} strokeWidth={2} />
              {s.y.map((y, i) => {
                const px = 20 + i * step;
                const py = 90 - ((y - bounds.min) / span) * 70;
                return <circle key={i} cx={px} cy={py} r={2.5} fill={color} />;
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function TraceMiniWidget() {
  return (
    <div className="flex h-full flex-col gap-2">
      <p className="text-xs text-muted">
        Latest agent trace (read-only mini viewer).
      </p>
      <div className="flex-1 rounded-md border border-dashed border-border bg-surface-subtle p-2 text-[11px]">
        <ol className="space-y-1">
          {["plan", "sql.query", "artifact", "python.eval", "answer"].map((step, idx) => (
            <li key={step} className="flex items-center gap-2">
              <span className="rounded-full bg-primary px-2 text-[10px] font-semibold text-white">
                {idx + 1}
              </span>
              <span className="flex-1 truncate text-foreground">{step}</span>
              <span className="text-emerald-700">✓</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border bg-surface-subtle text-xs text-muted">
      {text}
    </div>
  );
}

function ErrorState({ message, updatedAt }: { message: string; updatedAt?: string }) {
  return (
    <div className="flex h-full flex-col gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
      <div className="flex items-center gap-2 font-semibold">
        <span className="rounded-full bg-rose-200 px-2 py-0.5 text-[10px] uppercase">refresh failed</span>
      </div>
      <p className="overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed">
        {message}
      </p>
      {updatedAt && (
        <span className="text-[10px] text-rose-500">
          last attempt {new Date(updatedAt).toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}