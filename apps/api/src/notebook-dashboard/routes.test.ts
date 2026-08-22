import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleNotebookDashboardRequest } from "./routes.js";
import { NotebookDashboardRepository } from "./repository.js";

interface ServerHandle {
  url: string;
  close: () => Promise<void>;
}

function startServer(
  repo: NotebookDashboardRepository,
  gateway: {
    listDataSources: ReturnType<typeof vi.fn>;
    runSqlReadonly: ReturnType<typeof vi.fn>;
  },
  userId: string,
  workspaceId: string,
): Promise<ServerHandle> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const handled = await handleNotebookDashboardRequest(
        req,
        res,
        url.pathname,
        userId,
        workspaceId,
        {
          repository: repo,
          gateway: gateway as never,
        },
      );
      if (!handled) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "unhandled" } }));
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}

async function jsonRequest(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, init);
  const body = await response.json();
  return { status: response.status, body };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("notebook + dashboard HTTP routes", () => {
  let server: ServerHandle;
  let repo: NotebookDashboardRepository;
  let db: ReturnType<typeof Database>;
  let gateway: {
    listDataSources: ReturnType<typeof vi.fn>;
    runSqlReadonly: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    db = new Database(":memory:");
    repo = new NotebookDashboardRepository(db);
    gateway = {
      listDataSources: vi.fn(async () => [{ id: "ds-1", name: "sample" }]),
      runSqlReadonly: vi.fn(async () => ({
        columns: ["n"],
        rows: [[1]],
        truncated: false,
        audit_log_id: "audit-1",
        elapsed_ms: 4,
      })),
    };
    server = await startServer(repo, gateway, "user-1", "ws-1");
  });

  afterEach(async () => {
    await server.close();
    db.close();
  });

  it("creates and lists notebooks", async () => {
    const created = await jsonRequest(`${server.url}/api/v1/notebooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hello", cells: [] }),
    });
    expect(created.status).toBe(201);

    const list = await jsonRequest(`${server.url}/api/v1/notebooks`);
    expect(list.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (list.body as any).data.items as Array<{ title: string }>;
    expect(items[0]?.title).toBe("Hello");
  });

  it("runs sql cells and persists the run", async () => {
    const created = await jsonRequest(`${server.url}/api/v1/notebooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Run me",
        cells: [
          {
            id: "cell-1",
            kind: "sql",
            source: "SELECT 1 AS n",
            status: "idle",
            outputs: [],
          },
        ],
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notebookId = (created.body as any).data.id as string;

    const ran = await jsonRequest(`${server.url}/api/v1/notebooks/${notebookId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(ran.status).toBe(200);
    expect(gateway.runSqlReadonly).toHaveBeenCalledTimes(1);

    const runs = await jsonRequest(`${server.url}/api/v1/notebooks/${notebookId}/runs`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (runs.body as any).data.items as Array<{ status: string }>;
    expect(items[0]?.status).toBe("completed");
  });

  it("issues a share token and resolves by that token", async () => {
    const created = await jsonRequest(`${server.url}/api/v1/notebooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Share" }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notebookId = (created.body as any).data.id as string;

    const share = await jsonRequest(`${server.url}/api/v1/notebooks/${notebookId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(share.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = (share.body as any).data.token as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const fetched = await jsonRequest(`${server.url}/api/v1/notebooks/share/${token}`);
    expect(fetched.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((fetched.body as any).data.id).toBe(notebookId);
  });

  it("rejects a malformed share token with 404", async () => {
    const fetched = await jsonRequest(`${server.url}/api/v1/notebooks/share/does-not-exist`);
    expect(fetched.status).toBe(404);
  });

  it("applies a built-in dashboard template", async () => {
    const created = await jsonRequest(`${server.url}/api/v1/dashboards/from-template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: "ops-overview" }),
    });
    expect(created.status).toBe(201);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (created.body as any).data as { templateId: string; widgets: unknown[] };
    expect(data.templateId).toBe("ops-overview");
    expect(data.widgets.length).toBeGreaterThan(0);
  });

  it("rejects an unknown template id", async () => {
    const response = await jsonRequest(`${server.url}/api/v1/dashboards/from-template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: "no-such-template" }),
    });
    expect(response.status).toBe(400);
  });

  it("refreshes dashboard widgets against the gateway", async () => {
    const refreshGateway = {
      listDataSources: vi.fn(async () => [{ id: "ds-1", name: "sample" }]),
      runSqlReadonly: vi.fn(async () => ({
        columns: ["day", "revenue"],
        rows: [["2026-08-16", 12340]],
        truncated: false,
        audit_log_id: "audit-2",
        elapsed_ms: 5,
      })),
    };
    const refreshServer = await startServer(repo, refreshGateway, "user-1", "ws-1");
    try {
      const created = await jsonRequest(`${refreshServer.url}/api/v1/dashboards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Refresh me",
          widgets: [
            {
              id: "w-kpi",
              kind: "kpi",
              title: "GMV",
              source: "SELECT sum(gmv) FROM orders",
              datasourceId: "ds-1",
              layout: { col: 0, row: 0, width: 3, height: 1 },
            },
            {
              id: "w-line",
              kind: "line-chart",
              title: "Trend",
              source: "SELECT day, revenue FROM daily",
              datasourceId: "ds-1",
              layout: { col: 3, row: 0, width: 6, height: 2 },
            },
          ],
        }),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dashboardId = (created.body as any).data.id as string;

      const refresh = await jsonRequest(`${refreshServer.url}/api/v1/dashboards/${dashboardId}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgetIds: ["w-kpi", "w-line"], force: true }),
      });
      expect(refresh.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const widgets = (refresh.body as any).data.widgets as Array<{
        id: string;
        cache: { value?: number; series?: unknown[] };
        fresh: boolean;
      }>;
      expect(widgets).toHaveLength(2);
      expect(widgets[0]?.fresh).toBe(true);
      expect(String(widgets[0]?.cache.value)).toMatch(/2026-08-16|12340/);
      expect(widgets[1]?.cache.series).toEqual([
        { name: "revenue", x: ["2026-08-16"], y: [12340] },
      ]);
    } finally {
      await refreshServer.close();
    }
  });

  it("surfaces SQL errors on the widget cache rather than 500", async () => {
    const failingGateway = {
      listDataSources: vi.fn(async () => [{ id: "ds-1" }]),
      runSqlReadonly: vi.fn(async () => {
        throw new Error("datasource unreachable");
      }),
    };
    const failingServer = await startServer(repo, failingGateway, "user-1", "ws-1");
    try {
      const created = await jsonRequest(`${failingServer.url}/api/v1/dashboards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Fail me",
          widgets: [
            {
              id: "w-bad",
              kind: "kpi",
              title: "Bad",
              source: "SELECT 1",
              datasourceId: "ds-1",
              layout: { col: 0, row: 0, width: 3, height: 1 },
            },
          ],
        }),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dashboardId = (created.body as any).data.id as string;

      const refresh = await jsonRequest(`${failingServer.url}/api/v1/dashboards/${dashboardId}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      expect(refresh.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const widgets = (refresh.body as any).data.widgets as Array<{ cache: { error?: string } }>;
      expect(widgets[0]?.cache.error).toContain("unreachable");
    } finally {
      await failingServer.close();
    }
  });

  it("returns false for an unhandled path", async () => {
    const handled = await handleNotebookDashboardRequest(
      {} as IncomingMessage,
      {} as ServerResponse,
      "/api/v1/me",
      "user-1",
      "ws-1",
      { repository: repo, gateway: gateway as never },
    );
    expect(handled).toBe(false);
  });

  it("exports a dashboard as markdown", async () => {
    const created = await jsonRequest(`${server.url}/api/v1/dashboards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "My Dashboard",
        description: "A test dashboard",
        widgets: [
          {
            id: "w-1",
            kind: "kpi",
            title: "GMV",
            source: "SELECT sum(gmv) FROM orders",
            datasourceId: "ds-1",
            layout: { col: 0, row: 0, width: 3, height: 1 },
            cache: {
              value: 12345,
              updatedAt: "2026-08-16T10:00:00Z",
            },
          },
          {
            id: "w-2",
            kind: "markdown",
            title: "Notes",
            layout: { col: 3, row: 0, width: 4, height: 1 },
            cache: {
              markdown: "## Hello\nThis is a note.",
              updatedAt: "2026-08-16T10:00:00Z",
            },
          },
        ],
      }),
    });
    expect(created.status).toBe(201);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dashboardId = (created.body as any).data.id as string;

    const response = await fetch(`${server.url}/api/v1/dashboards/${dashboardId}/export.md`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="My_Dashboard\.md"/);
    const text = await response.text();
    expect(text).toContain("# My Dashboard");
    expect(text).toContain("A test dashboard");
    expect(text).toContain("GMV");
    expect(text).toContain("**value:** 12345");
    expect(text).toContain("## Hello");
  });

  it("exports a dashboard as json", async () => {
    const created = await jsonRequest(`${server.url}/api/v1/dashboards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "JSON Dashboard",
        widgets: [
          {
            id: "w-json",
            kind: "table",
            title: "Top users",
            layout: { col: 0, row: 0, width: 6, height: 2 },
            cache: {
              table: {
                columns: ["user", "count"],
                rows: [["alice", 42], ["bob", 38]],
              },
              updatedAt: "2026-08-16T10:00:00Z",
            },
          },
        ],
      }),
    });
    expect(created.status).toBe(201);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dashboardId = (created.body as any).data.id as string;

    const response = await fetch(`${server.url}/api/v1/dashboards/${dashboardId}/export.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const json = await response.json();
    expect(json.title).toBe("JSON Dashboard");
    expect(json.widgets).toHaveLength(1);
    expect(json.widgets[0].id).toBe("w-json");
  });

  it("returns 404 when exporting a non-existent dashboard", async () => {
    const response = await fetch(`${server.url}/api/v1/dashboards/does-not-exist/export.md`);
    expect(response.status).toBe(404);
  });
});
