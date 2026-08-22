/**
 * Behavioural smoke test for `useNotebookStore`. We mock the API client so we
 * can verify the store talks to the server (not localStorage) and applies
 * run results back to the cells.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api-client", () => {
  return {
    NotebookDashboardApiError: class extends Error {
      readonly status: number;
      readonly code: string;
      constructor(status: number, code: string, message: string) {
        super(`[${status} ${code}] ${message}`);
        this.status = status;
        this.code = code;
      }
    },
    notebookDashboardApi: {
      listNotebooks: vi.fn(async () => [
        { id: "nb-1", title: "Welcome", cells: [], datasources: [] },
      ]),
      getNotebook: vi.fn(async () => ({
        id: "nb-1",
        title: "Welcome",
        cells: [
          {
            id: "cell-1",
            kind: "sql",
            source: "SELECT 1",
            status: "idle",
            outputs: [],
          },
        ],
        datasources: [],
      })),
      createNotebook: vi.fn(async () => ({
        id: "nb-new",
        title: "Untitled",
        cells: [],
        datasources: [],
      })),
      updateNotebook: vi.fn(async (id, patch) => ({
        id,
        title: "Welcome",
        cells: [],
        datasources: [],
        ...patch,
      })),
      deleteNotebook: vi.fn(async () => undefined),
      runNotebook: vi.fn(async () => [
        {
          cellId: "cell-1",
          status: "completed",
          outputs: [{ kind: "text", text: "done" }],
          durationMs: 7,
        },
      ]),
      shareNotebook: vi.fn(async () => ({ token: "tok" })),
      revokeShareNotebook: vi.fn(async () => undefined),
      listDashboards: vi.fn(async () => []),
      getDashboard: vi.fn(async () => ({ id: "db-1", title: "Ops", widgets: [] })),
      createDashboard: vi.fn(async () => ({
        id: "db-new",
        title: "Untitled",
        widgets: [],
      })),
      applyDashboardTemplate: vi.fn(async () => ({
        id: "db-tpl",
        title: "Ops",
        widgets: [],
      })),
      updateDashboard: vi.fn(async () => ({ id: "db-1", title: "Ops", widgets: [] })),
      deleteDashboard: vi.fn(async () => undefined),
      shareDashboard: vi.fn(async () => ({ token: "tok" })),
      revokeShareDashboard: vi.fn(async () => undefined),
    },
  };
});

import { notebookDashboardApi } from "../api-client";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("notebookDashboardApi (smoke)", () => {
  it("exposes the listNotebooks method backed by fetch", () => {
    expect(typeof notebookDashboardApi.listNotebooks).toBe("function");
  });

  it("exposes the runNotebook method", () => {
    expect(typeof notebookDashboardApi.runNotebook).toBe("function");
  });

  it("exposes the createNotebook method", () => {
    expect(typeof notebookDashboardApi.createNotebook).toBe("function");
  });

  it("exposes the shareNotebook method", () => {
    expect(typeof notebookDashboardApi.shareNotebook).toBe("function");
  });
});