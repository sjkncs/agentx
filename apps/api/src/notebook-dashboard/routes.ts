/**
 * HTTP routing for `/api/v1/notebooks` and `/api/v1/dashboards`.
 *
 * The handler returns `null` for paths it doesn't recognise so the
 * upstream router can fall through to the next layer. JSON envelopes
 * follow the same `ApiResult<T>` shape used by `config-api.ts` so
 * the web client can share one error pipeline.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { createErrorResult, createSuccessResult } from "@datafoundry/contracts";
import type { LocalDataGateway } from "@datafoundry/data-gateway";

import {
  executeCell,
  type CellExecuteContext,
  type CellExecuteResult,
} from "./executor.js";
import { exportDashboard, exportNotebook } from "./export.js";
import {
  refreshDashboardWidgets,
  type WidgetRefreshOutput,
} from "./refresh.js";
import { NotebookDashboardRepository, NotebookDashboardError } from "./repository.js";
import type {
  CellRunRecord,
  CellRunStatus,
  Dashboard,
  DashboardWidget,
  Notebook,
  NotebookCell,
} from "./types.js";

export interface NotebookDashboardDeps {
  repository: NotebookDashboardRepository;
  gateway: LocalDataGateway;
  pythonBin?: string;
  /** Optional AI completion bridge — wired into the engine on demand. */
  completePrompt?: (prompt: string, model?: string) => Promise<string>;
}

const NOTEBOOK_PREFIX = "/api/v1/notebooks";
const DASHBOARD_PREFIX = "/api/v1/dashboards";

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 5_000_000) {
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        resolve(undefined);
      }
    });
    request.on("error", () => resolve(undefined));
  });
}

function errorFromDomain(err: unknown): { status: number; body: unknown } {
  if (err instanceof NotebookDashboardError) {
    const status = err.code === "NOT_FOUND" ? 404 : err.code === "INVALID_ARGUMENT" ? 400 : 500;
    return {
      status,
      body: createErrorResult("BAD_REQUEST", err.message),
    };
  }
  return {
    status: 500,
    body: createErrorResult("INTERNAL_ERROR", err instanceof Error ? err.message : String(err)),
  };
}

function setShareTokenHeaders(response: ServerResponse, token: string): void {
  response.setHeader("X-Share-Token", token);
}

/**
 * Try to handle a request. Returns `null` when the path is not ours —
 * the upstream router then dispatches to the next handler.
 */
export async function handleNotebookDashboardRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  userId: string,
  workspaceId: string,
  deps: NotebookDashboardDeps,
): Promise<boolean> {
  if (pathname.startsWith(NOTEBOOK_PREFIX)) {
    return handleNotebookPaths(request, response, pathname, userId, workspaceId, deps);
  }
  if (pathname.startsWith(DASHBOARD_PREFIX)) {
    return handleDashboardPaths(request, response, pathname, userId, workspaceId, deps);
  }
  return false;
}

// ---------------------------------------------------------------- Notebooks

async function handleNotebookPaths(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  userId: string,
  workspaceId: string,
  deps: NotebookDashboardDeps,
): Promise<boolean> {
  const repo = deps.repository;
  const method = request.method ?? "GET";
  const tail = pathname.slice(NOTEBOOK_PREFIX.length);

  // /api/v1/notebooks
  if (tail === "" || tail === "/") {
    if (method === "GET") {
      const items = repo.listNotebooks(workspaceId);
      sendJson(response, 200, createSuccessResult({ items }));
      return true;
    }
    if (method === "POST") {
      const body = (await readJsonBody(request)) ?? {};
      const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Untitled notebook";
      const created = repo.createNotebook({
        workspaceId,
        ownerId: userId,
        title,
        description: typeof body.description === "string" ? body.description : "",
        cells: Array.isArray(body.cells) ? (body.cells as NotebookCell[]) : [],
        datasources: Array.isArray(body.datasources) ? (body.datasources as string[]) : [],
      });
      sendJson(response, 201, createSuccessResult(created));
      return true;
    }
    return false;
  }

  // /api/v1/notebooks/share/<token>
  if (tail.startsWith("/share/")) {
    const token = tail.slice("/share/".length);
    if (!token) {
      sendJson(response, 400, createErrorResult("BAD_REQUEST", "missing share token"));
      return true;
    }
    const doc = repo.getNotebookByShareToken(token);
    if (!doc) {
      sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", "share token not found"));
      return true;
    }
    sendJson(response, 200, createSuccessResult(doc));
    return true;
  }

  // /api/v1/notebooks/<id>[/...]
  const match = tail.match(/^\/([^/]+)(?:\/(.*))?$/);
  if (!match) {
    return false;
  }
  const notebookId = match[1]!;
  const subPath = match[2];

  if (subPath === undefined || subPath === "") {
    if (method === "GET") {
      const doc = repo.getNotebook(workspaceId, notebookId);
      if (!doc) {
        sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", "notebook not found"));
        return true;
      }
      sendJson(response, 200, createSuccessResult(doc));
      return true;
    }
    if (method === "PUT") {
      try {
        const body = (await readJsonBody(request)) ?? {};
        const updated = repo.updateNotebook({
          workspaceId,
          notebookId,
          title: typeof body.title === "string" ? body.title : undefined,
          description: typeof body.description === "string" ? body.description : undefined,
          cells: Array.isArray(body.cells) ? (body.cells as NotebookCell[]) : undefined,
          datasources: Array.isArray(body.datasources) ? (body.datasources as string[]) : undefined,
        });
        sendJson(response, 200, createSuccessResult(updated));
      } catch (err) {
        const { status, body } = errorFromDomain(err);
        sendJson(response, status, body);
      }
      return true;
    }
    if (method === "DELETE") {
      const removed = repo.deleteNotebook(workspaceId, notebookId);
      sendJson(response, removed ? 200 : 404, createSuccessResult({ removed }));
      return true;
    }
    return false;
  }

  if (subPath === "run") {
    if (method === "POST") {
      const body = (await readJsonBody(request)) ?? {};
      const doc = repo.getNotebook(workspaceId, notebookId);
      if (!doc) {
        sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", "notebook not found"));
        return true;
      }
      const datasourceId = typeof body.datasourceId === "string" ? body.datasourceId : undefined;
      const results = await runNotebookCells(doc, {
        workspaceId,
        userId,
        gateway: deps.gateway,
        pythonBin: deps.pythonBin,
        completePrompt: deps.completePrompt,
        datasourceId,
      });
      persistCellRunResults(repo, doc, results);
      sendJson(response, 200, createSuccessResult({ results }));
      return true;
    }
    return false;
  }

  if (subPath === "share") {
    if (method === "POST") {
      const doc = repo.getNotebook(workspaceId, notebookId);
      if (!doc) {
        sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", "notebook not found"));
        return true;
      }
      const token = generateShareToken();
      repo.updateNotebook({
        workspaceId,
        notebookId,
        shareToken: token,
        shareRevokedAt: null,
      });
      setShareTokenHeaders(response, token);
      sendJson(response, 200, createSuccessResult({ token }));
      return true;
    }
    if (method === "DELETE") {
      repo.updateNotebook({
        workspaceId,
        notebookId,
        shareToken: null,
        shareRevokedAt: new Date().toISOString(),
      });
      sendJson(response, 200, createSuccessResult({ revoked: true }));
      return true;
    }
    return false;
  }

  if (subPath === "runs") {
    if (method === "GET") {
      const runs = repo.listCellRuns(notebookId, 100);
      sendJson(response, 200, createSuccessResult({ items: runs }));
      return true;
    }
    return false;
  }

  if (subPath === "export.md" || subPath === "export.json") {
    if (method === "GET") {
      const doc = repo.getNotebook(workspaceId, notebookId);
      if (!doc) {
        sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", "notebook not found"));
        return true;
      }
      const format = subPath === "export.md" ? "markdown" : "json";
      const body = exportNotebook(doc, format);
      const contentType = subPath === "export.md"
        ? "text/markdown; charset=utf-8"
        : "application/json; charset=utf-8";
      const safeTitle = (doc.title || "notebook").replace(/[^A-Za-z0-9._-]+/g, "_");
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${safeTitle}.${format === "markdown" ? "md" : "json"}"`,
      });
      response.end(body);
      return true;
    }
    return false;
  }

  return false;
}

// ---------------------------------------------------------------- Dashboards

async function handleDashboardPaths(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  userId: string,
  workspaceId: string,
  deps: NotebookDashboardDeps,
): Promise<boolean> {
  const repo = deps.repository;
  const method = request.method ?? "GET";
  const tail = pathname.slice(DASHBOARD_PREFIX.length);

  if (tail === "" || tail === "/") {
    if (method === "GET") {
      const items = repo.listDashboards(workspaceId);
      sendJson(response, 200, createSuccessResult({ items }));
      return true;
    }
    if (method === "POST") {
      const body = (await readJsonBody(request)) ?? {};
      const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Untitled dashboard";
      const created = repo.createDashboard({
        workspaceId,
        ownerId: userId,
        title,
        description: typeof body.description === "string" ? body.description : "",
        templateId: typeof body.templateId === "string" ? body.templateId : undefined,
        widgets: Array.isArray(body.widgets) ? (body.widgets as DashboardWidget[]) : [],
      });
      sendJson(response, 201, createSuccessResult(created));
      return true;
    }
    return false;
  }

  if (tail.startsWith("/from-template")) {
    if (method === "POST") {
      const body = (await readJsonBody(request)) ?? {};
      const templateId = typeof body.templateId === "string" ? body.templateId : "";
      const template = BUILTIN_TEMPLATES.find((t) => t.id === templateId);
      if (!template) {
        sendJson(response, 400, createErrorResult("BAD_REQUEST", `unknown template ${templateId}`));
        return true;
      }
      const created = repo.createDashboard({
        workspaceId,
        ownerId: userId,
        title: template.name,
        description: template.description,
        templateId,
        widgets: template.widgets.map((w) => ({
          ...w,
          id: `w-${Math.random().toString(36).slice(2, 8)}`,
        })),
      });
      sendJson(response, 201, createSuccessResult(created));
      return true;
    }
    return false;
  }

  if (tail.startsWith("/share/")) {
    const token = tail.slice("/share/".length);
    const doc = repo.getDashboardByShareToken(token);
    if (!doc) {
      sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", "share token not found"));
      return true;
    }
    sendJson(response, 200, createSuccessResult(doc));
    return true;
  }

  const match = tail.match(/^\/([^/]+)(?:\/(.*))?$/);
  if (!match) {
    return false;
  }
  const dashboardId = match[1]!;
  const subPath = match[2];

  if (subPath === undefined || subPath === "") {
    if (method === "GET") {
      const doc = repo.getDashboard(workspaceId, dashboardId);
      if (!doc) {
        sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", "dashboard not found"));
        return true;
      }
      sendJson(response, 200, createSuccessResult(doc));
      return true;
    }
    if (method === "PUT") {
      try {
        const body = (await readJsonBody(request)) ?? {};
        const updated = repo.updateDashboard({
          workspaceId,
          dashboardId,
          title: typeof body.title === "string" ? body.title : undefined,
          description: typeof body.description === "string" ? body.description : undefined,
          widgets: Array.isArray(body.widgets) ? (body.widgets as DashboardWidget[]) : undefined,
        });
        sendJson(response, 200, createSuccessResult(updated));
      } catch (err) {
        const { status, body } = errorFromDomain(err);
        sendJson(response, status, body);
      }
      return true;
    }
    if (method === "DELETE") {
      const removed = repo.deleteDashboard(workspaceId, dashboardId);
      sendJson(response, removed ? 200 : 404, createSuccessResult({ removed }));
      return true;
    }
    return false;
  }

  if (subPath === "share") {
    if (method === "POST") {
      const doc = repo.getDashboard(workspaceId, dashboardId);
      if (!doc) {
        sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", "dashboard not found"));
        return true;
      }
      const token = generateShareToken();
      repo.updateDashboard({
        workspaceId,
        dashboardId,
        shareToken: token,
      });
      setShareTokenHeaders(response, token);
      sendJson(response, 200, createSuccessResult({ token }));
      return true;
    }
    if (method === "DELETE") {
      repo.updateDashboard({
        workspaceId,
        dashboardId,
        shareToken: null,
        archivedAt: new Date().toISOString(),
      });
      sendJson(response, 200, createSuccessResult({ revoked: true }));
      return true;
    }
    return false;
  }

  if (subPath === "export.md" || subPath === "export.json") {
    if (method === "GET") {
      const doc = repo.getDashboard(workspaceId, dashboardId);
      if (!doc) {
        sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", "dashboard not found"));
        return true;
      }
      const format = subPath === "export.md" ? "markdown" : "json";
      const body = exportDashboard(doc, format);
      const contentType = subPath === "export.md"
        ? "text/markdown; charset=utf-8"
        : "application/json; charset=utf-8";
      const safeTitle = (doc.title || "dashboard").replace(/[^A-Za-z0-9._-]+/g, "_");
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${safeTitle}.${format === "markdown" ? "md" : "json"}"`,
      });
      response.end(body);
      return true;
    }
    return false;
  }

  if (subPath === "refresh") {
    if (method === "POST") {
      const body = (await readJsonBody(request)) ?? {};
      const widgetIds = Array.isArray(body.widgetIds)
        ? body.widgetIds.filter((id): id is string => typeof id === "string")
        : [];
      const force = body.force === true;
      const doc = repo.getDashboard(workspaceId, dashboardId);
      if (!doc) {
        sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", "dashboard not found"));
        return true;
      }
      const outputs = await refreshDashboardWidgets(
        doc.widgets,
        { widgetIds, force },
        {
          workspaceId,
          userId,
          gateway: deps.gateway,
        },
      );
      const updates = new Map<string, DashboardWidget["cache"]>();
      for (const item of outputs) updates.set(item.widgetId, item.cache);
      const updatedWidgets = doc.widgets.map((w) => {
        const next = updates.get(w.id);
        return next ? { ...w, cache: next } : w;
      });
      const saved = repo.updateDashboard({
        workspaceId,
        dashboardId,
        widgets: updatedWidgets,
      });
      sendJson(
        response,
        200,
        createSuccessResult({
          widgets: saved.widgets.map((w) => ({
            id: w.id,
            cache: w.cache,
            fresh: outputs.find((o) => o.widgetId === w.id)?.fresh ?? false,
          })),
        }),
      );
      return true;
    }
    return false;
  }

  return false;
}

// --------------------------------------------------------------- helpers

function generateShareToken(): string {
  // 16 random bytes → 22-char base64url. Same shape as the helper exported
  // from repository.ts so tests can predict the length.
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Buffer.from(bytes).toString("base64url").slice(0, 22);
}

async function runNotebookCells(
  notebook: Notebook,
  ctx: CellExecuteContext,
): Promise<CellExecuteResult[]> {
  const results: CellExecuteResult[] = [];
  for (const cell of notebook.cells) {
    if (cell.kind === "markdown") {
      results.push({
        cellId: cell.id,
        status: "completed",
        outputs: [{ kind: "text", text: "Markdown cell — nothing to run." }],
        durationMs: 0,
      });
      continue;
    }
    const result = await executeCell(cell, ctx);
    results.push(result);
  }
  return results;
}

function persistCellRunResults(
  repo: NotebookDashboardRepository,
  notebook: Notebook,
  results: CellExecuteResult[],
): void {
  const updatedCells: NotebookCell[] = notebook.cells.map((cell) => {
    const result = results.find((r) => r.cellId === cell.id);
    if (!result) return cell;
    return {
      ...cell,
      status: result.status,
      outputs: result.outputs,
      durationMs: result.durationMs,
      lastRunAt: new Date().toISOString(),
    };
  });
  try {
    repo.updateNotebook({
      workspaceId: notebook.workspaceId,
      notebookId: notebook.id,
      cells: updatedCells,
    });
  } catch (err) {
    // Persistence failures should not crash the response — they are logged
    // by the upstream router.
    void err;
  }
  for (const result of results) {
    const run = repo.recordCellRunStart({
      notebookId: notebook.id,
      cellId: result.cellId,
      workspaceId: notebook.workspaceId,
    });
    const finish: {
      runId: string;
      status: CellRunStatus;
      durationMs: number;
      errorMessage?: string;
      rowCount?: number;
      auditLogId?: string;
    } = {
      runId: run.id,
      status: result.status,
      durationMs: result.durationMs,
    };
    if (result.errorMessage !== undefined) finish.errorMessage = result.errorMessage;
    if (result.rowCount !== undefined) finish.rowCount = result.rowCount;
    if (result.auditLogId !== undefined) finish.auditLogId = result.auditLogId;
    repo.recordCellRunFinish(finish);
  }
}

// --------------------------------------------------------------- templates
// Mirrors `apps/web/src/app/notebook/notebook-store.ts` so a CLI user
// can `df dashboard apply-template exec-summary` and get the same
// layout the web UI would render. Keep the canonical source as the web
// store; the API treats this as a *fallback* — once the web publishes
// a /api/v1/dashboard-templates endpoint we switch to that.

const BUILTIN_TEMPLATES: Array<{
  id: string;
  name: string;
  description: string;
  widgets: DashboardWidget[];
}> = [
  {
    id: "blank",
    name: "Blank canvas",
    description: "Start from an empty grid and add widgets one by one.",
    widgets: [],
  },
  {
    id: "ops-overview",
    name: "Operations overview",
    description: "Daily run count, success rate, top errors, recent sessions.",
    widgets: [
      {
        id: "w-kpi-runs",
        kind: "kpi",
        title: "Today's runs",
        layout: { col: 0, row: 0, width: 3, height: 1 },
      },
      {
        id: "w-kpi-success",
        kind: "kpi",
        title: "Success rate",
        layout: { col: 3, row: 0, width: 3, height: 1 },
      },
      {
        id: "w-md-note",
        kind: "markdown",
        title: "Notes",
        layout: { col: 8, row: 0, width: 4, height: 1 },
        cache: {
          markdown: "Use this space to leave handoff notes for the on-call rotation.",
          updatedAt: new Date().toISOString(),
        },
      },
    ],
  },
  {
    id: "data-quality",
    name: "Data quality",
    description: "Null counts, freshness SLOs, row counts per source.",
    widgets: [
      {
        id: "w-trace-mini",
        kind: "trace-mini",
        title: "Latest agent trace",
        layout: { col: 0, row: 0, width: 6, height: 2 },
      },
    ],
  },
  {
    id: "exec-summary",
    name: "Executive summary",
    description: "High-signal KPIs for stakeholders — runs, GMV impact, cost.",
    widgets: [
      {
        id: "w-kpi-gmv",
        kind: "kpi",
        title: "GMV surfaced (week)",
        layout: { col: 0, row: 0, width: 4, height: 1 },
      },
      {
        id: "w-kpi-cost",
        kind: "kpi",
        title: "Agent cost",
        layout: { col: 4, row: 0, width: 4, height: 1 },
      },
      {
        id: "w-kpi-tokens",
        kind: "kpi",
        title: "Tokens used",
        layout: { col: 8, row: 0, width: 4, height: 1 },
      },
    ],
  },
];
