import { describe, expect, it } from "vitest";

import { computeRunStats, formatMs, formatTokens } from "../run-stats";
import { createInitialLiveRun } from "../live-run-state";

describe("formatMs", () => {
  it("formats sub-second, seconds, and minutes", () => {
    expect(formatMs(0)).toBe("0s");
    expect(formatMs(320)).toBe("320ms");
    expect(formatMs(9700)).toBe("9.7s");
    expect(formatMs(316000)).toBe("5m16s");
  });
});

describe("formatTokens", () => {
  it("formats raw, K, and M", () => {
    expect(formatTokens(820)).toBe("820");
    expect(formatTokens(519000)).toBe("519K");
    expect(formatTokens(1200000)).toBe("1.2M");
  });
});

describe("computeRunStats", () => {
  it("aggregates rounds, steps, tool/llm time, and tokens", () => {
    const run = {
      ...createInitialLiveRun(),
      runStatus: "completed" as const,
      runStartedAt: 0,
      runFinishedAt: 100_000,
      runHistory: [{ startedAt: 0, finishedAt: 50_000, status: "completed" as const, toolCallEndIndex: 1, auditEndIndex: 0 }],
      toolCalls: [
        { id: "a", name: "run_sql_readonly", status: "success" as const, startedAtMs: 10_000, finishedAtMs: 30_000 },
      ],
      tokenUsage: { inputTokens: 519_000, outputTokens: 22_700 },
    };
    const s = computeRunStats(run, 100_000);
    expect(s.rounds).toBe(1); // one archived completed segment
    expect(s.steps).toBe(1);
    expect(s.toolMs).toBe(20_000);
    expect(s.llmMs).toBe(80_000);
    expect(s.inputTokens).toBe(519_000);
    expect(s.outputTokens).toBe(22_700);
  });

  it("returns zeros for an empty run", () => {
    const s = computeRunStats(createInitialLiveRun());
    expect(s.rounds).toBe(0);
    expect(s.steps).toBe(0);
    expect(s.totalMs).toBe(0);
    expect(s.inputTokens).toBe(0);
  });
});
