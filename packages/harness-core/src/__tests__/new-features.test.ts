/**
 * Goal Mode + Worktree + Marketplace + Capability brief 单元测试
 */

import { describe, it, expect } from "vitest";

import {
  GoalRunner,
  createGoalRunner,
  type GoalIteration,
  WorktreeHelper,
  createWorktreeHelper,
  DEFAULT_HARNESS_CAPABILITIES,
  buildHarnessSystemPrompt,
} from "../index.js";

describe("Goal Mode", () => {
  it("runs iterations until verifier passes", async () => {
    let attempt = 0;
    const runner = createGoalRunner({
      goal: "produce 3 items",
      maxRounds: 5,
      iterationTimeoutMs: 1_000,
      runner: async (iter: GoalIteration) => {
        attempt++;
        return {
          output: `round-${iter.round}-items:${[1, 2, 3].length}`,
          summary: `produced ${attempt} attempt(s)`,
        };
      },
      verifier: {
        type: "predicate",
        fn: (out) => String(out.output).includes("items:3"),
      },
    });

    const result = await runner.run();
    expect(result.status).toBe("passed");
    expect(result.rounds).toBeGreaterThanOrEqual(1);
    expect(result.history.length).toBe(result.rounds);
  });

  it("exhausts when verifier never passes", async () => {
    const runner = createGoalRunner({
      goal: "impossible goal",
      maxRounds: 2,
      iterationTimeoutMs: 1_000,
      runner: async () => ({ output: "nope", summary: "try again" }),
      verifier: { type: "predicate", fn: () => false },
    });

    const result = await runner.run();
    expect(result.status).toBe("exhausted");
    expect(result.rounds).toBe(2);
  });

  it("supports regexp verifier", async () => {
    const runner = createGoalRunner({
      goal: "echo target phrase",
      maxRounds: 3,
      iterationTimeoutMs: 1_000,
      runner: async ({ round }) => ({
        output: round >= 2 ? "PASS_OK" : "still failing",
        summary: `round ${round}`,
      }),
      verifier: { type: "regExp", pattern: "PASS_OK" },
    });
    const result = await runner.run();
    expect(result.status).toBe("passed");
    expect(result.rounds).toBe(2);
  });

  it("emits events during run", async () => {
    const events: string[] = [];
    const runner = new GoalRunner({
      goal: "trace",
      maxRounds: 3,
      iterationTimeoutMs: 1_000,
      runner: async () => ({ output: "ok", summary: "done" }),
      verifier: { type: "predicate", fn: () => true },
    });
    runner.on("goal:start", () => events.push("start"));
    runner.on("goal:iteration:start", () => events.push("iter-start"));
    runner.on("goal:iteration:end", () => events.push("iter-end"));
    runner.on("goal:verify", () => events.push("verify"));
    runner.on("goal:end", () => events.push("end"));
    await runner.run();
    expect(events).toContain("start");
    expect(events).toContain("end");
    expect(events.filter((e) => e === "verify").length).toBeGreaterThan(0);
  });
});

describe("Worktree Helper", () => {
  it("exposes list(), diff(), log()", () => {
    expect(typeof WorktreeHelper.list).toBe("function");
    expect(typeof WorktreeHelper.diff).toBe("function");
    expect(typeof WorktreeHelper.log).toBe("function");
  });

  it("createWorktreeHelper returns the same API", () => {
    const helper = createWorktreeHelper();
    expect(helper).toBe(WorktreeHelper);
  });
});

describe("Capability Brief", () => {
  it("contains key feature names", () => {
    expect(DEFAULT_HARNESS_CAPABILITIES).toContain("Goal Mode");
    expect(DEFAULT_HARNESS_CAPABILITIES).toContain("Subagents");
    expect(DEFAULT_HARNESS_CAPABILITIES).toContain("Marketplace");
    expect(DEFAULT_HARNESS_CAPABILITIES).toContain("Worktree");
    expect(DEFAULT_HARNESS_CAPABILITIES).toContain("Sandbox");
  });

  it("buildHarnessSystemPrompt injects brief before base", () => {
    const out = buildHarnessSystemPrompt("you are a helper");
    expect(out.startsWith("# Harness Core Capabilities")).toBe(true);
    expect(out).toContain("you are a helper");
    expect(out).toContain("---");
  });

  it("buildHarnessSystemPrompt works without base", () => {
    const out = buildHarnessSystemPrompt();
    expect(out.startsWith("# Harness Core Capabilities")).toBe(true);
  });
});
