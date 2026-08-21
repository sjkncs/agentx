"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "../../i18n/locale-context";
import { configApi, ConfigApiError } from "../../lib/config-api/client";

import type { AdminEvalSnapshot } from "../../lib/config-api/types";

export type InlineAdminEvalSnapshot = Omit<AdminEvalSnapshot, never> & {
  automated_runs: number;
  human_required_runs: number;
  failed_runs: number;
  automation_rate: number;
  human_approval_rate: number;
  failure_rate: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  avg_latency_ms: number;
  avg_quality_score: number;
  window_hours: number;
  computed_at: number;
};

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function AdminEvalPanel() {
  const t = useT();
  const [data, setData] = useState<AdminEvalSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const snapshot = await (configApi as Record<string, unknown>).getAdminEval?.() as EvalSnapshot | undefined;
      if (snapshot) setData(snapshot);
    } catch (err) {
      setError(err instanceof ConfigApiError ? err.message : err instanceof Error ? err.message : "Failed to load evals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">{t("admin.eval.title")}</h2>
          <p className="mt-1 text-sm text-muted">{t("admin.eval.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-subtle disabled:opacity-50"
        >
          {t("admin.audit.refresh")}
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div>
      ) : null}

      {loading && !data ? (
        <p className="text-sm text-muted">{t("admin.audit.loading")}</p>
      ) : null}

      {data ? (
        <>
          {/* KPI Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label={t("admin.eval.automationRate")}
              value={fmtPct(data.automation_rate)}
              tone={data.automation_rate >= 0.7 ? "success" : data.automation_rate >= 0.5 ? "warning" : "danger"}
              description="automated / total runs (24h)"
            />
            <KpiCard
              label={t("admin.eval.p50Latency")}
              value={fmtMs(data.p50_latency_ms)}
              tone={data.p50_latency_ms < 1000 ? "success" : data.p50_latency_ms < 3000 ? "warning" : "danger"}
              description="P50 end-to-end latency"
            />
            <KpiCard
              label={t("admin.eval.p95Latency")}
              value={fmtMs(data.p95_latency_ms)}
              tone={data.p95_latency_ms < 2500 ? "success" : "warning"}
              description="P95 end-to-end latency"
            />
            <KpiCard
              label={t("admin.eval.qualityScore")}
              value={`${(data.avg_quality_score * 100).toFixed(0)}%`}
              tone={data.avg_quality_score >= 0.8 ? "success" : data.avg_quality_score >= 0.6 ? "warning" : "danger"}
              description="average quality score"
            />
          </div>

          {/* Run breakdown */}
          <div className="grid gap-4 sm:grid-cols-3">
            <BreakdownCard
              label={t("admin.eval.automated")}
              count={data.automated_runs}
              total={data.total_runs}
              tone="success"
            />
            <BreakdownCard
              label={t("admin.eval.humanRequired")}
              count={data.human_required_runs}
              total={data.total_runs}
              tone="warning"
            />
            <BreakdownCard
              label={t("admin.eval.failed")}
              count={data.failed_runs}
              total={data.total_runs}
              tone="danger"
            />
          </div>

          {/* Latency detail table */}
          <section className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
            <h3 className="mb-3 text-sm font-semibold text-foreground">{t("admin.eval.latencyDetail")}</h3>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted">
                  <th className="py-2 font-medium">Metric</th>
                  <th className="py-2 font-medium">Value</th>
                  <th className="py-2 font-medium">Target</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                <LatencyRow label="P50 latency" value={data.p50_latency_ms} target={1000} unit="ms" />
                <LatencyRow label="P95 latency" value={data.p95_latency_ms} target={2500} unit="ms" />
                <LatencyRow label="P99 latency" value={data.p99_latency_ms} target={5000} unit="ms" />
                <LatencyRow label="Avg latency" value={data.avg_latency_ms} target={2000} unit="ms" />
                <LatencyRow label="Failure rate" value={data.failure_rate * 100} target={5} unit="%" />
                <LatencyRow label="Human approval rate" value={data.human_approval_rate * 100} target={30} unit="%" />
              </tbody>
            </table>
          </section>

          {/* Updated timestamp */}
          <p className="text-xs text-muted-light">
            Last updated: {new Date(data.computed_at).toLocaleString()} · 24h rolling window · {data.total_runs} total runs
          </p>
        </>
      ) : null}
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
  description,
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "danger";
  description: string;
}) {
  const toneClasses = {
    success: "border-emerald-200 bg-emerald-50",
    warning: "border-amber-200 bg-amber-50",
    danger: "border-rose-200 bg-rose-50",
  };
  const textClasses = {
    success: "text-emerald-700",
    warning: "text-amber-700",
    danger: "text-rose-700",
  };
  return (
    <div className={`rounded-xl border p-4 ${toneClasses[tone]}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide opacity-70">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums ${textClasses[tone]}`}>{value}</p>
      <p className="mt-1 text-[11px] text-muted">{description}</p>
    </div>
  );
}

function BreakdownCard({
  label,
  count,
  total,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  tone: "success" | "warning" | "danger";
}) {
  const toneClasses = {
    success: "border-emerald-200 text-emerald-700",
    warning: "border-amber-200 text-amber-700",
    danger: "border-rose-200 text-rose-700",
  };
  const barClass = {
    success: "bg-emerald-500",
    warning: "bg-amber-500",
    danger: "bg-rose-500",
  };
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClasses[tone].split(" ")[1]}`}>
        {count}
      </p>
      <div className="mt-2 h-1.5 w-full rounded-full bg-border">
        <div className={`h-1.5 rounded-full ${barClass[tone]}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted">{pct.toFixed(1)}% of {total} runs</p>
    </div>
  );
}

function LatencyRow({
  label,
  value,
  target,
  unit,
}: {
  label: string;
  value: number;
  target: number;
  unit: string;
}) {
  const ok = value <= target;
  const warn = value <= target * 1.2;
  const tone = ok ? "text-emerald-700" : warn ? "text-amber-700" : "text-rose-700";
  return (
    <tr className="border-b border-border/60">
      <td className="py-2 text-muted">{label}</td>
      <td className={`py-2 font-semibold tabular-nums ${tone}`}>{value.toFixed(0)}{unit}</td>
      <td className="py-2 text-muted-light">&le;{target}{unit}</td>
      <td className="py-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ok ? "bg-emerald-100 text-emerald-700" : warn ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>
          {ok ? "OK" : warn ? "WARN" : "FAIL"}
        </span>
      </td>
    </tr>
  );
}
