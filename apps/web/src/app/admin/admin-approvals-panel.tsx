"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "../../i18n/locale-context";
import { configApi, ConfigApiError } from "../../lib/config-api/client";
import type {
  AdminApprovalRecord,
  AdminApprovalSnapshot,
  AdminApprovalStats
} from "../../lib/config-api/types";

const STATUS_BADGE: Record<string, string> = {
  pending: "border border-amber-200 bg-amber-50 text-amber-800",
  approved: "border border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border border-rose-200 bg-rose-50 text-rose-700",
  revised: "border border-blue-200 bg-blue-50 text-blue-700"
};

const TOOL_BADGE: Record<string, string> = {
  submit_plan: "bg-violet-100 text-violet-800",
  ask_user: "bg-sky-100 text-sky-800"
};

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export function AdminApprovalsPanel() {
  const t = useT();
  const [approvals, setApprovals] = useState<AdminApprovalRecord[]>([]);
  const [stats, setStats] = useState<AdminApprovalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [resolving, setResolving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const snapshot: AdminApprovalSnapshot = await configApi.getAdminApprovals();
      setApprovals(snapshot.approvals);
      setStats(snapshot.stats);
    } catch (err) {
      setError(
        err instanceof ConfigApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load approvals."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const handleResolve = async (id: string, option: string) => {
    setResolving(id);
    setError(null);
    try {
      await configApi.resolveApproval({ id, selected_option: option });
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve.");
    } finally {
      setResolving(null);
    }
  };

  const visible = filter === "all" ? approvals : approvals.filter((a) => a.status === "pending");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">{t("admin.approvals.title")}</h2>
          <p className="mt-1 text-sm text-muted">{t("admin.approvals.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFilter((f) => (f === "pending" ? "all" : "pending"))}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-subtle"
          >
            {filter === "pending" ? "Show all" : "Show pending only"}
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

      {loading && !approvals.length ? (
        <p className="text-sm text-muted">{t("admin.audit.loading")}</p>
      ) : null}

      {stats ? (
        <div className="flex flex-wrap gap-3">
          <StatChip
            label={t("admin.approvals.pending")}
            value={stats.pending}
            tone={stats.pending > 0 ? "warning" : "neutral"}
          />
          <StatChip
            label={t("admin.approvals.approvedToday")}
            value={stats.approved_today}
            tone="success"
          />
          <StatChip
            label={t("admin.approvals.rejectedToday")}
            value={stats.rejected_today}
            tone="neutral"
          />
          <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-muted">
            {t("admin.approvals.avgResolution")}: {stats.avg_resolution_time_ms > 0 ? formatDuration(stats.avg_resolution_time_ms) : "—"}
          </span>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center shadow-[var(--shadow-card)]">
          <p className="text-sm font-semibold text-foreground">
            {filter === "pending" ? t("admin.approvals.noPending") : t("admin.approvals.empty")}
          </p>
          <p className="mt-1 text-xs text-muted">
            {filter === "pending"
              ? t("admin.approvals.noPendingDesc")
              : t("admin.approvals.emptyDesc")}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((approval) => (
            <li
              key={approval.id}
              className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[approval.status]}`}>
                  {approval.status}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TOOL_BADGE[approval.tool_name]}`}>
                  {approval.tool_name}
                </span>
                <span className="text-xs text-muted">{approval.user_email}</span>
                <span className="ml-auto text-xs text-muted-light">
                  {new Date(approval.created_at).toLocaleString()}
                </span>
              </div>

              <p className="mt-2 text-sm text-foreground">{approval.prompt}</p>

              {approval.options.length > 0 && approval.status === "pending" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {approval.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => void handleResolve(approval.id, option)}
                      disabled={resolving !== null}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        option === "approved"
                          ? "bg-emerald-600 text-white hover:bg-emerald-500"
                          : option === "rejected"
                            ? "bg-rose-600 text-white hover:bg-rose-500"
                            : "border border-border bg-surface text-foreground hover:bg-surface-subtle"
                      } disabled:opacity-50`}
                    >
                      {resolving === approval.id ? "…" : option}
                    </button>
                  ))}
                </div>
              ) : approval.status !== "pending" ? (
                <p className="mt-2 text-xs text-muted">
                  {approval.resolved_by
                    ? `Resolved by ${approval.resolved_by}`
                    : ""}{" "}
                  {approval.resolved_at !== null
                    ? `· ${new Date(approval.resolved_at).toLocaleString()}`
                    : ""}
                  {approval.selected_option ? ` · selected: ${approval.selected_option}` : ""}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
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
  tone?: "neutral" | "warning" | "success";
}) {
  const toneClass =
    tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-border bg-surface text-foreground";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass}`}>
      {label}: {value}
    </span>
  );
}
