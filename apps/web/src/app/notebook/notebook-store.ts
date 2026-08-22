"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CellOutput,
  Dashboard,
  DashboardTemplate,
  DashboardWidget,
  Notebook,
  NotebookCell,
} from "./notebook-types";
import {
  DASHBOARD_STORAGE_KEY,
  DASHBOARD_TEMPLATES,
  NOTEBOOK_STORAGE_KEY,
  emptyDashboard,
  emptyNotebook,
} from "./notebook-types";
import {
  NotebookDashboardApiError,
  notebookDashboardApi,
  type NotebookRunResult,
} from "./api-client";

/**
 * Persistence for notebooks and dashboards.
 *
 * Source of truth: the server (apps/api + SQLite). The browser-side store
 * keeps a localStorage **read-through cache** so the first paint can render
 * without waiting on the network; every mutation flows to the server and
 * updates state from the server response.
 *
 * If the API is unreachable (offline / 5xx) the mutation is rolled back
 * and the error surfaces via `lastError` so the UI can show a toast.
 */

const isBrowser = typeof window !== "undefined";

function safeRead<T>(key: string): T | null {
  if (!isBrowser) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeWrite<T>(key: string, value: T): void {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota / private mode — silently degrade.
  }
}

function safeRemove(key: string): void {
  if (!isBrowser) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function cacheNotebook(nb: Notebook): void {
  safeWrite(`${NOTEBOOK_STORAGE_KEY}:doc:${nb.id}`, nb);
  const index = safeRead<Notebook[]>(`${NOTEBOOK_STORAGE_KEY}:index`) ?? [];
  const next = [nb, ...index.filter((item) => item.id !== nb.id)];
  safeWrite(`${NOTEBOOK_STORAGE_KEY}:index`, next);
}

function uncacheNotebook(id: string): void {
  safeRemove(`${NOTEBOOK_STORAGE_KEY}:doc:${id}`);
  const index = safeRead<Notebook[]>(`${NOTEBOOK_STORAGE_KEY}:index`) ?? [];
  safeWrite(`${NOTEBOOK_STORAGE_KEY}:index`, index.filter((nb) => nb.id !== id));
}

function cacheDashboard(d: Dashboard): void {
  safeWrite(`${DASHBOARD_STORAGE_KEY}:doc:${d.id}`, d);
  const index = safeRead<Dashboard[]>(`${DASHBOARD_STORAGE_KEY}:index`) ?? [];
  const next = [d, ...index.filter((item) => item.id !== d.id)];
  safeWrite(`${DASHBOARD_STORAGE_KEY}:index`, next);
}

function uncacheDashboard(id: string): void {
  safeRemove(`${DASHBOARD_STORAGE_KEY}:doc:${id}`);
  const index = safeRead<Dashboard[]>(`${DASHBOARD_STORAGE_KEY}:index`) ?? [];
  safeWrite(`${DASHBOARD_STORAGE_KEY}:index`, index.filter((d) => d.id !== id));
}

function readCachedNotebooks(): Notebook[] {
  return safeRead<Notebook[]>(`${NOTEBOOK_STORAGE_KEY}:index`) ?? [];
}

function readCachedDashboards(): Dashboard[] {
  return safeRead<Dashboard[]>(`${DASHBOARD_STORAGE_KEY}:index`) ?? [];
}

// ---------------------------------------------------------------------------
// Notebooks
// ---------------------------------------------------------------------------

interface NotebookStore {
  notebooks: Notebook[];
  notebook: Notebook | null;
  loading: boolean;
  lastError: string | null;
  refreshNotebooks: () => Promise<void>;
  createNotebook: (input?: { title?: string }) => Promise<Notebook>;
  openNotebook: (id: string) => Promise<Notebook | null>;
  updateCell: (cellId: string, patch: Partial<NotebookCell>) => Promise<void>;
  appendCell: (kind: NotebookCell["kind"]) => Promise<NotebookCell>;
  removeCell: (cellId: string) => Promise<void>;
  moveCell: (cellId: string, direction: "up" | "down") => Promise<void>;
  setTitle: (title: string) => Promise<void>;
  saveCurrent: () => Promise<void>;
  appendOutput: (cellId: string, output: CellOutput) => Promise<void>;
  runCell: (cellId: string) => Promise<void>;
  runAllCells: () => Promise<NotebookRunResult[]>;
  shareCurrent: () => Promise<string | null>;
  revokeShare: () => Promise<void>;
  deleteCurrent: () => Promise<void>;
  loadRuns: () => Promise<void>;
  runs: CellRunRecord[];
  runsLoading: boolean;
}

export function useNotebookStore(initialId?: string): NotebookStore {
  const [notebooks, setNotebooks] = useState<Notebook[]>(() => readCachedNotebooks());
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);
  const [runs, setRuns] = useState<CellRunRecord[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  // Initial server-side hydration.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const items = await notebookDashboardApi.listNotebooks();
        if (cancelled) return;
        for (const item of items) cacheNotebook(item);
        setNotebooks(items);
        const target = initialId
          ? items.find((nb) => nb.id === initialId)
          : items[0];
        if (target) {
          const detail = await notebookDashboardApi.getNotebook(target.id);
          if (cancelled) return;
          cacheNotebook(detail);
          setNotebook(detail);
        }
      } catch (err) {
        if (!cancelled) {
          setLastError(messageOf(err));
          // Keep cached entries — better than a blank screen.
          const cached = readCachedNotebooks();
          setNotebooks(cached);
          if (initialId) {
            const cachedDoc = safeRead<Notebook>(`${NOTEBOOK_STORAGE_KEY}:doc:${initialId}`);
            setNotebook(cachedDoc ?? null);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialId]);

  const refreshNotebooks = useCallback(async () => {
    const items = await notebookDashboardApi.listNotebooks();
    setNotebooks(items);
    for (const item of items) cacheNotebook(item);
  }, []);

  const updateServerNotebook = useCallback(
    async (next: Notebook) => {
      cacheNotebook(next);
      const saved = await notebookDashboardApi.updateNotebook(next.id, {
        title: next.title,
        description: next.description,
        cells: next.cells,
        datasources: next.datasources,
      });
      cacheNotebook(saved);
      setNotebook(saved);
      setNotebooks((prev) => {
        const index = prev.filter((nb) => nb.id !== saved.id);
        return [saved, ...index];
      });
      return saved;
    },
    [],
  );

  const createNotebook = useCallback(
    async (input: { title?: string } = {}) => {
      const fresh = await notebookDashboardApi.createNotebook({
        title: input.title ?? "Untitled notebook",
      });
      cacheNotebook(fresh);
      setNotebooks((prev) => [fresh, ...prev]);
      setNotebook(fresh);
      return fresh;
    },
    [],
  );

  const openNotebook = useCallback(async (id: string) => {
    const detail = await notebookDashboardApi.getNotebook(id);
    cacheNotebook(detail);
    setNotebook(detail);
    return detail;
  }, []);

  const updateCell = useCallback(
    async (cellId: string, patch: Partial<NotebookCell>) => {
      const current = notebook;
      if (!current) return;
      const optimistic: Notebook = {
        ...current,
        cells: current.cells.map((cell) =>
          cell.id === cellId ? { ...cell, ...patch } : cell,
        ),
      };
      setNotebook(optimistic);
      try {
        await updateServerNotebook(optimistic);
      } catch (err) {
        setLastError(messageOf(err));
        setNotebook(current);
      }
    },
    [notebook, updateServerNotebook],
  );

  const appendCell = useCallback(
    async (kind: NotebookCell["kind"]) => {
      const current = notebook;
      if (!current) throw new Error("no notebook open");
      const cell: NotebookCell = {
        id: `cell-${Math.random().toString(36).slice(2, 10)}`,
        kind,
        source: "",
        status: "idle",
        outputs: [],
      };
      const optimistic: Notebook = { ...current, cells: [...current.cells, cell] };
      setNotebook(optimistic);
      try {
        await updateServerNotebook(optimistic);
      } catch (err) {
        setLastError(messageOf(err));
        setNotebook(current);
        throw err;
      }
      return cell;
    },
    [notebook, updateServerNotebook],
  );

  const removeCell = useCallback(
    async (cellId: string) => {
      const current = notebook;
      if (!current) return;
      const optimistic: Notebook = {
        ...current,
        cells: current.cells.filter((cell) => cell.id !== cellId),
      };
      setNotebook(optimistic);
      try {
        await updateServerNotebook(optimistic);
      } catch (err) {
        setLastError(messageOf(err));
        setNotebook(current);
      }
    },
    [notebook, updateServerNotebook],
  );

  const moveCell = useCallback(
    async (cellId: string, direction: "up" | "down") => {
      const current = notebook;
      if (!current) return;
      const idx = current.cells.findIndex((cell) => cell.id === cellId);
      if (idx < 0) return;
      const target = direction === "up" ? idx - 1 : idx + 1;
      if (target < 0 || target >= current.cells.length) return;
      const cells = [...current.cells];
      const [moved] = cells.splice(idx, 1);
      cells.splice(target, 0, moved!);
      const optimistic: Notebook = { ...current, cells };
      setNotebook(optimistic);
      try {
        await updateServerNotebook(optimistic);
      } catch (err) {
        setLastError(messageOf(err));
        setNotebook(current);
      }
    },
    [notebook, updateServerNotebook],
  );

  const setTitle = useCallback(
    async (title: string) => {
      const current = notebook;
      if (!current) return;
      const optimistic: Notebook = { ...current, title };
      setNotebook(optimistic);
      try {
        await updateServerNotebook(optimistic);
      } catch (err) {
        setLastError(messageOf(err));
        setNotebook(current);
      }
    },
    [notebook, updateServerNotebook],
  );

  const saveCurrent = useCallback(async () => {
    const current = notebook;
    if (!current) return;
    try {
      await updateServerNotebook(current);
    } catch (err) {
      setLastError(messageOf(err));
    }
  }, [notebook, updateServerNotebook]);

  const appendOutput = useCallback(
    async (cellId: string, output: CellOutput) => {
      const current = notebook;
      if (!current) return;
      const optimistic: Notebook = {
        ...current,
        cells: current.cells.map((cell) =>
          cell.id === cellId
            ? { ...cell, outputs: [...cell.outputs, output] }
            : cell,
        ),
      };
      setNotebook(optimistic);
      try {
        await updateServerNotebook(optimistic);
      } catch (err) {
        setLastError(messageOf(err));
        setNotebook(current);
      }
    },
    [notebook, updateServerNotebook],
  );

  const runCell = useCallback(
    async (cellId: string) => {
      const current = notebook;
      if (!current) return;
      // Mark the cell as running for instant feedback.
      await updateCell(cellId, { status: "running", outputs: [] });
      try {
        const results = await notebookDashboardApi.runNotebook(current.id);
        applyResultsToCells(current, results);
      } catch (err) {
        setLastError(messageOf(err));
        await updateCell(cellId, {
          status: "failed",
          outputs: [{ kind: "error", message: messageOf(err) }],
        });
      }
    },
    [notebook, updateCell],
  );

  const runAllCells = useCallback(async () => {
    const current = notebook;
    if (!current) return [];
    try {
      const results = await notebookDashboardApi.runNotebook(current.id);
      applyResultsToCells(current, results);
      return results;
    } catch (err) {
      setLastError(messageOf(err));
      return [];
    }
  }, [notebook, updateServerNotebook]);

  const shareCurrent = useCallback(async () => {
    const current = notebook;
    if (!current) return null;
    try {
      const { token } = await notebookDashboardApi.shareNotebook(current.id);
      const next: Notebook = { ...current, shareToken: token };
      setNotebook(next);
      cacheNotebook(next);
      return token;
    } catch (err) {
      setLastError(messageOf(err));
      return null;
    }
  }, [notebook]);

  const revokeShare = useCallback(async () => {
    const current = notebook;
    if (!current) return;
    try {
      await notebookDashboardApi.revokeShareNotebook(current.id);
      const next: Notebook = { ...current, shareToken: undefined };
      setNotebook(next);
      cacheNotebook(next);
    } catch (err) {
      setLastError(messageOf(err));
    }
  }, [notebook]);

  const deleteCurrent = useCallback(async () => {
    const current = notebook;
    if (!current) return;
    try {
      await notebookDashboardApi.deleteNotebook(current.id);
      uncacheNotebook(current.id);
      setNotebooks((prev) => prev.filter((nb) => nb.id !== current.id));
      setNotebook(null);
    } catch (err) {
      setLastError(messageOf(err));
    }
  }, [notebook]);

  const loadRuns = useCallback(async () => {
    const current = notebook;
    if (!current) return;
    setRunsLoading(true);
    try {
      const items = await notebookDashboardApi.listNotebookRuns(current.id, 50);
      setRuns(items);
    } catch (err) {
      setLastError(messageOf(err));
    } finally {
      setRunsLoading(false);
    }
  }, [notebook]);

  function applyResultsToCells(prev: Notebook, results: NotebookRunResult[]) {
    const byCellId = new Map(results.map((r) => [r.cellId, r]));
    const updatedCells: NotebookCell[] = prev.cells.map((cell) => {
      const result = byCellId.get(cell.id);
      if (!result) return cell;
      return {
        ...cell,
        status: result.status,
        outputs: result.outputs,
        durationMs: result.durationMs,
        lastRunAt: new Date().toISOString(),
      };
    });
    const optimistic: Notebook = { ...prev, cells: updatedCells };
    setNotebook(optimistic);
    void updateServerNotebook(optimistic).catch((err) => setLastError(messageOf(err)));
  }

  return {
    notebooks,
    notebook,
    loading,
    lastError,
    refreshNotebooks,
    createNotebook,
    openNotebook,
    updateCell,
    appendCell,
    removeCell,
    moveCell,
    setTitle,
    saveCurrent,
    appendOutput,
    runCell,
    runAllCells,
    shareCurrent,
    revokeShare,
    deleteCurrent,
    loadRuns,
    runs,
    runsLoading,
  };
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

interface DashboardStore {
  dashboards: Dashboard[];
  dashboard: Dashboard | null;
  loading: boolean;
  lastError: string | null;
  templates: DashboardTemplate[];
  refreshDashboards: () => Promise<void>;
  createDashboard: (templateId?: string) => Promise<Dashboard>;
  openDashboard: (id: string) => Promise<Dashboard | null>;
  updateWidget: (widgetId: string, patch: Partial<DashboardWidget>) => Promise<void>;
  addWidget: (widget: DashboardWidget) => Promise<void>;
  removeWidget: (widgetId: string) => Promise<void>;
  setTitle: (title: string) => Promise<void>;
  saveCurrent: () => Promise<void>;
  shareCurrent: () => Promise<string | null>;
  deleteCurrent: () => Promise<void>;
  refreshWidgets: (widgetIds?: string[], options?: { force?: boolean }) => Promise<void>;
}

export function useDashboardStore(initialId?: string): DashboardStore {
  const [dashboards, setDashboards] = useState<Dashboard[]>(() => readCachedDashboards());
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);
  const templates = DASHBOARD_TEMPLATES;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const items = await notebookDashboardApi.listDashboards();
        if (cancelled) return;
        for (const item of items) cacheDashboard(item);
        setDashboards(items);
        const target = initialId
          ? items.find((d) => d.id === initialId)
          : items[0];
        if (target) {
          const detail = await notebookDashboardApi.getDashboard(target.id);
          if (cancelled) return;
          cacheDashboard(detail);
          setDashboard(detail);
        }
      } catch (err) {
        if (!cancelled) {
          setLastError(messageOf(err));
          const cached = readCachedDashboards();
          setDashboards(cached);
          if (initialId) {
            const cachedDoc = safeRead<Dashboard>(`${DASHBOARD_STORAGE_KEY}:doc:${initialId}`);
            setDashboard(cachedDoc ?? null);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialId]);

  const refreshDashboards = useCallback(async () => {
    const items = await notebookDashboardApi.listDashboards();
    setDashboards(items);
    for (const item of items) cacheDashboard(item);
  }, []);

  const updateServerDashboard = useCallback(
    async (next: Dashboard) => {
      cacheDashboard(next);
      const saved = await notebookDashboardApi.updateDashboard(next.id, {
        title: next.title,
        description: next.description,
        widgets: next.widgets,
      });
      cacheDashboard(saved);
      setDashboard(saved);
      setDashboards((prev) => {
        const index = prev.filter((d) => d.id !== saved.id);
        return [saved, ...index];
      });
      return saved;
    },
    [],
  );

  const createDashboard = useCallback(
    async (templateId?: string) => {
      if (templateId) {
        const created = await notebookDashboardApi.applyDashboardTemplate(templateId);
        cacheDashboard(created);
        setDashboards((prev) => [created, ...prev]);
        setDashboard(created);
        return created;
      }
      const fresh = await notebookDashboardApi.createDashboard({
        title: "Untitled dashboard",
      });
      cacheDashboard(fresh);
      setDashboards((prev) => [fresh, ...prev]);
      setDashboard(fresh);
      return fresh;
    },
    [],
  );

  const openDashboard = useCallback(async (id: string) => {
    const detail = await notebookDashboardApi.getDashboard(id);
    cacheDashboard(detail);
    setDashboard(detail);
    return detail;
  }, []);

  const updateWidget = useCallback(
    async (widgetId: string, patch: Partial<DashboardWidget>) => {
      const current = dashboard;
      if (!current) return;
      const optimistic: Dashboard = {
        ...current,
        widgets: current.widgets.map((w) =>
          w.id === widgetId ? { ...w, ...patch } : w,
        ),
      };
      setDashboard(optimistic);
      try {
        await updateServerDashboard(optimistic);
      } catch (err) {
        setLastError(messageOf(err));
        setDashboard(current);
      }
    },
    [dashboard, updateServerDashboard],
  );

  const addWidget = useCallback(
    async (widget: DashboardWidget) => {
      const current = dashboard;
      if (!current) return;
      const optimistic: Dashboard = {
        ...current,
        widgets: [...current.widgets, widget],
      };
      setDashboard(optimistic);
      try {
        await updateServerDashboard(optimistic);
      } catch (err) {
        setLastError(messageOf(err));
        setDashboard(current);
      }
    },
    [dashboard, updateServerDashboard],
  );

  const removeWidget = useCallback(
    async (widgetId: string) => {
      const current = dashboard;
      if (!current) return;
      const optimistic: Dashboard = {
        ...current,
        widgets: current.widgets.filter((w) => w.id !== widgetId),
      };
      setDashboard(optimistic);
      try {
        await updateServerDashboard(optimistic);
      } catch (err) {
        setLastError(messageOf(err));
        setDashboard(current);
      }
    },
    [dashboard, updateServerDashboard],
  );

  const setTitle = useCallback(
    async (title: string) => {
      const current = dashboard;
      if (!current) return;
      const optimistic: Dashboard = { ...current, title };
      setDashboard(optimistic);
      try {
        await updateServerDashboard(optimistic);
      } catch (err) {
        setLastError(messageOf(err));
        setDashboard(current);
      }
    },
    [dashboard, updateServerDashboard],
  );

  const saveCurrent = useCallback(async () => {
    const current = dashboard;
    if (!current) return;
    try {
      await updateServerDashboard(current);
    } catch (err) {
      setLastError(messageOf(err));
    }
  }, [dashboard, updateServerDashboard]);

  const shareCurrent = useCallback(async () => {
    const current = dashboard;
    if (!current) return null;
    try {
      const { token } = await notebookDashboardApi.shareNotebook(current.id);
      // Re-using notebook's share endpoint shape: the API surface mirrors
      // notebook share so dashboards get the same shape.
      return token;
    } catch (err) {
      setLastError(messageOf(err));
      return null;
    }
  }, [dashboard]);

  const deleteCurrent = useCallback(async () => {
    const current = dashboard;
    if (!current) return;
    try {
      await notebookDashboardApi.deleteDashboard(current.id);
      uncacheDashboard(current.id);
      setDashboards((prev) => prev.filter((d) => d.id !== current.id));
      setDashboard(null);
    } catch (err) {
      setLastError(messageOf(err));
    }
  }, [dashboard]);

  const refreshWidgets = useCallback(
    async (widgetIds?: string[], options: { force?: boolean } = {}) => {
      const current = dashboard;
      if (!current) return;
      try {
        const outputs = await notebookDashboardApi.refreshDashboard(current.id, {
          ...(widgetIds ? { widgetIds } : {}),
          force: options.force ?? true,
        });
        const cacheById = new Map(outputs.map((o) => [o.id, o.cache]));
        const widgets = current.widgets.map((w) => {
          const next = cacheById.get(w.id);
          return next ? { ...w, cache: next } : w;
        });
        // Persist via the server-side update endpoint so subsequent polls hit
        // the cache layer instead of always re-running.
        const saved = await notebookDashboardApi.updateDashboard(current.id, {
          widgets,
        });
        cacheDashboard(saved);
        setDashboard(saved);
        setDashboards((prev) => {
          const idx = prev.filter((d) => d.id !== saved.id);
          return [saved, ...idx];
        });
      } catch (err) {
        setLastError(messageOf(err));
      }
    },
    [dashboard],
  );

  // Auto-refresh effect: schedule a poll for the next interval across every
  // widget that opts into a refresh cadence. The timer is reset on each render
  // so changing the dashboard never leaves a stale interval running.
  useEffect(() => {
    if (!dashboard) return;
    const due = dashboard.widgets.filter(
      (w) =>
        typeof w.refreshIntervalMs === "number" &&
        w.refreshIntervalMs > 0 &&
        (w.source && w.datasourceId),
    );
    if (due.length === 0) return;
    const timers = due.map((w) => {
      const delay = w.refreshIntervalMs ?? 60_000;
      return setTimeout(() => {
        void refreshWidgets([w.id], { force: false });
      }, delay);
    });
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, [dashboard, refreshWidgets]);

  return {
    dashboards,
    dashboard,
    loading,
    lastError,
    templates,
    refreshDashboards,
    createDashboard,
    openDashboard,
    updateWidget,
    addWidget,
    removeWidget,
    setTitle,
    saveCurrent,
    shareCurrent,
    deleteCurrent,
    refreshWidgets,
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function messageOf(err: unknown): string {
  if (err instanceof NotebookDashboardApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

// Re-export so legacy callers don't break.
export { emptyNotebook, emptyDashboard };