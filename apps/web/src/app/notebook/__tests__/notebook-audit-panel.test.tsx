/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { NotebookAuditPanel } from "../notebook-home";

afterEach(() => {
  document.body.innerHTML = "";
});

function render(ui: JSX.Element): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return { container, root };
}

const SAMPLE_RUNS = [
  {
    cellId: "cell-a-very-long-identifier",
    status: "completed",
    elapsedMs: 42,
    createdAt: "2026-08-17T09:30:00.000Z",
    auditLogId: "audit-1234567890",
  },
  {
    cellId: "cell-b",
    status: "failed",
    elapsedMs: 120,
    createdAt: "2026-08-17T09:31:05.000Z",
    error: "syntax error",
  },
];

describe("NotebookAuditPanel", () => {
  it("renders empty state when there are no runs", () => {
    const { container } = render(
      createElement(NotebookAuditPanel, {
        runs: [],
        loading: false,
        onReload: () => undefined,
      }),
    );
    expect(container.textContent).toContain("No runs recorded yet");
  });

  it("renders each run with status, cell, elapsed, audit columns", () => {
    const { container } = render(
      createElement(NotebookAuditPanel, {
        runs: SAMPLE_RUNS,
        loading: false,
        onReload: () => undefined,
      }),
    );
    expect(container.textContent).toContain("cell-a");
    expect(container.textContent).toContain("completed");
    expect(container.textContent).toContain("failed");
    expect(container.textContent).toContain("42ms");
    expect(container.textContent).toContain("120ms");
    expect(container.textContent).toContain("audit-12");
  });

  it("disables reload button label while loading", () => {
    const { container } = render(
      createElement(NotebookAuditPanel, {
        runs: SAMPLE_RUNS,
        loading: true,
        onReload: () => undefined,
      }),
    );
    expect(container.textContent).toContain("Refreshing");
  });

  it("invokes onReload when the refresh button is clicked", () => {
    const onReload = vi.fn();
    const { container } = render(
      createElement(NotebookAuditPanel, {
        runs: SAMPLE_RUNS,
        loading: false,
        onReload,
      }),
    );
    const button = container.querySelector(
      "[data-testid='notebook-audit-reload']",
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    act(() => {
      button?.click();
    });
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});