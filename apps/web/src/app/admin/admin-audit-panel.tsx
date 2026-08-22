"use client";

import { useState } from "react";
import { useT } from "../../i18n/locale-context";
import { configApi, ConfigApiError } from "../../lib/config-api/client";
import type { AdminAuditListResponseDto } from "../../lib/config-api/types";

const CATEGORIES = [
  "auth",
  "workspace",
  "member",
  "datasource",
  "model",
  "skill",
  "mcp",
  "knowledge",
  "session",
  "run",
  "artifact",
  "export",
  "settings",
] as const;

const SEVERITIES = ["info", "warning", "critical"] as const;

const SEVERITY_BADGE: Record<string, string> = {
  info: "bg-surface-subtle text-muted",
  warning: "border border-amber-200 bg-amber-50 text-amber-800",
  critical: "border border-rose-200 bg-rose-50 text-rose-700",
};

export function AdminAuditPanel({
  data,
  loading,
  onRefresh,
}: {
  data: AdminAuditListResponseDto | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
}) {
  const t = useT();
  const [category, setCategory] = useState<string | "">("");
  const [severity, setSeverity] = useState<string | "">("");
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const applyFilters = async (nextCategory: string, nextSeverity: string) => {
    setError(null);
    try {
      const params: {
        category?: string;
        severity?: "info" | "warning" | "critical";
      } = {};
      if (nextCategory) params.category = nextCategory;
      if (nextSeverity === "info" || nextSeverity === "warning" || nextSeverity === "critical") {
        params.severity = nextSeverity;
      }
      const result = await configApi.listAdminAudit({ limit: 100, ...params });
      setLocalData(result);
    } catch (err) {
      setError(
        err instanceof ConfigApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to apply filter.",
      );
    }
  };

  const [localData, setLocalData] = useState<AdminAuditListResponseDto | null>(data);
  if (data && !localData) setLocalData(data);
  const view = localData ?? data;

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const result = await configApi.exportAdminAudit({ limit: 1000 });
      const blob = new Blob(
        [Uint8Array.from(atob(result.content_base64), (c) => c.charCodeAt(0))],
        { type: result.mime_type },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(
        err instanceof ConfigApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to export audit log.",
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div>
      ) : null}

      <article className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
        <header className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t("admin.audit.title")}</h2>
            <p className="mt-1 text-xs text-muted">{t("admin.audit.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void onRefresh()}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-muted transition hover:bg-surface-subtle hover:text-foreground"
            >
              {t("admin.audit.refresh")}
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-light disabled:opacity-50"
            >
              {exporting ? t("admin.audit.exporting") : t("admin.audit.exportCsv")}
            </button>
          </div>
        </header>

        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <SeverityCard
            label={t("admin.audit.severity.info")}
            value={view?.severity_counts_7d.info ?? 0}
            tone="info"
          />
          <SeverityCard
            label={t("admin.audit.severity.warning")}
            value={view?.severity_counts_7d.warning ?? 0}
            tone="warning"
          />
          <SeverityCard
            label={t("admin.audit.severity.critical")}
            value={view?.severity_counts_7d.critical ?? 0}
            tone="critical"
          />
        </div>

        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col">
            <span className="mb-1 text-[11px] font-medium text-muted">{t("admin.audit.category")}</span>
            <select
              value={category}
              onChange={(e) => {
                const v = e.target.value;
                setCategory(v);
                void applyFilters(v, severity);
              }}
              className="h-9 rounded-lg border border-border bg-white px-3 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
            >
              <option value="">{t("admin.audit.allCategories")}</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col">
            <span className="mb-1 text-[11px] font-medium text-muted">{t("admin.audit.severityLabel")}</span>
            <select
              value={severity}
              onChange={(e) => {
                const v = e.target.value;
                setSeverity(v);
                void applyFilters(category, v);
              }}
              className="h-9 rounded-lg border border-border bg-white px-3 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
            >
              <option value="">{t("admin.audit.allSeverities")}</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {t(`admin.audit.severity.${s}`)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-border">
          <table className="w-full min-w-max text-left text-[11px]">
            <thead className="sticky top-0 z-10 bg-surface-subtle text-muted-light shadow-[0_1px_0_0_var(--border)]">
              <tr>
                <th className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{t("admin.audit.colTime")}</th>
                <th className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{t("admin.audit.colCategory")}</th>
                <th className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{t("admin.audit.colAction")}</th>
                <th className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{t("admin.audit.colSeverity")}</th>
                <th className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{t("admin.audit.colActor")}</th>
                <th className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{t("admin.audit.colTarget")}</th>
                <th className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{t("admin.audit.colIp")}</th>
                <th className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{t("admin.audit.colMetadata")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-2.5 py-6 text-center text-muted-light">
                    {t("admin.audit.loading")}
                  </td>
                </tr>
              ) : view?.items.length ? (
                view.items.map((e) => (
                  <tr key={e.id} className="border-t border-border transition-colors duration-150 hover:bg-primary-light/5">
                    <td className="whitespace-nowrap px-2.5 py-1.5 tabular text-muted">
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-muted">{e.category}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 font-medium text-foreground">{e.action}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${SEVERITY_BADGE[e.severity] ?? ""}`}>
                        {t(`admin.audit.severity.${e.severity}`)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-muted">{e.actor_email ?? "—"}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-muted">
                      {e.target_type ? `${e.target_type}:${e.target_id ?? "—"}` : "—"}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-muted-light">{e.ip_address ?? "—"}</td>
                    <td className="px-2.5 py-1.5 text-muted">
                      <code className="break-all font-mono text-[10px]">{JSON.stringify(e.metadata ?? null)}</code>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-2.5 py-6 text-center text-xs text-muted-light">
                    {t("admin.audit.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

function SeverityCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "info" | "warning" | "critical";
}) {
  const toneClasses: Record<"info" | "warning" | "critical", string> = {
    info: "border-border bg-surface-subtle text-muted",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    critical: "border-rose-200 bg-rose-50 text-rose-700",
  };
  return (
    <div className={`rounded-xl border ${toneClasses[tone]} p-3`}>
      <div className="text-[11px] font-medium uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular">{value}</div>
    </div>
  );
}
