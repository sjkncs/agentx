import type { LiveRun } from "./live-run-state";

export interface RunStats {
  rounds: number;
  steps: number;
  totalMs: number;
  toolMs: number;
  llmMs: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Rough cost estimate per 1K tokens. This is intentionally a single average
 * number — the user can override per-model pricing in the model profile later.
 * Average of Qwen / GPT-4o / Claude blended rates as of 2026.
 */
const COST_PER_1K_INPUT = 0.002;
const COST_PER_1K_OUTPUT = 0.008;

/**
 * Average tokens per LLM-second, derived from a few production-style runs.
 * Used for ETA estimation only; intentionally conservative so we don't
 * promise a too-soon completion.
 */
const TOKENS_PER_LLM_SECOND = 220;

/** Aggregate DSH-style run statistics from a LiveRun. */
export function computeRunStats(liveRun: LiveRun, now: number = Date.now()): RunStats {
  const active = liveRun.runStatus === "running" || liveRun.runStatus === "suspended";
  const rounds = (liveRun.runHistory?.length ?? 0) + (active ? 1 : 0);
  const steps = liveRun.toolCalls.length;

  let toolMs = 0;
  for (const call of liveRun.toolCalls) {
    if (call.startedAtMs !== undefined && call.finishedAtMs !== undefined) {
      toolMs += Math.max(0, call.finishedAtMs - call.startedAtMs);
    }
  }

  const totalMs =
    liveRun.runStartedAt !== undefined
      ? Math.max(0, (liveRun.runFinishedAt ?? now) - liveRun.runStartedAt)
      : 0;
  const llmMs = Math.max(0, totalMs - toolMs);

  const tokens = liveRun.tokenUsage;
  return {
    rounds,
    steps,
    totalMs,
    toolMs,
    llmMs,
    inputTokens: tokens?.inputTokens ?? 0,
    outputTokens: tokens?.outputTokens ?? 0,
  };
}

/** Estimated USD cost for the run so far. */
export function estimateCostUsd(stats: RunStats): number {
  const inUsd = (stats.inputTokens / 1000) * COST_PER_1K_INPUT;
  const outUsd = (stats.outputTokens / 1000) * COST_PER_1K_OUTPUT;
  return inUsd + outUsd;
}

/**
 * Estimated remaining time in milliseconds. Returns null if the run has just
 * started (no signal yet) or if there is no observed LLM throughput.
 */
export function estimateEtaMs(liveRun: LiveRun, stats: RunStats, now: number = Date.now()): number | null {
  if (!liveRun.runStartedAt) return null;
  if (liveRun.runStatus !== "running") return null;
  if (stats.llmMs < 1500) return null;
  const observedTokensPerSec = (stats.inputTokens + stats.outputTokens) / (stats.llmMs / 1000);
  if (observedTokensPerSec < 1) return null;
  const elapsed = now - liveRun.runStartedAt;
  const tokensPerSec = stats.inputTokens + stats.outputTokens > 0 ? observedTokensPerSec : TOKENS_PER_LLM_SECOND;
  // Naive heuristic: assume remaining = 1.0 rounds worth of typical step output.
  // Real ETA would need a planner hint; this is "good enough" for a run-stats bar.
  const expectedTotalSec = elapsed / 1000 + Math.max(2, 30 / tokensPerSec);
  const remainingMs = Math.max(0, expectedTotalSec * 1000 - elapsed);
  return remainingMs;
}

/** Format milliseconds as "5m16s" / "9.7s" / "320ms". */
export function formatMs(ms: number): string {
  if (ms <= 0) return "0s";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s >= 10 ? Math.round(s) : s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  return `${m}m${rs}s`;
}

/** Format token counts as "519K" / "1.2M" / "820". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}
