import { describe, expect, it } from "vitest";

import { exportNotebook } from "./export.js";
import type { Notebook, NotebookCell } from "./types.js";

function buildCell(over: Partial<NotebookCell>): NotebookCell {
  return {
    id: over.id ?? "c-1",
    kind: over.kind ?? "sql",
    source: over.source ?? "",
    status: over.status ?? "completed",
    outputs: over.outputs ?? [],
    ...over,
  };
}

const notebook: Notebook = {
  id: "nb-1",
  workspaceId: "ws-1",
  ownerId: "user-1",
  title: "Revenue pipeline",
  description: "Weekly breakdown.",
  datasources: ["ds-1", "ds-2"],
  cells: [
    buildCell({
      id: "c-1",
      kind: "markdown",
      source: "# Welcome",
      outputs: [],
    }),
    buildCell({
      id: "c-2",
      kind: "sql",
      source: "SELECT region, SUM(amount) FROM orders GROUP BY 1",
      durationMs: 42,
      outputs: [
        {
          kind: "table",
          columns: ["region", "sum"],
          rows: [
            ["East", 12340],
            ["West", 9820],
          ],
        },
      ],
      lastRunAt: "2026-08-16T08:00:00Z",
    }),
    buildCell({
      id: "c-3",
      kind: "python",
      source: "print('hi')",
      status: "failed",
      outputs: [{ kind: "error", message: "Module not found" }],
    }),
  ],
  createdAt: "2026-08-15T00:00:00Z",
  updatedAt: "2026-08-16T08:00:00Z",
};

describe("exportNotebook", () => {
  it("exports a JSON representation with all fields", () => {
    const json = exportNotebook(notebook, "json");
    const parsed = JSON.parse(json) as Notebook;
    expect(parsed.id).toBe("nb-1");
    expect(parsed.cells).toHaveLength(3);
    expect(parsed.cells[1]?.outputs[0]).toMatchObject({ kind: "table" });
  });

  it("exports a Markdown representation with code fences and table", () => {
    const md = exportNotebook(notebook, "markdown");
    expect(md).toContain("# Revenue pipeline");
    expect(md).toContain("Weekly breakdown.");
    expect(md).toContain("**Datasources:** `ds-1`, `ds-2`");
    expect(md).toContain("```sql");
    expect(md).toContain("| region | sum |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| East | 12340 |");
    expect(md).toContain("Module not found");
    expect(md).toContain("**status:** `failed`");
  });

  it("renders charts in the Markdown output without crashing", () => {
    const withChart: Notebook = {
      ...notebook,
      cells: [
        buildCell({
          id: "c-chart",
          kind: "python",
          source: "plot(x, y)",
          outputs: [
            {
              kind: "chart",
              chartType: "line",
              series: [{ name: "Series A", x: [1, 2, 3], y: [4, 5, 6] }],
              xLabel: "day",
              yLabel: "amount",
            },
          ],
        }),
      ],
    };
    const md = exportNotebook(withChart, "markdown");
    expect(md).toContain("Chart (line)");
    expect(md).toContain("x-axis: day");
  });

  it("replaces pipe characters in table cells to keep Markdown valid", () => {
    const withPipe: Notebook = {
      ...notebook,
      cells: [
        buildCell({
          id: "c-pipe",
          kind: "sql",
          source: "SELECT 'a|b'",
          outputs: [
            {
              kind: "table",
              columns: ["x"],
              rows: [["a|b|c"]],
            },
          ],
        }),
      ],
    };
    const md = exportNotebook(withPipe, "markdown");
    expect(md).toContain("a\\|b\\|c");
  });
});