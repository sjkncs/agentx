/**
 * In-memory Prometheus-style metrics for DataFoundry commercial monitoring.
 *
 * Provides: Counter, Gauge, Histogram, Summary
 * Wire into: server.ts lifecycle hooks, executor, sandbox, agent-runtime events.
 *
 * Exposes GET /metrics  — Prometheus scrape format
 *            GET /api/v1/admin/metrics/active  — JSON dashboard payload
 */

import type { IncomingMessage, ServerResponse } from "node:http";

// ─────────────────────────────────────────────────────────────────────────────
// Metric types
// ─────────────────────────────────────────────────────────────────────────────

export type MetricLabel = Record<string, string>;

export interface Counter {
  type: "counter";
  name: string;
  description: string;
  value: number;
  labels: MetricLabel;
}

export interface Gauge {
  type: "gauge";
  name: string;
  description: string;
  value: number;
  labels: MetricLabel;
}

export interface HistogramBucket {
  le: number;
  count: number;
}

export interface Histogram {
  type: "histogram";
  name: string;
  description: string;
  count: number;
  sum: number;
  buckets: HistogramBucket[];
  labels: MetricLabel;
}

export interface Metric {
  counter: Counter;
  gauge: Gauge;
  histogram: Histogram;
}

// ─────────────────────────────────────────────────────────────────────────────
// Metric registry
// ─────────────────────────────────────────────────────────────────────────────

const METRICS = new Map<string, Counter | Gauge | Histogram>();

const DEFAULT_HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function labelKey(labels: MetricLabel): string {
  return Object.keys(labels).sort().map((k) => `${k}="${labels[k]} "`).join("");
}

function getOrCreateCounter(name: string, description: string, labels: MetricLabel): Counter {
  const key = `${name}{${labelKey(labels)}}`;
  const existing = METRICS.get(key);
  if (existing && existing.type === "counter") return existing;
  const metric: Counter = { type: "counter", name, description, value: 0, labels };
  METRICS.set(key, metric);
  return metric;
}

function getOrCreateGauge(name: string, description: string, labels: MetricLabel): Gauge {
  const key = `${name}{${labelKey(labels)}}`;
  const existing = METRICS.get(key);
  if (existing && existing.type === "gauge") return existing;
  const metric: Gauge = { type: "gauge", name, description, value: 0, labels };
  METRICS.set(key, metric);
  return metric;
}

function getOrCreateHistogram(name: string, description: string, labels: MetricLabel): Histogram {
  const key = `${name}{${labelKey(labels)}}`;
  const existing = METRICS.get(key);
  if (existing && existing.type === "histogram") return existing;
  const metric: Histogram = {
    type: "histogram", name, description,
    count: 0, sum: 0,
    buckets: DEFAULT_HISTOGRAM_BUCKETS.map((le) => ({ le, count: 0 })),
    labels,
  };
  METRICS.set(key, metric);
  return metric;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function incCounter(name: string, description: string, labels: MetricLabel = {}, by = 1): void {
  const m = getOrCreateCounter(name, description, labels);
  m.value += by;
}

export function setGauge(name: string, description: string, value: number, labels: MetricLabel = {}): void {
  const m = getOrCreateGauge(name, description, labels);
  m.value = value;
}

export function observeHistogram(name: string, description: string, value: number, labels: MetricLabel = {}): void {
  const m = getOrCreateHistogram(name, description, labels);
  m.count++;
  m.sum += value;
  for (const bucket of m.buckets) {
    if (value <= bucket.le) bucket.count++;
  }
  // Always update +Inf bucket
  const infBucket = m.buckets.find((b) => b.le === Infinity);
  if (infBucket) infBucket.count = m.count;
}

export function getMetricsSnapshot(): Array<Counter | Gauge | Histogram> {
  return Array.from(METRICS.values());
}

export function resetMetrics(): void {
  METRICS.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Prometheus exposition format
// ─────────────────────────────────────────────────────────────────────────────

function promFormat(m: Counter | Gauge | Histogram): string {
  const help = `# HELP ${m.name} ${m.description}`;
  const type = `# TYPE ${m.name} ${m.type}`;
  const labelStr = Object.keys(m.labels).length > 0
    ? `{${Object.entries(m.labels).map(([k, v]) => `${k}="${v}"`).join(",")}}`
    : "";
  switch (m.type) {
    case "counter":
    case "gauge":
      return `${help}\n${type}\n${m.name}${labelStr} ${m.value}\n`;
    case "histogram": {
      const lines = [`${help}`, `${type}`];
      for (const b of m.buckets) {
        lines.push(`${m.name}_bucket{le="${b.le}"} ${b.count}`);
      }
      lines.push(`${m.name}_sum${labelStr} ${m.sum}`);
      lines.push(`${m.name}_count${labelStr} ${m.count}`);
      return lines.join("\n") + "\n";
    }
  }
}

export function promMetrics(): string {
  const snapshot = getMetricsSnapshot();
  if (snapshot.length === 0) return "# No metrics collected yet\n";
  return snapshot.map(promFormat).join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON dashboard payload
// ─────────────────────────────────────────────────────────────────────────────

export interface MetricsSnapshot {
  timestamp: string;
  uptime_s: number;
  counters: Array<{ name: string; value: number; labels: MetricLabel }>;
  gauges: Array<{ name: string; value: number; labels: MetricLabel }>;
  histograms: Array<{
    name: string; count: number; sum: number;
    avg: number; p50: number; p95: number; p99: number;
    labels: MetricLabel;
  }>;
}

function quantile(hist: Histogram, q: number): number {
  if (hist.count === 0) return 0;
  const target = Math.ceil(q * hist.count);
  let acc = 0;
  for (const b of hist.buckets) {
    acc += b.count;
    if (acc >= target) return b.le;
  }
  return hist.sum / hist.count;
}

export function metricsSnapshot(): MetricsSnapshot {
  const snapshot = getMetricsSnapshot();
  const counters: MetricsSnapshot["counters"] = [];
  const gauges: MetricsSnapshot["gauges"] = [];
  const histograms: MetricsSnapshot["histograms"] = [];
  for (const m of snapshot) {
    if (m.type === "counter") counters.push({ name: m.name, value: m.value, labels: m.labels });
    if (m.type === "gauge") gauges.push({ name: m.name, value: m.value, labels: m.labels });
    if (m.type === "histogram") {
      histograms.push({
        name: m.name, count: m.count, sum: m.sum,
        avg: m.count > 0 ? m.sum / m.count : 0,
        p50: quantile(m, 0.5),
        p95: quantile(m, 0.95),
        p99: quantile(m, 0.99),
        labels: m.labels,
      });
    }
  }
  return {
    timestamp: new Date().toISOString(),
    uptime_s: Math.floor((Date.now() - START_MS) / 1000),
    counters, gauges, histograms,
  };
}

const START_MS = Date.now();

// ─────────────────────────────────────────────────────────────────────────────
// Pre-defined metrics (call wireMetrics() to activate)
// ─────────────────────────────────────────────────────────────────────────────

export interface WiredMetrics {
  incCellRun: (status: "completed" | "failed" | "timeout", cellKind: string) => void;
  observeCellDuration: (ms: number, cellKind: string) => void;
  incSandboxBlock: (reason: string) => void;
  observeSandboxDuration: (ms: number, status: string) => void;
  incSqlQuery: (datasourceType: string) => void;
  observeSqlDuration: (ms: number, datasourceType: string) => void;
  incAgentRun: (status: "completed" | "cancelled" | "error") => void;
  observeAgentDuration: (ms: number) => void;
  setConcurrentAgents: (n: number) => void;
  setActiveSandboxes: (n: number) => void;
  setQueueDepth: (n: number) => void;
}

export function wireMetrics(): WiredMetrics {
  return {
    incCellRun: (status, cellKind) => {
      incCounter("df_nb_cell_runs_total", "Total notebook cell runs", { status, cell_kind: cellKind });
    },
    observeCellDuration: (ms, cellKind) => {
      observeHistogram("df_nb_cell_duration_ms", "Notebook cell duration (ms)", ms, { cell_kind: cellKind });
    },
    incSandboxBlock: (reason) => {
      incCounter("df_sandbox_blocks_total", "Total sandbox blocks", { reason });
    },
    observeSandboxDuration: (ms, status) => {
      observeHistogram("df_sandbox_duration_ms", "Sandbox execution duration (ms)", ms, { status });
    },
    incSqlQuery: (datasourceType) => {
      incCounter("df_sql_queries_total", "Total SQL queries executed", { datasource_type: datasourceType });
    },
    observeSqlDuration: (ms, datasourceType) => {
      observeHistogram("df_sql_duration_ms", "SQL query duration (ms)", ms, { datasource_type: datasourceType });
    },
    incAgentRun: (status) => {
      incCounter("df_agent_runs_total", "Total agent runs", { status });
    },
    observeAgentDuration: (ms) => {
      observeHistogram("df_agent_duration_ms", "Agent run duration (ms)", ms, {});
    },
    setConcurrentAgents: (n) => {
      setGauge("df_concurrent_agents", "Currently active agent sessions", n, {});
    },
    setActiveSandboxes: (n) => {
      setGauge("df_active_sandboxes", "Currently running sandboxes", n, {});
    },
    setQueueDepth: (n) => {
      setGauge("df_run_queue_depth", "Pending run queue depth", n, {});
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP handler
// ─────────────────────────────────────────────────────────────────────────────

export function handleMetricsRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.url === "/metrics") {
    res.writeHead(200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(promMetrics());
  } else if (req.url?.startsWith("/api/v1/admin/metrics/active")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(metricsSnapshot(), null, 2));
  } else {
    res.writeHead(404);
    res.end();
  }
}
