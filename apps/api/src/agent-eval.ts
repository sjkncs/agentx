/**
 * Agent Evaluation Framework — measures automation rate and latency KPIs.
 *
 * Based on the "Observability & Evals" layer in the reference architecture.
 *
 * Tracks per-run:
 *   - automation_result: "automated" | "human_required" | "failed" | "timeout"
 *   - latency_ms: end-to-end run duration
 *   - quality_score: 0-1 derived from completion policy status
 *   - p50/p95/p99 latency buckets
 *   - hourly automation rate
 *
 * Wires into the existing metrics.ts system so data flows to:
 *   - GET /metrics  (Prometheus)
 *   - GET /api/v1/admin/metrics/active  (Admin dashboard)
 *   - D5: Supabase dfd_runs for historical analysis
 */
import { observeHistogram, type WiredMetrics } from "./metrics.js";

export type AutomationResult = "automated" | "human_required" | "failed" | "timeout";

export interface EvalRecord {
  run_id: string;
  session_id: string;
  user_id: string;
  protocol_id: string;
  started_at: number;
  ended_at: number;
  duration_ms: number;
  automation_result: AutomationResult;
  quality_score: number;
  human_approval_count: number;
  total_phase_count: number;
  phases_completed: number;
  error_code?: string;
}

export interface EvalSnapshot {
  total_runs: number;
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
}

// ---------------------------------------------------------------------------
// Rolling in-memory store (swap to Supabase dfd_runs in Phase D5)
// ---------------------------------------------------------------------------

const _records: EvalRecord[] = [];
const MAX_RECORDS = 10_000;
const WINDOW_MS = 24 * 60 * 60 * 1000; // 24-hour rolling window

// ---------------------------------------------------------------------------
// Record a completed run
// ---------------------------------------------------------------------------

export function recordEval(params: {
  run_id: string;
  session_id: string;
  user_id: string;
  protocol_id: string;
  started_at: number;
  ended_at: number;
  completionStatus: "completed" | "degraded" | "continue" | "failed";
  human_approval_count: number;
  total_phase_count: number;
  phases_completed: number;
  error_code?: string;
  metrics: WiredMetrics;
}): EvalRecord {
  const duration_ms = params.ended_at - params.started_at;
  const automation_result: AutomationResult =
    params.error_code === "TIMEOUT"
      ? "timeout"
      : params.completionStatus === "failed"
        ? "failed"
        : params.human_approval_count > 0
          ? "human_required"
          : "automated";

  const quality_score =
    params.completionStatus === "completed"
      ? 1.0
      : params.completionStatus === "degraded"
        ? 0.75
        : params.completionStatus === "continue"
          ? 0.5
          : 0.0;

  const record: EvalRecord = {
    run_id: params.run_id,
    session_id: params.session_id,
    user_id: params.user_id,
    protocol_id: params.protocol_id,
    started_at: params.started_at,
    ended_at: params.ended_at,
    duration_ms,
    automation_result,
    quality_score,
    human_approval_count: params.human_approval_count,
    total_phase_count: params.total_phase_count,
    phases_completed: params.phases_completed,
    ...(params.error_code !== undefined ? { error_code: params.error_code } : {}),
  };

  _records.push(record);
  if (_records.length > MAX_RECORDS) {
    _records.splice(0, _records.length - MAX_RECORDS);
  }

  // Emit to metrics system
  observeHistogram(
    "df_eval_run_duration_ms",
    "End-to-end agent run duration",
    duration_ms,
    { protocol: params.protocol_id, result: automation_result },
  );

  const completionStatusForMetrics: "completed" | "cancelled" | "error" =
    params.completionStatus === "failed"
      ? "error"
      : params.completionStatus === "completed"
        ? "completed"
        : "cancelled";
  params.metrics.incAgentRun(completionStatusForMetrics);

  return record;
}

// ---------------------------------------------------------------------------
// Compute rolling snapshot
// ---------------------------------------------------------------------------

export function evalSnapshot(): EvalSnapshot {
  const cutoff = Date.now() - WINDOW_MS;
  const window = _records.filter((r) => r.ended_at >= cutoff);

  if (window.length === 0) {
    return {
      total_runs: 0,
      automated_runs: 0,
      human_required_runs: 0,
      failed_runs: 0,
      automation_rate: 0,
      human_approval_rate: 0,
      failure_rate: 0,
      p50_latency_ms: 0,
      p95_latency_ms: 0,
      p99_latency_ms: 0,
      avg_latency_ms: 0,
      avg_quality_score: 0,
      window_hours: 24,
      computed_at: Date.now(),
    };
  }

  const sorted = [...window].sort((a, b) => a.duration_ms - b.duration_ms);
  const pIdx = (p: number) => sorted[Math.floor(sorted.length * p)]?.duration_ms ?? 0;

  const total = window.length;
  const automated = window.filter((r) => r.automation_result === "automated").length;
  const human_required = window.filter((r) => r.automation_result === "human_required").length;
  const failed = window.filter(
    (r) => r.automation_result === "failed" || r.automation_result === "timeout",
  ).length;

  return {
    total_runs: total,
    automated_runs: automated,
    human_required_runs: human_required,
    failed_runs: failed,
    automation_rate: automated / total,
    human_approval_rate: human_required / total,
    failure_rate: failed / total,
    p50_latency_ms: pIdx(0.50),
    p95_latency_ms: pIdx(0.95),
    p99_latency_ms: pIdx(0.99),
    avg_latency_ms: window.reduce((s, r) => s + r.duration_ms, 0) / total,
    avg_quality_score: window.reduce((s, r) => s + r.quality_score, 0) / total,
    window_hours: 24,
    computed_at: Date.now(),
  };
}

/** Prometheus-format metrics for /metrics endpoint. */
export function promEvalMetrics(): string {
  const snap = evalSnapshot();
  const lines: string[] = [
    `# HELP df_automation_rate Automation rate (automated runs / total) in rolling 24h window`,
    `# TYPE df_automation_rate gauge`,
    `df_automation_rate ${snap.automation_rate.toFixed(4)}`,
    `# HELP df_human_approval_rate Human approval required rate in rolling 24h window`,
    `# TYPE df_human_approval_rate gauge`,
    `df_human_approval_rate ${snap.human_approval_rate.toFixed(4)}`,
    `# HELP df_failure_rate Run failure/timeout rate in rolling 24h window`,
    `# TYPE df_failure_rate gauge`,
    `df_failure_rate ${snap.failure_rate.toFixed(4)}`,
    `# HELP df_eval_p50_latency_ms P50 end-to-end run latency`,
    `# TYPE df_eval_p50_latency_ms gauge`,
    `df_eval_p50_latency_ms ${snap.p50_latency_ms}`,
    `# HELP df_eval_p95_latency_ms P95 end-to-end run latency`,
    `# TYPE df_eval_p95_latency_ms gauge`,
    `df_eval_p95_latency_ms ${snap.p95_latency_ms}`,
    `# HELP df_eval_p99_latency_ms P99 end-to-end run latency`,
    `# TYPE df_eval_p99_latency_ms gauge`,
    `df_eval_p99_latency_ms ${snap.p99_latency_ms}`,
    `# HELP df_eval_avg_quality_score Average quality score (0–1)`,
    `# TYPE df_eval_avg_quality_score gauge`,
    `df_eval_avg_quality_score ${snap.avg_quality_score.toFixed(4)}`,
    `# HELP df_eval_total_runs Total completed runs in 24h window`,
    `# TYPE df_eval_total_runs counter`,
    `df_eval_total_runs ${snap.total_runs}`,
  ];
  return lines.join("\n") + "\n";
}
