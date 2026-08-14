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
