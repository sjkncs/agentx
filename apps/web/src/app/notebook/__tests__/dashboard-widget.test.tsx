/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { WidgetView } from "../dashboard-widget";
import type { DashboardWidget } from "../notebook-types";

function makeWidget(over: Partial<DashboardWidget>): DashboardWidget {
  return {
    id: over.id ?? "w-1",
    kind: over.kind ?? "kpi",
    title: over.title ?? "Widget",
    layout: over.layout ?? { col: 0, row: 0, width: 3, height: 1 },
    ...over,
  };
}

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

function render(ui: ReactElement): RenderResult {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("WidgetView", () => {
  it("renders a KPI value from cache", () => {
    const { container } = render(
      createElement(WidgetView, {
        widget: makeWidget({
          kind: "kpi",
          cache: { value: 12340, updatedAt: "2026-08-17T00:00:00Z" },
        }),
      }),
    );
    expect(container.textContent).toContain("12340");
  });

  it("shows an error badge and renders the ErrorState body when cache has an error", () => {
    const { container } = render(
      createElement(WidgetView, {
        widget: makeWidget({
          kind: "kpi",
          cache: {
            updatedAt: "2026-08-17T00:00:00Z",
            error: "datasource unreachable",
          },
        }),
      }),
    );
    expect(container.textContent).toContain("datasource unreachable");
    expect(container.textContent).toContain("error");
  });

  it("shows an empty badge when cache.empty is true", () => {
    const { container } = render(
      createElement(WidgetView, {
        widget: makeWidget({
          kind: "kpi",
          cache: { updatedAt: "2026-08-17T00:00:00Z", empty: true },
        }),
      }),
    );
    expect(container.textContent).toContain("empty");
  });

  it("shows a refreshing badge when refreshing is true", () => {
    const { container } = render(
      createElement(WidgetView, {
        refreshing: true,
        widget: makeWidget({
          kind: "kpi",
          cache: { value: 1, updatedAt: "2026-08-17T00:00:00Z" },
        }),
      }),
    );
    expect(container.textContent).toContain("refreshing");
  });

  it("renders a countdown for widgets with refreshIntervalMs", () => {
    const future = new Date(Date.now() - 5_000).toISOString();
    const { container } = render(
      createElement(WidgetView, {
        widget: makeWidget({
          kind: "kpi",
          refreshIntervalMs: 60_000,
          cache: { value: 1, updatedAt: future },
        }),
      }),
    );
    expect(container.textContent).toMatch(/next refresh in \d+s/);
  });

  it("renders the 'manual' label when no refreshIntervalMs is set", () => {
    const { container } = render(
      createElement(WidgetView, {
        widget: makeWidget({ kind: "kpi" }),
      }),
    );
    expect(container.textContent).toContain("manual");
  });
});