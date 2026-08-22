/**
 * Browser-side client for the notebook / dashboard HTTP surface.
 *
 * Every method goes through `fetch` against `/api/v1/notebooks` and
 * `/api/v1/dashboards`. The server is the source of truth — localStorage is
 * only kept as a *read-through* cache so the UI does not flash an empty state
 * while the network request is in flight.
 */

import type {
  CellOutput,
  Dashboard,
  DashboardWidget,
  Notebook,
  NotebookCell,
} from "./notebook-types";

export interface CellRunRecord {
  cellId: string;
  status: string;
  elapsedMs?: number;
  /** ISO timestamp of when the cell finished executing. */
  createdAt: string;
  /** Server's audit log id; useful for end-to-end tracing. */
  auditLogId?: string;
  /** Optional human-readable error (when status === "failed"). */
  error?: string;
}

export interface NotebookRunResult {
  cellId: string;
  status: "idle" | "queued" | "running" | "completed" | "failed" | "canceled";
  outputs: CellOutput[];
  durationMs: number;
  auditLogId?: string;
  rowCount?: number;
  errorMessage?: string;
}

export class NotebookDashboardApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(`[${status} ${code}] ${message}`);
    this.status = status;
    this.code = code;
    this.message = message;
  }
}

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      // Server returned non-JSON (e.g. an nginx 502 HTML page). Wrap it in a
      // friendly error rather than crashing the consumer.
      throw new NotebookDashboardApiError(
        response.status,
        "INVALID_RESPONSE",
        `Non-JSON response (${response.status}): ${text.slice(0, 120)}`,
      );
    }
  }
  if (!response.ok) {
    const code =
      (typeof payload === "object" && payload && "error" in payload
        ? String((payload as { error?: { code?: string } }).error?.code ?? "ERROR")
        : "ERROR");
    const message =
      (typeof payload === "object" && payload && "error" in payload
        ? String(
            (payload as { error?: { message?: string } }).error?.message ??
              response.statusText,
          )
        : response.statusText || "Unknown error");
    throw new NotebookDashboardApiError(response.status, code, message);
  }
  // Unwrap the ApiResult envelope; tolerate either the wrapped or unwrapped shape.
  if (
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    (payload as { data?: unknown }).data !== undefined
  ) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: { ...JSON_HEADERS, ...(init?.headers ?? {}) },
    ...init,
  });
  return parseResponse<T>(response);
}

export const notebookDashboardApi = {
  async listNotebooks(): Promise<Notebook[]> {
    const payload = await request<{ items: Notebook[] }>("/api/v1/notebooks");
    return payload.items;
  },

  async getNotebook(id: string): Promise<Notebook> {
    return request<Notebook>(`/api/v1/notebooks/${id}`);
  },

  async createNotebook(input: { title: string; description?: string; cells?: NotebookCell[] }): Promise<Notebook> {
    return request<Notebook>("/api/v1/notebooks", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async updateNotebook(
    id: string,
    patch: { title?: string; description?: string; cells?: NotebookCell[]; datasources?: string[] },
  ): Promise<Notebook> {
    return request<Notebook>(`/api/v1/notebooks/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
  },

  async deleteNotebook(id: string): Promise<void> {
    await request<{ removed: boolean }>(`/api/v1/notebooks/${id}`, { method: "DELETE" });
  },

  async runNotebook(id: string, options: { datasourceId?: string } = {}): Promise<NotebookRunResult[]> {
    const payload = await request<{ results: NotebookRunResult[] }>(
      `/api/v1/notebooks/${id}/run`,
      {
        method: "POST",
        body: JSON.stringify(options),
      },
    );
    return payload.results;
  },

  async shareNotebook(id: string): Promise<{ token: string }> {
    return request<{ token: string }>(`/api/v1/notebooks/${id}/share`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  async revokeShareNotebook(id: string): Promise<void> {
    await request<{ revoked: boolean }>(`/api/v1/notebooks/${id}/share`, {
      method: "DELETE",
    });
  },

  async listDashboards(): Promise<Dashboard[]> {
    const payload = await request<{ items: Dashboard[] }>("/api/v1/dashboards");
    return payload.items;
  },

  async getDashboard(id: string): Promise<Dashboard> {
    return request<Dashboard>(`/api/v1/dashboards/${id}`);
  },

  async createDashboard(input: { title: string; description?: string; widgets?: DashboardWidget[] }): Promise<Dashboard> {
    return request<Dashboard>("/api/v1/dashboards", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async applyDashboardTemplate(templateId: string, title?: string): Promise<Dashboard> {
    return request<Dashboard>("/api/v1/dashboards/from-template", {
      method: "POST",
      body: JSON.stringify({ templateId, ...(title ? { title } : {}) }),
    });
  },

  async updateDashboard(
    id: string,
    patch: { title?: string; description?: string; widgets?: DashboardWidget[] },
  ): Promise<Dashboard> {
    return request<Dashboard>(`/api/v1/dashboards/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
  },

  async deleteDashboard(id: string): Promise<void> {
    await request<{ removed: boolean }>(`/api/v1/dashboards/${id}`, { method: "DELETE" });
  },

  async shareDashboard(id: string): Promise<{ token: string }> {
    return request<{ token: string }>(`/api/v1/dashboards/${id}/share`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  async revokeShareDashboard(id: string): Promise<void> {
    await request<{ revoked: boolean }>(`/api/v1/dashboards/${id}/share`, {
      method: "DELETE",
    });
  },

  async listNotebookRuns(notebookId: string, limit = 50): Promise<CellRunRecord[]> {
    return request<CellRunRecord[]>(`/api/v1/notebooks/${notebookId}/runs`, {
      params: { limit: String(limit) },
    });
  },

  async refreshDashboard(
    id: string,
    options: { widgetIds?: string[]; force?: boolean } = {},
  ): Promise<Array<{ id: string; cache: DashboardWidget["cache"]; fresh: boolean }>> {
    const payload = await request<{
      widgets: Array<{ id: string; cache: DashboardWidget["cache"]; fresh: boolean }>;
    }>(`/api/v1/dashboards/${id}/refresh`, {
      method: "POST",
      body: JSON.stringify(options),
    });
    return payload.widgets;
  },
};

export type { CellOutput, Dashboard, DashboardWidget, Notebook, NotebookCell };