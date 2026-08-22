"use client";

import { useMemo } from "react";
import type {
  CellOutput,
  CellOutputChart,
  CellOutputTable,
  NotebookCell,
} from "./notebook-types";

const KIND_LABEL: Record<NotebookCell["kind"], string> = {
  markdown: "Markdown",
  sql: "SQL",
  python: "Python",
  "ai-prompt": "AI prompt",
};

const STATUS_TONE: Record<NotebookCell["status"], string> = {
  idle: "bg-surface-subtle text-muted",
  queued: "bg-amber-100 text-amber-900",
  running: "bg-blue-100 text-blue-900",
  completed: "bg-emerald-100 text-emerald-900",
  failed: "bg-rose-100 text-rose-900",
  canceled: "bg-surface-subtle text-muted",
};

interface CellCardProps {
  cell: NotebookCell;
  index: number;
  total: number;
  onChange: (patch: Partial<NotebookCell>) => void;
  onRun: () => void;
  onRemove: () => void;
  onMove: (direction: "up" | "down") => void;
  onPromoteToDashboard?: () => void;
}

export function CellCard(props: CellCardProps) {
  const { cell, index, total, onChange, onRun, onRemove, onMove, onPromoteToDashboard } = props;
  return (
    <article
      data-testid={`notebook-cell-${cell.id}`}
      className="rounded-xl border border-border bg-surface shadow-card transition hover:shadow-card-hover"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs">
        <span className="rounded-full bg-primary px-2 py-0.5 font-semibold text-white">
          {index + 1}
        </span>
        <span className="font-semibold text-foreground">{KIND_LABEL[cell.kind]}</span>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-[11px] ${STATUS_TONE[cell.status]}`}
        >
          {cell.status}
        </span>
        {cell.durationMs !== undefined && (
          <span className="text-muted">{cell.durationMs} ms</span>
        )}
      </header>

      <div className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_220px]">
        <div>
          {cell.kind === "markdown" ? (
            <textarea
              className="min-h-[120px] w-full resize-y rounded-md border border-border bg-surface-subtle p-3 font-mono text-sm focus:border-primary focus:outline-none"
              value={cell.source}
              onChange={(e) => onChange({ source: e.target.value })}
              placeholder="## Heading"
            />
          ) : (
            <textarea
              className="min-h-[120px] w-full resize-y rounded-md border border-border bg-code-bg p-3 font-mono text-xs text-emerald-100 focus:border-primary focus:outline-none"
              value={cell.source}
              onChange={(e) => onChange({ source: e.target.value })}
              placeholder={
                cell.kind === "sql"
                  ? "SELECT * FROM orders LIMIT 10;"
                  : cell.kind === "python"
                    ? "import pandas as pd\nprint(df.head())"
                    : "Ask the agent to draft a query…"
              }
              spellCheck={false}
            />
          )}
        </div>

        <div className="space-y-2">
          {cell.kind === "ai-prompt" && (
            <label className="block text-[11px] uppercase tracking-wide text-muted">
              Model
              <select
                className="mt-1 block w-full rounded-md border border-border bg-surface px-2 py-1 text-xs focus:border-primary focus:outline-none"
                value={cell.model ?? "server-default"}
                onChange={(e) => onChange({ model: e.target.value })}
              >
                <option value="server-default">server-default</option>
                <option value="qwen3.8-max">qwen3.8-max</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
              </select>
            </label>
          )}
          <textarea
            className="h-20 w-full resize-none rounded-md border border-border bg-surface-subtle p-2 text-xs"
            placeholder="Notes for future me…"
            value={cell.notes ?? ""}
            onChange={(e) => onChange({ notes: e.target.value })}
          />
        </div>
      </div>

      {cell.outputs.length > 0 && (
        <div className="border-t border-border bg-surface-subtle px-4 py-3">
          {cell.outputs.map((output, i) => (
            <OutputView key={i} output={output} />
          ))}
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2 text-xs">
        <button
          type="button"
          onClick={onRun}
          className="rounded-md bg-primary px-3 py-1 text-white transition hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-60"
          disabled={cell.status === "running"}
        >
          {cell.status === "running" ? "Running…" : "Run cell"}
        </button>
        <button
          type="button"
          onClick={onMove.bind(null, "up")}
          className="rounded-md border border-border px-2 py-1 text-muted transition hover:text-foreground disabled:opacity-40"
          disabled={index === 0}
        >
          ↑
        </button>
        <button
          type="button"
          onClick={onMove.bind(null, "down")}
          className="rounded-md border border-border px-2 py-1 text-muted transition hover:text-foreground disabled:opacity-40"
          disabled={index === total - 1}
        >
          ↓
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto rounded-md border border-rose-300 px-2 py-1 text-rose-700 transition hover:bg-rose-50"
        >
          Delete
        </button>
        {onPromoteToDashboard && (
          <button
            type="button"
            onClick={onPromoteToDashboard}
            className="rounded-md border border-emerald-300 px-2 py-1 text-emerald-700 transition hover:bg-emerald-50"
          >
            Promote to dashboard
          </button>
        )}
      </footer>
    </article>
  );
}

function OutputView({ output }: { output: CellOutput }) {
  if (output.kind === "text") {
    return <pre className="whitespace-pre-wrap font-mono text-xs text-foreground">{output.text}</pre>;
  }
  if (output.kind === "error") {
    return (
      <pre className="whitespace-pre-wrap rounded-md bg-rose-50 p-3 font-mono text-xs text-rose-900">
        {output.message}
        {output.traceback ? `\n\n${output.traceback}` : ""}
      </pre>
    );
  }
  if (output.kind === "data-source") {
    return (
      <p className="text-xs text-muted">
        Bound to datasource <code className="rounded bg-surface px-1">{output.datasourceId}</code>
        {output.rowLimit !== undefined && <> · row limit {output.rowLimit}</>}.
      </p>
    );
  }
  if (output.kind === "table") {
    return <TableView table={output} />;
  }
  if (output.kind === "chart") {
    return <ChartView chart={output} />;
  }
  return null;
}

function TableView({ table }: { table: CellOutputTable }) {
  const truncated = table.truncated ?? false;
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-surface">
      <table className="min-w-full text-xs">
        <thead>
          <tr>
            {table.columns.map((c) => (
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
          {table.rows.map((row, rIdx) => (
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
      {truncated && (
        <p className="border-t border-border bg-surface-subtle px-3 py-1 text-[11px] text-muted">
          Showing the first {table.rows.length} rows.
        </p>
      )}
    </div>
  );
}

function ChartView({ chart }: { chart: CellOutputChart }) {
  const bounds = useMemo(() => {
    const allY = chart.series.flatMap((s) => s.y);
    if (allY.length === 0) return { min: 0, max: 1 };
    return { min: Math.min(...allY), max: Math.max(...allY) };
  }, [chart]);

  const palette = ["#3f769b", "#3f827f", "#74628f", "#9a6a30", "#a24f49"];

  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
        {chart.series.map((s, i) => (
          <span key={s.name} className="flex items-center gap-1 text-foreground">
            <span
              className="inline-block h-2 w-3 rounded-full"
              style={{ background: palette[i % palette.length] }}
            />
            {s.name}
          </span>
        ))}
      </div>
      <svg viewBox="0 0 320 120" className="h-32 w-full">
        {chart.series.map((series, idx) => (
          <Polyline
            key={series.name}
            series={series}
            color={palette[idx % palette.length]}
            bounds={bounds}
          />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>{chart.xLabel ?? ""}</span>
        <span>{chart.yLabel ?? ""}</span>
      </div>
    </div>
  );
}

function Polyline({
  series,
  color,
  bounds,
}: {
  series: CellOutputChart["series"][number];
  color: string;
  bounds: { min: number; max: number };
}) {
  const span = Math.max(1e-6, bounds.max - bounds.min);
  const step = series.x.length <= 1 ? 0 : 280 / (series.x.length - 1);
  const points = series.y
    .map((y, i) => {
      const px = 20 + i * step;
      const py = 100 - ((y - bounds.min) / span) * 80;
      return `${px.toFixed(2)},${py.toFixed(2)}`;
    })
    .join(" ");
  return (
    <g>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {series.y.map((y, i) => {
        const px = 20 + i * step;
        const py = 100 - ((y - bounds.min) / span) * 80;
        return <circle key={i} cx={px} cy={py} r={2.5} fill={color} />;
      })}
    </g>
  );
}

export { KIND_LABEL };