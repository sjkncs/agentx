"use client";

import React from "react";
import { useCallback, useMemo, useState } from "react";
import { LocaleProvider, useT } from "../../i18n/locale-context";
import { useNotebookStore } from "./notebook-store";
import { CellCard } from "./notebook-cell";
import type {
  CellKind,
  DashboardWidget,
  NotebookCell,
} from "./notebook-types";

export function NotebookHome({ initialId }: { initialId?: string }) {
  return (
    <LocaleProvider>
      <NotebookShell initialId={initialId} />
    </LocaleProvider>
  );
}

const CELL_OPTIONS: Array<{ kind: CellKind; icon: string }> = [
  { kind: "markdown", icon: "✍️" },
  { kind: "sql", icon: "📊" },
  { kind: "python", icon: "🐍" },
  { kind: "ai-prompt", icon: "🤖" },
];

function NotebookShell({ initialId }: { initialId?: string }) {
  const t = useT();
  const store = useNotebookStore(initialId);
  const [search, setSearch] = useState("");

  const filteredNotebooks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return store.notebooks;
    return store.notebooks.filter((nb) => nb.title.toLowerCase().includes(q));
  }, [store.notebooks, search]);

  const handlePromote = useCallback(
    (cell: NotebookCell) => {
      // Persist a "promote intent" in localStorage so the dashboard route can
      // pick it up on next mount and create a widget pre-bound to the cell.
      if (typeof window === "undefined") return;
      const payload = {
        cellId: cell.id,
        source: cell.source,
        kind: cell.kind,
        title: cell.notes?.trim() || `From ${cell.kind} cell`,
        createdAt: new Date().toISOString(),
      };
      window.localStorage.setItem("dfd:notebook:promote", JSON.stringify(payload));
      window.dispatchEvent(new CustomEvent("dfd:promote-cell", { detail: payload }));
      window.alert(t("notebook.promoted"));
    },
    [t],
  );

  if (store.loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-subtle text-sm text-muted">
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-subtle text-foreground">
      <header className="border-b border-border bg-surface px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="/data-tasks"
            className="rounded-md border border-border px-3 py-1 text-xs text-muted transition hover:text-foreground"
          >
            ← {t("common.backToWorkspace")}
          </a>
          <h1 className="text-lg font-semibold">{t("notebook.title")}</h1>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            {t("notebook.tagline")}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <input
              type="search"
              placeholder={t("common.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 rounded-md border border-border bg-surface px-3 py-1 text-sm focus:border-primary focus:outline-none"
            />
            <a
              href="/dashboard"
              className="rounded-md border border-border px-3 py-1 text-xs text-muted transition hover:text-foreground"
            >
              {t("notebook.openDashboard")}
            </a>
            <button
              type="button"
              onClick={() => void store.createNotebook()}
              className="rounded-md bg-primary px-3 py-1 text-sm font-medium text-white transition hover:bg-primary-light"
            >
              + {t("notebook.new")}
            </button>
          </div>
        </div>
      </header>

      <div className="grid gap-6 px-6 py-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-4">
          <section className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              {t("notebook.recent")}
            </h2>
            <ul className="mt-2 space-y-1">
              {filteredNotebooks.map((nb) => (
                <li key={nb.id}>
                  <button
                    type="button"
                    onClick={() => store.openNotebook(nb.id)}
                    className={`flex w-full flex-col items-start gap-1 rounded-md border px-3 py-2 text-left text-xs transition ${
                      store.notebook?.id === nb.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-surface-subtle"
                    }`}
                  >
                    <span className="font-medium text-foreground">{nb.title}</span>
                    <span className="text-muted">
                      {nb.cells.length} {t("notebook.cells")}
                      {" · "}
                      {new Date(nb.updatedAt).toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
              {filteredNotebooks.length === 0 && (
                <li className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted">
                  {t("notebook.empty")}
                </li>
              )}
            </ul>
          </section>

          <section className="rounded-xl border border-border bg-surface p-4 shadow-card text-xs">
            <h2 className="font-semibold uppercase tracking-wide text-muted">
              {t("notebook.tips")}
            </h2>
            <ul className="mt-2 space-y-1 text-foreground/80">
              <li>· {t("notebook.tipRunAll")}</li>
              <li>· {t("notebook.tipAi")}</li>
              <li>· {t("notebook.tipPromote")}</li>
            </ul>
          </section>
        </aside>

        <main className="space-y-4">
          {store.notebook ? (
            <NotebookEditor
              notebook={store.notebook}
              onTitleChange={store.setTitle}
              onUpdateCell={store.updateCell}
              onRunCell={store.runCell}
              onAppendCell={store.appendCell}
              onRemoveCell={store.removeCell}
              onMoveCell={store.moveCell}
              onSave={store.saveCurrent}
              onPromote={handlePromote}
              t={t}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted">
              {t("notebook.pickOrCreate")}
            </div>
          )}
          {store.notebook && (
            <NotebookAuditPanel
              runs={store.runs}
              loading={store.runsLoading}
              onReload={() => void store.loadRuns()}
            />
          )}
        </main>
      </div>
    </div>
  );
}

interface EditorProps {
  notebook: NonNullable<ReturnType<typeof useNotebookStore>["notebook"]>;
  onTitleChange: (title: string) => Promise<void>;
  onUpdateCell: (cellId: string, patch: Partial<NotebookCell>) => Promise<void>;
  onRunCell: (cellId: string) => Promise<void>;
  onAppendCell: (kind: CellKind) => Promise<NotebookCell>;
  onRemoveCell: (cellId: string) => Promise<void>;
  onMoveCell: (cellId: string, direction: "up" | "down") => Promise<void>;
  onSave: () => Promise<void>;
  onPromote: (cell: NotebookCell) => void;
  t: (key: string) => string;
}

function NotebookEditor(props: EditorProps) {
  const {
    notebook,
    onTitleChange,
    onUpdateCell,
    onRunCell,
    onAppendCell,
    onRemoveCell,
    onMoveCell,
    onSave,
    onPromote,
    t,
  } = props;

  const runAll = useCallback(async () => {
    for (const cell of notebook.cells) {
      if (cell.kind === "markdown") continue;
      await onRunCell(cell.id);
    }
  }, [notebook.cells, onRunCell]);

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-card">
        <input
          value={notebook.title}
          onChange={(e) => void onTitleChange(e.target.value)}
          className="flex-1 min-w-[200px] rounded-md border border-border bg-surface-subtle px-3 py-2 text-base font-semibold focus:border-primary focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void onSave()}
          className="rounded-md border border-border bg-surface px-3 py-2 text-xs transition hover:bg-surface-subtle"
        >
          {t("common.save")}
        </button>
        <button
          type="button"
          onClick={runAll}
          className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-white transition hover:bg-primary-light"
        >
          ▶ {t("notebook.runAll")}
        </button>
      </section>

      <div className="space-y-3">
        {notebook.cells.map((cell, idx) => (
          <CellCard
            key={cell.id}
            cell={cell}
            index={idx}
            total={notebook.cells.length}
            onChange={(patch) => void onUpdateCell(cell.id, patch)}
            onRun={() => void onRunCell(cell.id)}
            onRemove={() => void onRemoveCell(cell.id)}
            onMove={(direction) => void onMoveCell(cell.id, direction)}
            onPromoteToDashboard={() => onPromote(cell)}
          />
        ))}
      </div>

      <section className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border bg-surface px-4 py-3 text-xs">
        <span className="text-muted">{t("notebook.addCell")}</span>
        {CELL_OPTIONS.map((opt) => (
          <button
            key={opt.kind}
            type="button"
            onClick={() => void onAppendCell(opt.kind)}
            className="rounded-md border border-border bg-surface px-3 py-1 transition hover:bg-surface-subtle"
          >
            {opt.icon} {opt.kind}
          </button>
        ))}
      </section>
    </div>
  );
}

// Helper for the dashboard route to receive the promoted cell.
export function consumePromotedCell(): {
  cellId: string;
  source: string;
  kind: NotebookCell["kind"];
  title: string;
  createdAt: string;
} | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem("dfd:notebook:promote");
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as {
      cellId: string;
      source: string;
      kind: NotebookCell["kind"];
      title: string;
      createdAt: string;
    };
    window.localStorage.removeItem("dfd:notebook:promote");
    return data;
  } catch {
    return null;
  }
}

// Helper for the dashboard widget promoted from notebook cell.
export function widgetFromPromotedCell(payload: {
  cellId: string;
  source: string;
  kind: NotebookCell["kind"];
  title: string;
}): DashboardWidget {
  if (payload.kind === "sql") {
    return {
      id: `w-${payload.cellId}`,
      kind: "table",
      title: payload.title,
      source: payload.source,
      layout: { col: 0, row: 0, width: 6, height: 2 },
    };
  }
  if (payload.kind === "python") {
    return {
      id: `w-${payload.cellId}`,
      kind: "kpi",
      title: payload.title,
      source: payload.source,
      layout: { col: 0, row: 0, width: 3, height: 1 },
    };
  }
  if (payload.kind === "ai-prompt") {
    return {
      id: `w-${payload.cellId}`,
      kind: "markdown",
      title: payload.title,
      layout: { col: 0, row: 0, width: 6, height: 1 },
      cache: {
        markdown: `AI prompt:\n\n${payload.source}`,
        updatedAt: new Date().toISOString(),
      },
    };
  }
  return {
    id: `w-${payload.cellId}`,
    kind: "markdown",
    title: payload.title,
    layout: { col: 0, row: 0, width: 6, height: 1 },
    cache: {
      markdown: payload.source,
      updatedAt: new Date().toISOString(),
    },
  };
}

export interface NotebookAuditPanelProps {
  runs: Array<{
    cellId: string;
    status: string;
    elapsedMs?: number;
    createdAt: string;
    auditLogId?: string;
    error?: string;
  }>;
  loading: boolean;
  onReload: () => void;
}

export function NotebookAuditPanel({ runs, loading, onReload }: NotebookAuditPanelProps) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-card">
      <header className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Audit log
        </h3>
        <button
          type="button"
          onClick={onReload}
          data-testid="notebook-audit-reload"
          className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] transition hover:bg-surface-subtle"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>
      {runs.length === 0 ? (
        <p className="mt-2 text-[11px] text-muted">
          {loading ? "Loading…" : "No runs recorded yet. Click Run on a cell to populate this view."}
        </p>
      ) : (
        <table className="mt-2 min-w-full text-[11px]">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase text-muted">
              <th className="px-2 py-1">started</th>
              <th className="px-2 py-1">cell</th>
              <th className="px-2 py-1">status</th>
              <th className="px-2 py-1">elapsed</th>
              <th className="px-2 py-1">audit</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run, idx) => {
              const tone =
                run.status === "failed"
                  ? "text-rose-600"
                  : run.status === "completed"
                  ? "text-emerald-700"
                  : "text-foreground";
              return (
                <tr key={`${run.createdAt}-${idx}`} className="border-b border-border/60">
                  <td className="px-2 py-1 tabular-nums text-muted">
                    {new Date(run.createdAt).toLocaleTimeString()}
                  </td>
                  <td className="px-2 py-1 font-mono text-foreground">{run.cellId.slice(0, 12)}</td>
                  <td className={`px-2 py-1 font-semibold ${tone}`}>{run.status}</td>
                  <td className="px-2 py-1 tabular-nums text-muted">
                    {typeof run.elapsedMs === "number" ? `${run.elapsedMs}ms` : "—"}
                  </td>
                  <td className="px-2 py-1 font-mono text-muted">
                    {run.auditLogId ? run.auditLogId.slice(0, 8) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}