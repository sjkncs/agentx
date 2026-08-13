"use client";

import { useT } from "../../../../i18n/locale-context";
import type { LiveRun, SessionUsageStats } from "../../live-run-state";
import {
  IconAlert,
  IconMonitor,
  IconUsage,
} from "./console-icons-system";

/**
 * QoderWork-style task monitor rail: aggregates run health, resource usage, and a
 * "needs action" queue (human gates) for the current session.
 */
export function MonitorPanel({
  liveRun,
  sessionUsage,
}: {
  liveRun: LiveRun;
  sessionUsage: SessionUsageStats;
}) {
  const t = useT();
  const needsAction = liveRun.runStatus === "suspended";

  return (
    <section data-testid="monitor-panel" className="grid gap-3">
      <header className="flex items-center gap-2 text-muted">
        <IconMonitor size={14} />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em]">
          {t("monitor.title")}
        </h3>
      </header>

      {/* Health */}
      <div className="rounded-lg border border-border bg-surface-subtle p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">{t("monitor.health")}</span>
          <span
            className={[
              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
              liveRun.runStatus === "failed"
                ? "bg-rose-100 text-rose-600"
                : liveRun.runStatus === "completed"
                  ? "bg-step-success/15 text-step-success"
                  : "bg-primary-light/20 text-primary",
            ].join(" ")}
          >
            {t(`monitor.status.${liveRun.runStatus}`)}
          </span>
        </div>
        {liveRun.errorMessage ? (
          <p className="mt-1 line-clamp-2 text-[11px] text-rose-600">{liveRun.errorMessage}</p>
        ) : null}
      </div>

      {/* Usage */}
      <div className="rounded-lg border border-border bg-surface-subtle p-2.5">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted">
          <IconUsage size={13} />
          {t("monitor.usage")}
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
          <div className="flex justify-between">
            <dt className="text-muted-light">{t("monitor.runs")}</dt>
            <dd className="tabular text-foreground">{sessionUsage.runCount}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-light">{t("monitor.tokens")}</dt>
            <dd className="tabular text-foreground">
              {sessionUsage.tokens.inputTokens + sessionUsage.tokens.outputTokens}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-light">{t("monitor.tools")}</dt>
            <dd className="tabular text-foreground">{sessionUsage.toolCalls.total}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-light">{t("monitor.sql")}</dt>
            <dd className="tabular text-foreground">{sessionUsage.sql.total}</dd>
          </div>
        </dl>
      </div>

      {/* Needs action */}
      <div className="rounded-lg border border-border bg-surface-subtle p-2.5">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted">
          <IconAlert size={13} />
          {t("monitor.needsAction")}
        </div>
        {needsAction ? (
          <p className="text-[11px] font-medium text-amber-600">
            {t("monitor.waitingHuman")}
          </p>
        ) : (
          <p className="text-[11px] text-muted-light">{t("monitor.noAction")}</p>
        )}
      </div>
    </section>
  );
}
