"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "../../i18n/locale-context";
import { configApi, ConfigApiError } from "../../lib/config-api/client";
import type { AdminAlertsSnapshot } from "../../lib/config-api/types";

const SEVERITY_BADGE: Record<string, string> = {
  warning: "border border-amber-200 bg-amber-50 text-amber-800",
  critical: "border border-rose-200 bg-rose-50 text-rose-700",
};

export function AdminAlertsPanel() {
  const t = useT();
  const [data, setData] = useState<AdminAlertsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const snapshot = await configApi.getAdminAlerts();
      setData(snapshot);
    } catch (err) {
      setError(
        err instanceof ConfigApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load alerts.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, 15_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">{t("admin.alerts.title")}</h2>
          <p className="mt-1 text-sm text-muted">{t("admin.alerts.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRules((v) => !v)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-subtle"
          >
            {t("admin.alerts.showRules")}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-subtle disabled:opacity-50"
          >
            {t("admin.audit.refresh")}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <p className="text-sm text-muted">{t("admin.audit.loading")}</p>
      ) : null}

      {data ? (
        <>
          <div className="flex flex-wrap gap-3">
            <StatChip label={t("admin.alerts.total")} value={data.activeCount} />
            <StatChip
              label={t("admin.alerts.critical")}
              value={data.criticalCount}
              tone={data.criticalCount > 0 ? "critical" : "neutral"}
            />
            <StatChip
              label={t("admin.alerts.warning")}
              value={data.warningCount}
              tone={data.warningCount > 0 ? "warning" : "neutral"}
            />
            <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-muted">
              {t("admin.alerts.lastUpdate")}: {new Date(data.timestamp).toLocaleTimeString()}
            </span>
          </div>

          {data.alerts.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface p-8 text-center shadow-[var(--shadow-card)]">
              <p className="text-sm font-semibold text-foreground">{t("admin.alerts.allClear")}</p>
              <p className="mt-1 text-xs text-muted">{t("admin.alerts.allClearDesc")}</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {data.alerts.map((alert) => (
                <li
                  key={alert.id}
                  className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SEVERITY_BADGE[alert.severity] ?? ""}`}
                    >
                      {alert.severity}
                    </span>
                    <h3 className="text-sm font-semibold text-foreground">{alert.name}</h3>
                  </div>
                  <p className="mt-2 text-sm text-muted">{alert.description}</p>
                  <p className="mt-2 text-xs text-muted-light">
                    {t("admin.alerts.firedAt")}: {new Date(alert.firedAt).toLocaleString()} · value=
                    {alert.value.toFixed(3)} / threshold={alert.threshold}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {showRules ? (
            <section className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
              <h3 className="mb-3 text-sm font-semibold text-foreground">{t("admin.alerts.allRules")}</h3>
              <ul className="space-y-2">
                {data.rules.map((rule) => (
                  <li key={rule.id} className="flex items-start gap-2 text-sm">
                    <span
                      className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${SEVERITY_BADGE[rule.severity] ?? ""}`}
                    >
                      {rule.severity}
                    </span>
                    <div>
                      <p className="font-medium text-foreground">{rule.name}</p>
                      <p className="text-xs text-muted">{rule.description}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function StatChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "warning" | "critical";
}) {
  const toneClass =
    tone === "critical"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-border bg-surface text-foreground";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass}`}>
      {label}: {value}
    </span>
  );
}
