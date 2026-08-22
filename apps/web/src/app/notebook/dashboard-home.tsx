"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LocaleProvider, useT } from "../../i18n/locale-context";
import { notebookDashboardApi } from "./api-client";
import { useDashboardStore } from "./notebook-store";
import { WidgetView } from "./dashboard-widget";
import {
  consumePromotedCell,
  widgetFromPromotedCell,
} from "./notebook-home";
import type { DashboardWidget, DashboardWidgetKind } from "./notebook-types";

export function DashboardHome({ initialId }: { initialId?: string }) {
  return (
    <LocaleProvider>
      <DashboardShell initialId={initialId} />
    </LocaleProvider>
  );
}

const ADD_OPTIONS: Array<{ kind: DashboardWidgetKind; label: string; icon: string }> = [
  { kind: "kpi", label: "KPI", icon: "🔢" },
  { kind: "line-chart", label: "Line chart", icon: "📈" },
  { kind: "bar-chart", label: "Bar chart", icon: "📊" },
  { kind: "area-chart", label: "Area chart", icon: "🟦" },
  { kind: "table", label: "Table", icon: "📋" },
  { kind: "markdown", label: "Markdown", icon: "📝" },
  { kind: "trace-mini", label: "Trace mini", icon: "🛰️" },
];

function DashboardShell({ initialId }: { initialId?: string }) {
  const t = useT();
  const store = useDashboardStore(initialId);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Listen for cells promoted from the Notebook tab.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPromote = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        cellId: string;
        source: string;
        kind: "markdown" | "sql" | "python" | "ai-prompt";
        title: string;
        createdAt: string;
      };
      const widget = widgetFromPromotedCell(detail);
      store.addWidget(widget);
    };
    window.addEventListener("dfd:promote-cell", onPromote as EventListener);
    const fromStorage = consumePromotedCell();
    if (fromStorage) {
      store.addWidget(widgetFromPromotedCell(fromStorage));
    }
    return () => window.removeEventListener("dfd:promote-cell", onPromote as EventListener);
    // We intentionally subscribe once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddWidget = useCallback(
    (kind: DashboardWidgetKind) => {
      const widget: DashboardWidget = {
        id: `w-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        title: `${kind} widget`,
        layout: { col: 0, row: 0, width: kind === "kpi" ? 3 : 6, height: kind === "kpi" ? 1 : 2 },
      };
      store.addWidget(widget);
    },
    [store],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await store.refreshWidgets(undefined, { force: true });
    } finally {
      setRefreshing(false);
    }
  }, [store]);

  const gridCells = useMemo(() => {
    return Array.from({ length: 12 * 6 }, (_, idx) => idx);
  }, []);

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
          <h1 className="text-lg font-semibold">{t("dashboard.title")}</h1>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            {t("dashboard.tagline")}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <a
              href="/notebook"
              className="rounded-md border border-border px-3 py-1 text-xs text-muted transition hover:text-foreground"
            >
              {t("dashboard.openNotebook")}
            </a>
            <button
              type="button"
              onClick={() => setShowTemplatePicker((v) => !v)}
              className="rounded-md border border-border px-3 py-1 text-xs text-muted transition hover:text-foreground"
            >
              {t("dashboard.templates")}
            </button>
            <button
              type="button"
              onClick={() => store.createDashboard()}
              className="rounded-md bg-primary px-3 py-1 text-sm font-medium text-white transition hover:bg-primary-light"
            >
              + {t("dashboard.new")}
            </button>
          </div>
        </div>
        {showTemplatePicker && (
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {store.templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => {
                  store.createDashboard(template.id);
                  setShowTemplatePicker(false);
                }}
                className="rounded-lg border border-border bg-surface-subtle p-3 text-left transition hover:border-primary"
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className="text-lg">{template.cover ?? "📊"}</span>
                  {template.name}
                </div>
                <p className="mt-1 text-xs text-muted">{template.description}</p>
                <p className="mt-1 text-[11px] text-muted">
                  {template.widgets.length} {t("dashboard.widgets")}
                </p>
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="grid gap-6 px-6 py-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-4">
          <section className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
              {t("dashboard.dashboards")}
            </h2>
            <ul className="mt-2 space-y-1">
              {store.dashboards.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => store.openDashboard(d.id)}
                    className={`flex w-full flex-col items-start gap-1 rounded-md border px-3 py-2 text-left text-xs transition ${
                      store.dashboard?.id === d.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-surface-subtle"
                    }`}
                  >
                    <span className="font-medium text-foreground">{d.title}</span>
                    <span className="text-muted">
                      {d.widgets.length} {t("dashboard.widgets")} ·{" "}
                      {new Date(d.updatedAt).toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-border bg-surface p-4 shadow-card text-xs">
            <h2 className="font-semibold uppercase tracking-wide text-muted">
              {t("dashboard.addWidget")}
            </h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {ADD_OPTIONS.map((opt) => (
                <button
                  key={opt.kind}
                  type="button"
                  onClick={() => handleAddWidget(opt.kind)}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] transition hover:bg-surface-subtle"
                >
                  {opt.icon} {opt.label}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <main className="space-y-4">
          {store.dashboard ? (
            <>
              <DashboardToolbar
                dashboard={store.dashboard}
                onShare={store.shareCurrent}
                onRevoke={store.revokeShare}
              />
              <DashboardEditor
                dashboard={store.dashboard}
                onTitleChange={store.setTitle}
                onUpdateWidget={store.updateWidget}
                onRemoveWidget={store.removeWidget}
                onSave={store.saveCurrent}
                onRefresh={handleRefresh}
                refreshing={refreshing}
                gridCells={gridCells}
                t={t}
              />
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-muted">
              {t("dashboard.pickOrCreate")}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

interface EditorProps {
  dashboard: NonNullable<ReturnType<typeof useDashboardStore>["dashboard"]>;
  onTitleChange: (title: string) => void;
  onUpdateWidget: (widgetId: string, patch: Partial<DashboardWidget>) => void;
  onRemoveWidget: (widgetId: string) => void;
  onSave: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  gridCells: number[];
  t: (key: string) => string;
}

function DashboardEditor(props: EditorProps) {
  const {
    dashboard,
    onTitleChange,
    onUpdateWidget,
    onRemoveWidget,
    onSave,
    onRefresh,
    refreshing,
    gridCells,
    t,
  } = props;
  const occupied = new Set<string>();
  for (const widget of dashboard.widgets) {
    const { col, row, width, height } = widget.layout;
    for (let r = row; r < row + height; r += 1) {
      for (let c = col; c < col + width; c += 1) {
        occupied.add(`${c}-${r}`);
      }
    }
  }
  const refreshableCount = dashboard.widgets.filter(
    (w) => typeof w.source === "string" && w.source.length > 0 && typeof w.datasourceId === "string",
  ).length;
  const errorCount = dashboard.widgets.filter((w) => w.cache?.error).length;

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-card">
        <input
          value={dashboard.title}
          onChange={(e) => onTitleChange(e.target.value)}
          className="flex-1 min-w-[200px] rounded-md border border-border bg-surface-subtle px-3 py-2 text-base font-semibold focus:border-primary focus:outline-none"
        />
        <button
          type="button"
          onClick={onSave}
          className="rounded-md border border-border bg-surface px-3 py-2 text-xs transition hover:bg-surface-subtle"
        >
          {t("common.save")}
        </button>
        {onRefresh && (
          <button
            type="button"
            disabled={refreshableCount === 0 || refreshing}
            onClick={onRefresh}
            data-testid="dashboard-refresh"
            className="rounded-md border border-primary bg-primary px-3 py-2 text-xs font-semibold text-white transition hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : `Refresh ${refreshableCount} widget${refreshableCount === 1 ? "" : "s"}`}
          </button>
        )}
        {errorCount > 0 && (
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
            {errorCount} errored
          </span>
        )}
        <span className="text-xs text-muted">
          {dashboard.widgets.length} {t("dashboard.widgets")}
        </span>
      </section>

      <section className="relative rounded-xl border border-border bg-surface p-3 shadow-card">
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
            gridAutoRows: "60px",
          }}
        >
          {gridCells.map((idx) => {
            const col = idx % 12;
            const row = Math.floor(idx / 12);
            const key = `${col}-${row}`;
            const widgetHere = dashboard.widgets.find(
              (w) => w.layout.col === col && w.layout.row === row,
            );
            if (widgetHere) {
              const { width, height } = widgetHere.layout;
              return (
                <div
                  key={`w-${widgetHere.id}`}
                  style={{
                    gridColumn: `span ${width} / span ${width}`,
                    gridRow: `span ${height} / span ${height}`,
                  }}
                >
                  <WidgetView
                    widget={widgetHere}
                    onChange={(patch) => onUpdateWidget(widgetHere.id, patch)}
                    onRemove={() => onRemoveWidget(widgetHere.id)}
                  />
                </div>
              );
            }
            if (occupied.has(key)) return null;
            return (
              <div
                key={key}
                className="rounded-md border border-dashed border-border bg-surface-subtle/40 text-center text-[10px] leading-[60px] text-muted/60"
              >
                {col},{row}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function DashboardToolbar({
  dashboard,
  onShare,
  onRevoke,
}: {
  dashboard: NonNullable<ReturnType<typeof useDashboardStore>["dashboard"]>;
  onShare: () => Promise<string | null>;
  onRevoke: () => Promise<void>;
}) {
  const [shareToken, setShareToken] = useState<string | null>(
    dashboard.shareToken ?? null,
  );
  useEffect(() => {
    setShareToken(dashboard.shareToken ?? null);
  }, [dashboard.shareToken]);
  const [copied, setCopied] = useState(false);

  const handleExport = (ext: "md" | "json") => {
    if (typeof window === "undefined") return;
    window.open(`/api/v1/dashboards/${dashboard.id}/export.${ext}`, "_blank");
  };

  const handleShare = async () => {
    const token = await onShare();
    if (token) setShareToken(token);
  };

  const handleRevoke = async () => {
    await onRevoke();
    setShareToken(null);
  };

  const handleCopy = async () => {
    if (!shareToken || typeof navigator === "undefined") return;
    const url = `${window.location.origin}/dashboard/share/${shareToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard may be blocked; the user can still read the URL in the field.
    }
  };

  return (
    <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-card text-xs">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold uppercase text-primary">
          export
        </span>
        <button
          type="button"
          onClick={() => handleExport("md")}
          className="rounded-md border border-border bg-surface px-2 py-1 transition hover:bg-surface-subtle"
        >
          Markdown
        </button>
        <button
          type="button"
          onClick={() => handleExport("json")}
          className="rounded-md border border-border bg-surface px-2 py-1 transition hover:bg-surface-subtle"
        >
          JSON
        </button>
      </div>
      <div className="flex flex-1 items-center gap-2 min-w-[280px]">
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold uppercase text-emerald-700">
          share
        </span>
        {shareToken ? (
          <>
            <input
              readOnly
              value={`${typeof window !== "undefined" ? window.location.origin : ""}/dashboard/share/${shareToken}`}
              className="flex-1 min-w-[200px] rounded border border-border bg-surface-subtle px-2 py-1 text-[11px] text-foreground"
              data-testid="dashboard-share-url"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-md border border-border bg-surface px-2 py-1 transition hover:bg-surface-subtle"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={handleRevoke}
              className="rounded-md border border-rose-300 px-2 py-1 text-rose-700 transition hover:bg-rose-50"
            >
              Revoke
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleShare}
            data-testid="dashboard-share-create"
            className="rounded-md border border-emerald-600 bg-emerald-600 px-2 py-1 font-semibold text-white transition hover:bg-emerald-500"
          >
            Generate share link
          </button>
        )}
      </div>
    </section>
  );
}