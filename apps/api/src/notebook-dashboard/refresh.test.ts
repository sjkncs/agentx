import { describe, expect, it, vi } from "vitest";

import { refreshDashboardWidgets } from "./refresh.js";
import type { DashboardWidget } from "./types.js";

interface FakeResult {
  columns: string[];
  rows: unknown[][];
  row_count: number;
}

function makeWidget(over: Partial<DashboardWidget>): DashboardWidget {
  return {
    id: over.id ?? "w-1",
    kind: over.kind ?? "kpi",
    title: over.title ?? "Widget",
    layout: over.layout ?? { col: 0, row: 0, width: 3, height: 1 },
    ...over,
  };
}

function makeGateway(result: FakeResult) {
  return {
    runSqlReadonly: vi.fn(async () => result),
    listDataSources: vi.fn(async () => [{ id: "ds-1", name: "sample" }]),
  };
}

const ctx = { workspaceId: "ws-1", userId: "user-1" };

describe("refreshDashboardWidgets", () => {
  it("runs SQL for a KPI widget and stores the first column as value", async () => {
    const gateway = makeGateway({
      columns: ["gmv"],
      rows: [[12340]],
      row_count: 1,
    });
    const widget = makeWidget({
      kind: "kpi",
      source: "SELECT sum(gmv) FROM orders",
      datasourceId: "ds-1",
    });
    const outputs = await refreshDashboardWidgets([widget], { widgetIds: [] }, {
      ...ctx,
      gateway: gateway as never,
    });
    expect(gateway.runSqlReadonly).toHaveBeenCalledTimes(1);
    expect(outputs).toHaveLength(1);
    const cache = outputs[0]?.cache!;
    expect(cache.value).toBe(12340);
    expect(cache.empty).toBe(false);
    expect(cache.error).toBeUndefined();
  });

  it("shapes line-chart output into series keyed by column", async () => {
    const gateway = makeGateway({
      columns: ["day", "orders", "revenue"],
      rows: [
        ["2026-08-16", 12, 4800],
        ["2026-08-17", 18, 7200],
      ],
      row_count: 2,
    });
    const widget = makeWidget({
      kind: "line-chart",
      source: "SELECT day, orders, revenue FROM daily",
      datasourceId: "ds-1",
    });
    const [output] = await refreshDashboardWidgets([widget], { widgetIds: [] }, {
      ...ctx,
      gateway: gateway as never,
    });
    expect(output?.cache?.series).toEqual([
      { name: "orders", x: ["2026-08-16", "2026-08-17"], y: [12, 18] },
      { name: "revenue", x: ["2026-08-16", "2026-08-17"], y: [4800, 7200] },
    ]);
  });

  it("skips widgets with no source", async () => {
    const gateway = makeGateway({ columns: ["x"], rows: [], row_count: 0 });
    const widget = makeWidget({ kind: "markdown", title: "Note" });
    const outputs = await refreshDashboardWidgets([widget], { widgetIds: [] }, {
      ...ctx,
      gateway: gateway as never,
    });
    expect(gateway.runSqlReadonly).not.toHaveBeenCalled();
    expect(outputs[0]?.fresh).toBe(false);
  });

  it("honours refreshIntervalMs and returns cached value when within window", async () => {
    const gateway = makeGateway({ columns: ["x"], rows: [[1]], row_count: 1 });
    const widget = makeWidget({
      kind: "kpi",
      source: "SELECT 1",
      datasourceId: "ds-1",
      refreshIntervalMs: 60_000,
      cache: {
        value: "previous",
        updatedAt: new Date().toISOString(),
      },
    });
    const [output] = await refreshDashboardWidgets([widget], { widgetIds: [] }, {
      ...ctx,
      gateway: gateway as never,
    });
    expect(gateway.runSqlReadonly).not.toHaveBeenCalled();
    expect(output?.cache?.value).toBe("previous");
    expect(output?.fresh).toBe(false);
  });

  it("re-runs when refreshIntervalMs has elapsed", async () => {
    const gateway = makeGateway({ columns: ["x"], rows: [[42]], row_count: 1 });
    const stale = new Date(Date.now() - 5 * 60_000).toISOString();
    const widget = makeWidget({
      kind: "kpi",
      source: "SELECT 1",
      datasourceId: "ds-1",
      refreshIntervalMs: 60_000,
      cache: { value: "stale", updatedAt: stale },
    });
    const [output] = await refreshDashboardWidgets([widget], { widgetIds: [] }, {
      ...ctx,
      gateway: gateway as never,
    });
    expect(gateway.runSqlReadonly).toHaveBeenCalledTimes(1);
    expect(output?.cache?.value).toBe(42);
  });

  it("forces a refresh when requested", async () => {
    const gateway = makeGateway({ columns: ["x"], rows: [[7]], row_count: 1 });
    const widget = makeWidget({
      kind: "kpi",
      source: "SELECT 1",
      datasourceId: "ds-1",
      cache: { value: "previous", updatedAt: new Date().toISOString() },
    });
    const [output] = await refreshDashboardWidgets([widget], { widgetIds: [], force: true }, {
      ...ctx,
      gateway: gateway as never,
    });
    expect(gateway.runSqlReadonly).toHaveBeenCalledTimes(1);
    expect(output?.cache?.value).toBe(7);
    expect(output?.fresh).toBe(true);
  });

  it("records the SQL error in cache.error rather than throwing", async () => {
    const gateway = {
      runSqlReadonly: vi.fn(async () => {
        throw new Error("syntax error at 'SELECT'");
      }),
      listDataSources: vi.fn(async () => []),
    };
    const widget = makeWidget({
      kind: "kpi",
      source: "SELECT garbage",
      datasourceId: "ds-1",
    });
    const [output] = await refreshDashboardWidgets([widget], { widgetIds: [] }, {
      ...ctx,
      gateway: gateway as never,
    });
    expect(output?.cache?.error).toContain("syntax error");
    expect(output?.fresh).toBe(false);
  });

  it("filters by widgetIds when provided", async () => {
    const gateway = makeGateway({ columns: ["x"], rows: [[1]], row_count: 1 });
    const widgets = [
      makeWidget({ id: "w-1", source: "SELECT 1", datasourceId: "ds-1" }),
      makeWidget({ id: "w-2", source: "SELECT 2", datasourceId: "ds-1" }),
    ];
    const outputs = await refreshDashboardWidgets(widgets, { widgetIds: ["w-2"] }, {
      ...ctx,
      gateway: gateway as never,
    });
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.widgetId).toBe("w-2");
  });
});