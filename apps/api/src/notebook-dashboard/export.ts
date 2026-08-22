/**
 * Notebooks → Markdown / JSON exporters.
 *
 * The exporters are *pure* — they take a `Notebook` / `Dashboard` and return a string.
 * The HTTP layer owns auth + serialization, so the same exporters are
 * reusable from the CLI's `df notebook export` / `df dashboard export` subcommands.
 */
import type {
  CellOutput,
  CellRunStatus,
  Dashboard,
  DashboardWidget,
  Notebook,
  NotebookCell,
} from "./types.js";

export type ExportFormat = "markdown" | "json";

export function exportNotebook(notebook: Notebook, format: ExportFormat): string {
  if (format === "json") return exportJson(notebook);
  return exportMarkdown(notebook);
}

function exportJson(notebook: Notebook): string {
  // Strip server-only fields the consumer doesn't care about; keep the cell
  // history so a downstream re-import can replay the run.
  return JSON.stringify(notebook, null, 2);
}

function exportMarkdown(notebook: Notebook): string {
  const lines: string[] = [];
  lines.push(`# ${notebook.title || "Untitled notebook"}`);
  if (notebook.description) {
    lines.push("", notebook.description);
  }
  lines.push(
    "",
    `_Exported ${new Date().toISOString()} — workspace ${notebook.workspaceId}_`,
    "",
  );
  if (notebook.datasources.length > 0) {
    lines.push(
      "**Datasources:** " + notebook.datasources.map((id) => `\`${id}\``).join(", "),
      "",
    );
  }
  notebook.cells.forEach((cell, index) => {
    lines.push(`## Cell ${index + 1} · ${cell.kind}`);
    lines.push("");
    if (cell.source.trim()) {
      const fence = cell.kind === "sql" ? "sql" : cell.kind === "python" ? "python" : "";
      if (fence) {
        lines.push("```" + fence, cell.source.trim(), "```");
      } else {
        lines.push(cell.source.trim());
      }
      lines.push("");
    }
    const runLine = renderRunSummary(cell);
    if (runLine) {
      lines.push(runLine, "");
    }
    for (const output of cell.outputs) {
      const block = renderOutput(output);
      if (block) {
        lines.push(...block, "");
      }
    }
  });
  return lines.join("\n");
}

function renderRunSummary(cell: NotebookCell): string | null {
  const status = cell.status as CellRunStatus;
  if (status === "idle" || status === "queued") return null;
  const parts: string[] = [`**status:** \`${status}\``];
  if (typeof cell.durationMs === "number") parts.push(`**duration:** ${cell.durationMs}ms`);
  if (cell.lastRunAt) parts.push(`**last run:** ${cell.lastRunAt}`);
  return parts.join(" · ");
}

function renderOutput(output: CellOutput): string[] | null {
  switch (output.kind) {
    case "text":
      return ["> " + output.text.replace(/\n/g, "\n> ")];
    case "table":
      return [
        ...["", "| " + output.columns.join(" | ") + " |"],
        ["| " + output.columns.map(() => "---").join(" | ") + " |"].toString(),
        ...output.rows.map((row) => "| " + row.map(stringifyCell).join(" | ") + " |"),
      ];
    case "error":
      return ["**error:**", "```", output.message, "```"];
    case "chart":
      return [
        `*Chart (${output.chartType}) — ${output.series.length} series*`,
        ...output.series.map(
          (s) => `  - ${s.name}: ${s.x.length} points (x-axis: ${output.xLabel ?? "—"}, y-axis: ${output.yLabel ?? "—"})`,
        ),
      ];
    case "data-source":
      return [`*Live data source: \`${output.datasourceId}\`*`];
    default:
      return null;
  }
}

function stringifyCell(value: string | number | boolean | null): string {
  if (value === null) return "—";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "—";
  }
  return String(value).replace(/\|/g, "\\|");
}

// ---------------------------------------------------------------- Dashboard

/**
 * Export a dashboard to markdown or JSON.
 * The markdown format lists each widget with its layout position and cached content.
 */
export function exportDashboard(dashboard: Dashboard, format: ExportFormat): string {
  if (format === "json") return JSON.stringify(dashboard, null, 2);
  return exportDashboardMarkdown(dashboard);
}

function exportDashboardMarkdown(dashboard: Dashboard): string {
  const lines: string[] = [];
  lines.push(`# ${dashboard.title || "Untitled dashboard"}`);
  if (dashboard.description) {
    lines.push("", dashboard.description);
  }
  lines.push(
    "",
    `_Exported ${new Date().toISOString()} — workspace ${dashboard.workspaceId}_`,
    "",
  );
  if (dashboard.templateId) {
    lines.push(`**Template:** \`${dashboard.templateId}\``);
    lines.push("");
  }
  if (dashboard.widgets.length === 0) {
    lines.push("*No widgets yet.*");
    return lines.join("\n");
  }
  const sorted = [...dashboard.widgets].sort(
    (a, b) => a.layout.row - b.layout.row || a.layout.col - b.layout.col,
  );
  for (const widget of sorted) {
    const pos = `[row=${widget.layout.row} col=${widget.layout.col} ${widget.layout.width}×${widget.layout.height}]`;
    lines.push(`## ${widget.title || widget.id} ${pos}`);
    lines.push(`*kind:* \`${widget.kind}\``);
    lines.push("");
    if (widget.source) {
      const fence = widget.kind === "line-chart" || widget.kind === "bar-chart" || widget.kind === "area-chart" || widget.kind === "table"
        ? "sql"
        : "";
      if (fence) {
        lines.push("```" + fence, widget.source.trim(), "```");
      } else {
        lines.push(widget.source.trim());
      }
      lines.push("");
    }
    if (widget.datasourceId) {
      lines.push(`*data source:* \`${widget.datasourceId}\``);
      lines.push("");
    }
    if (widget.cache) {
      const c = widget.cache;
      lines.push(`*last refreshed:* ${c.updatedAt}`);
      if (c.error) {
        lines.push(`**error:** \`${c.error}\``);
        lines.push("");
      }
      if (c.value !== undefined) {
        lines.push(`**value:** ${c.value}`);
        lines.push("");
      }
      if (c.series && c.series.length > 0) {
        lines.push(`*${c.series.length} series*`);
        for (const s of c.series) {
          lines.push(`  - **${s.name}:** ${s.x.length} points`);
          if (s.x.length <= 5 && s.y.length <= 5) {
            lines.push("    " + s.x.map((v, i) => `(${v}, ${s.y[i]})`).join(" · "));
          }
        }
        lines.push("");
      }
      if (c.table) {
        lines.push(...renderTableMarkdown(c.table.columns, c.table.rows));
        lines.push("");
      }
      if (c.markdown) {
        lines.push(c.markdown, "");
      }
    }
  }
  return lines.join("\n");
}

function renderTableMarkdown(
  columns: string[],
  rows: Array<Array<string | number | boolean | null>>,
): string[] {
  const lines: string[] = [];
  lines.push("| " + columns.join(" | ") + " |");
  lines.push("| " + columns.map(() => "---").join(" | ") + " |");
  for (const row of rows) {
    lines.push("| " + row.map(stringifyCell).join(" | ") + " |");
  }
  return lines;
}