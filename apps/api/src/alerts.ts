/**
 * Alerting system for DataFoundry commercial monitoring.
 *
 * Alert rules evaluate on every metrics snapshot.
 * Active alerts are stored in-memory (production should use Redis/DB).
 * Alerts can be exported as JSON or Prometheus alertmanager format.
 */

import { getMetricsSnapshot } from "./metrics.js";

// ─────────────────────────────────────────────────────────────────────────────
// Alert types
// ─────────────────────────────────────────────────────────────────────────────

export type AlertSeverity = "warning" | "critical";

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  severity: AlertSeverity;
  /** Evaluates the current metrics snapshot and returns an alert if triggered. */
  evaluate(snapshot: ReturnType<typeof getMetricsSnapshot>): Alert | null;
}

export interface Alert {
  id: string;
  ruleId: string;
  name: string;
  description: string;
  severity: AlertSeverity;
  firedAt: string;
  value: number;
  threshold: number;
  labels: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Alert rules
// ─────────────────────────────────────────────────────────────────────────────

function findCounter(
  snapshot: ReturnType<typeof getMetricsSnapshot>,
  name: string,
  labels?: Record<string, string>,
): number {
  let total = 0;
  for (const m of snapshot) {
    if (m.type !== "counter" || m.name !== name) continue;
    if (labels) {
      const ok = Object.entries(labels).every(([k, v]) => m.labels[k] === v);
      if (!ok) continue;
    }
    total += m.value;
  }
  return total;
}

function findHistogram(snapshot: ReturnType<typeof getMetricsSnapshot>, name: string) {
  for (const m of snapshot) {
    if (m.type === "histogram" && m.name === name) return m;
  }
  return null;
}

function findGauge(snapshot: ReturnType<typeof getMetricsSnapshot>, name: string): number {
  for (const m of snapshot) {
    if (m.type === "gauge" && m.name === name) return m.value;
  }
  return 0;
}

const ALERT_RULES: AlertRule[] = [
  // ── Cell run failures ────────────────────────────────────────────────────
  {
    id: "cell_failure_rate",
    name: "Cell Failure Rate > 20%",
    description: "More than 20% of notebook cell runs failed in the recent window",
    severity: "warning",
    evaluate(snapshot) {
      const total = findCounter(snapshot, "df_nb_cell_runs_total");
      const failed = findCounter(snapshot, "df_nb_cell_runs_total", { status: "failed" });
      const ratio = total > 0 ? failed / total : 0;
      if (ratio > 0.2 && total > 10) {
        return {
          id: `alert_${this.id}_${Date.now()}`,
          ruleId: this.id,
          name: this.name,
          description: `${(ratio * 100).toFixed(1)}% failure rate (${failed}/${total} runs failed)`,
          severity: this.severity,
          firedAt: new Date().toISOString(),
          value: ratio,
          threshold: 0.2,
          labels: { metric: "df_nb_cell_runs_total" },
        };
      }
      return null;
    },
  },
  // ── Sandbox blocks ───────────────────────────────────────────────────────
  {
    id: "sandbox_block_rate",
    name: "Sandbox Block Rate > 10%",
    description: "More than 10% of sandbox executions were blocked",
    severity: "warning",
    evaluate(snapshot) {
      const blocked = findCounter(snapshot, "df_sandbox_blocks_total");
      const totalRuns =
        findCounter(snapshot, "df_nb_cell_runs_total", { status: "completed" }) +
        findCounter(snapshot, "df_nb_cell_runs_total", { status: "failed" }) +
        findCounter(snapshot, "df_nb_cell_runs_total", { status: "timeout" });
      const ratio = totalRuns > 0 ? blocked / totalRuns : 0;
      if (ratio > 0.1 && totalRuns > 5) {
        return {
          id: `alert_${this.id}_${Date.now()}`,
          ruleId: this.id,
          name: this.name,
          description: `${blocked} sandbox blocks detected, ${(ratio * 100).toFixed(1)}% block rate`,
          severity: this.severity,
          firedAt: new Date().toISOString(),
          value: ratio,
          threshold: 0.1,
          labels: { metric: "df_sandbox_blocks_total" },
        };
      }
      return null;
    },
  },
  // ── Cell timeout rate ────────────────────────────────────────────────────
  {
    id: "cell_timeout_rate",
    name: "Cell Timeout Rate > 5%",
    description: "More than 5% of cell executions timed out",
    severity: "warning",
    evaluate(snapshot) {
      const total = findCounter(snapshot, "df_nb_cell_runs_total");
      const timeout = findCounter(snapshot, "df_nb_cell_runs_total", { status: "timeout" });
      const ratio = total > 0 ? timeout / total : 0;
      if (ratio > 0.05 && total > 20) {
        return {
          id: `alert_${this.id}_${Date.now()}`,
          ruleId: this.id,
          name: this.name,
          description: `${(ratio * 100).toFixed(1)}% timeout rate (${timeout}/${total} runs timed out)`,
          severity: this.severity,
          firedAt: new Date().toISOString(),
          value: ratio,
          threshold: 0.05,
          labels: { metric: "df_nb_cell_runs_total" },
        };
      }
      return null;
    },
  },
  // ── P95 cell duration ───────────────────────────────────────────────────
  {
    id: "cell_p95_duration",
    name: "Cell P95 Duration > 30s",
    description: "95th percentile cell execution time exceeds 30 seconds",
    severity: "warning",
    evaluate(snapshot) {
      const hist = findHistogram(snapshot, "df_nb_cell_duration_ms");
      if (!hist || hist.count < 10) return null;
      let acc = 0;
      for (const b of hist.buckets) {
        acc += b.count;
        if (acc >= Math.ceil(0.95 * hist.count)) {
          if (b.le < Infinity && b.le > 30_000) {
            return {
              id: `alert_${this.id}_${Date.now()}`,
              ruleId: this.id,
              name: this.name,
              description: `P95 cell duration is ${(b.le / 1000).toFixed(1)}s (threshold: 30s)`,
              severity: this.severity,
              firedAt: new Date().toISOString(),
              value: b.le,
              threshold: 30_000,
              labels: { metric: "df_nb_cell_duration_ms" },
            };
          }
          break;
        }
      }
      return null;
    },
  },
  // ── Concurrent agents high ───────────────────────────────────────────────
  {
    id: "concurrent_agents",
    name: "Concurrent Agents > 20",
    description: "More than 20 agent sessions running simultaneously",
    severity: "critical",
    evaluate(snapshot) {
      const n = findGauge(snapshot, "df_concurrent_agents");
      if (n > 20) {
        return {
          id: `alert_${this.id}_${Date.now()}`,
          ruleId: this.id,
          name: this.name,
          description: `${n} agent sessions running concurrently (threshold: 20)`,
          severity: this.severity,
          firedAt: new Date().toISOString(),
          value: n,
          threshold: 20,
          labels: { metric: "df_concurrent_agents" },
        };
      }
      return null;
    },
  },
  // ── Agent error rate ────────────────────────────────────────────────────
  {
    id: "agent_error_rate",
    name: "Agent Error Rate > 10%",
    description: "More than 10% of agent runs ended in error",
    severity: "critical",
    evaluate(snapshot) {
      const total = findCounter(snapshot, "df_agent_runs_total");
      const errors = findCounter(snapshot, "df_agent_runs_total", { status: "error" });
      const ratio = total > 0 ? errors / total : 0;
      if (ratio > 0.1 && total > 5) {
        return {
          id: `alert_${this.id}_${Date.now()}`,
          ruleId: this.id,
          name: this.name,
          description: `${(ratio * 100).toFixed(1)}% error rate (${errors}/${total} runs failed)`,
          severity: this.severity,
          firedAt: new Date().toISOString(),
          value: ratio,
          threshold: 0.1,
          labels: { metric: "df_agent_runs_total" },
        };
      }
      return null;
    },
  },
  // ── Active sandboxes ─────────────────────────────────────────────────────
  {
    id: "active_sandboxes",
    name: "Active Sandboxes > 50",
    description: "More than 50 sandbox processes running simultaneously",
    severity: "warning",
    evaluate(snapshot) {
      const n = findGauge(snapshot, "df_active_sandboxes");
      if (n > 50) {
        return {
          id: `alert_${this.id}_${Date.now()}`,
          ruleId: this.id,
          name: this.name,
          description: `${n} active sandboxes (threshold: 50)`,
          severity: this.severity,
          firedAt: new Date().toISOString(),
          value: n,
          threshold: 50,
          labels: { metric: "df_active_sandboxes" },
        };
      }
      return null;
    },
  },
  // ── Queue depth ─────────────────────────────────────────────────────────
  {
    id: "queue_depth",
    name: "Run Queue Depth > 100",
    description: "More than 100 agent runs queued",
    severity: "critical",
    evaluate(snapshot) {
      const n = findGauge(snapshot, "df_run_queue_depth");
      if (n > 100) {
        return {
          id: `alert_${this.id}_${Date.now()}`,
          ruleId: this.id,
          name: this.name,
          description: `${n} runs queued (threshold: 100)`,
          severity: this.severity,
          firedAt: new Date().toISOString(),
          value: n,
          threshold: 100,
          labels: { metric: "df_run_queue_depth" },
        };
      }
      return null;
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Alert store
// ─────────────────────────────────────────────────────────────────────────────

const FIRING = new Map<string, Alert>();

export function evaluateAlerts(): Alert[] {
  const snapshot = getMetricsSnapshot();
  const fired: Alert[] = [];
  for (const rule of ALERT_RULES) {
    const alert = rule.evaluate(snapshot);
    if (alert) {
      FIRING.set(rule.id, alert);
      fired.push(alert);
    } else {
      FIRING.delete(rule.id);
    }
  }
  return fired;
}

export function getActiveAlerts(): Alert[] {
  return Array.from(FIRING.values());
}

export function getAlertRules(): AlertRule[] {
  return [...ALERT_RULES];
}

// ─────────────────────────────────────────────────────────────────────────────
// Prometheus Alertmanager format
// ─────────────────────────────────────────────────────────────────────────────

export interface PrometheusAlert {
  name: string;
  state: "firing" | "resolved";
  severity: string;
  summary: string;
  description: string;
  startsAt: string;
  labels: Record<string, string>;
}

export function prometheusAlerts(): PrometheusAlert[] {
  const active = getActiveAlerts();
  if (active.length === 0) {
    return [{
      name: "DataFoundryHealth",
      state: "resolved",
      severity: "info",
      summary: "All DataFoundry alerts resolved",
      description: "No active alerts.",
      startsAt: new Date().toISOString(),
      labels: { service: "datafoundry" },
    }];
  }
  return active.map((a) => ({
    name: a.name,
    state: "firing" as const,
    severity: a.severity,
    summary: a.description,
    description: `${a.name}: ${a.description}`,
    startsAt: a.firedAt,
    labels: { ...a.labels, rule_id: a.ruleId },
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON dashboard payload
// ─────────────────────────────────────────────────────────────────────────────

export interface AlertsSnapshot {
  timestamp: string;
  activeCount: number;
  criticalCount: number;
  warningCount: number;
  alerts: Alert[];
  rules: Array<{ id: string; name: string; description: string; severity: AlertSeverity }>;
}

export function alertsSnapshot(): AlertsSnapshot {
  const active = getActiveAlerts();
  return {
    timestamp: new Date().toISOString(),
    activeCount: active.length,
    criticalCount: active.filter((a) => a.severity === "critical").length,
    warningCount: active.filter((a) => a.severity === "warning").length,
    alerts: active,
    rules: ALERT_RULES.map((r) => ({ id: r.id, name: r.name, description: r.description, severity: r.severity })),
  };
}
