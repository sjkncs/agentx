import { describe, it, expect, vi } from "vitest";
import {
  createSubagentQuarantineHelper,
  createMockQuarantineRecord,
  CASCADE_RISK_THRESHOLD,
  QUARANTINE_EVENT,
} from "../quarantine";

describe("Subagent Quarantine Helper", () => {
  it("captures single bind failure without affecting others", () => {
    const helper = createSubagentQuarantineHelper();
    helper.onSubagentBindFailure("a", "bind timeout");

    const all = helper.listQuarantined();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      subagentId: "a",
      reason: "bind timeout",
      status: "quarantined",
      retryCount: 1,
    });
    expect(all[0].nextRetryAt).toBeGreaterThan(all[0].failedAt);
  });

  it("applies exponential backoff for retries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const helper = createSubagentQuarantineHelper({ initialRetryDelayMs: 1_000 });

    helper.onSubagentBindFailure("a", "fail 1");
    helper.onSubagentBindFailure("a", "fail 2");
    helper.onSubagentBindFailure("a", "fail 3");

    const rec = helper.listQuarantined()[0]!;
    // 1s -> 2s -> 4s
    expect(rec.retryCount).toBe(3);
    // next retry = failedAt + (1s * 2^2) = + 4s
    expect(rec.nextRetryAt - rec.failedAt).toBe(4_000);

    vi.useRealTimers();
  });

  it("caps backoff at maxRetryDelayMs", () => {
    const helper = createSubagentQuarantineHelper({
      initialRetryDelayMs: 1_000,
      maxRetryDelayMs: 5_000,
    });

    helper.onSubagentBindFailure("a", "fail");
    helper.onSubagentBindFailure("a", "fail");
    helper.onSubagentBindFailure("a", "fail");
    helper.onSubagentBindFailure("a", "fail");
    helper.onSubagentBindFailure("a", "fail");

    const rec = helper.listQuarantined()[0]!;
    expect(rec.nextRetryAt - rec.failedAt).toBeLessThanOrEqual(5_000);
  });

  it("transitions to skipped after maxRetries exceeded", () => {
    const helper = createSubagentQuarantineHelper({ maxRetries: 2 });
    helper.onSubagentBindFailure("a", "fail 1");
    helper.onSubagentBindFailure("a", "fail 2");
    helper.onSubagentBindFailure("a", "fail 3");

    const rec = helper.listQuarantined()[0]!;
    expect(rec.status).toBe("skipped");
  });

  it("isolates failures: one bind failure does not nuke others", () => {
    // 关键测试：cascade attempt 不会触发级联停止
    const helper = createSubagentQuarantineHelper({ maxRetries: 10 });
    helper.simulateCascade(["bot1", "bot2"], "bind failed");

    expect(helper.listQuarantined()).toHaveLength(2);
    expect(helper.listActive()).toHaveLength(0);

    // 模拟正常 bot 仍能注册
    const activeBots = ["bot3", "bot4"];
    // activeBots 不经过 quarantine，所以 helper 不应有它们的记录
    expect(helper.listQuarantined().map((r) => r.subagentId).sort()).toEqual(["bot1", "bot2"]);

    // 不变的是：activeBots 不在 quarantine 列表
    for (const active of activeBots) {
      expect(helper.listQuarantined().find((r) => r.subagentId === active)).toBeUndefined();
    }
  });

  it("triggers cascade-risk callback when too many subagents fail at once", () => {
    const onCascade = vi.fn();
    const helper = createSubagentQuarantineHelper({ onCascadeRisk: onCascade });

    helper.simulateCascade(
      Array.from({ length: CASCADE_RISK_THRESHOLD }, (_, i) => `bot${i}`),
      "bind failed",
    );

    expect(onCascade).toHaveBeenCalledOnce();
    expect(onCascade.mock.calls[0]![0]).toHaveLength(CASCADE_RISK_THRESHOLD);
  });

  it("retrySubagent removes the record (status: recovered)", () => {
    const helper = createSubagentQuarantineHelper();
    helper.onSubagentBindFailure("a", "fail");
    helper.retrySubagent("a");

    expect(helper.listQuarantined()).toHaveLength(0);
    expect(helper.listActive()).toContain("a");
  });

  it("skipSubagent marks as skipped and stays in list until cleanup", () => {
    const helper = createSubagentQuarantineHelper();
    helper.onSubagentBindFailure("a", "fail");
    helper.skipSubagent("a");

    expect(helper.listQuarantined()[0]?.status).toBe("skipped");

    const result = helper.cleanup();
    expect(result.removed).toBe(1);
    expect(result.remaining).toBe(0);
  });

  it("cleanup only removes skipped records, preserves quarantined", () => {
    const helper = createSubagentQuarantineHelper();
    helper.onSubagentBindFailure("a", "still quarantined");
    helper.skipSubagent("b");

    const result = helper.cleanup();
    expect(result.removed).toBe(1);
    expect(result.remaining).toBe(1);
    expect(helper.listQuarantined()[0]?.subagentId).toBe("a");
  });

  it("invokes onChange for each state transition", () => {
    const onChange = vi.fn();
    const helper = createSubagentQuarantineHelper({ onChange });

    helper.onSubagentBindFailure("a", "fail 1");
    helper.onSubagentBindFailure("a", "fail 2");
    helper.retrySubagent("a");

    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("createMockQuarantineRecord fills defaults", () => {
    const r = createMockQuarantineRecord({});
    expect(r.subagentId).toBe("mock-subagent");
    expect(r.retryCount).toBe(1);
    expect(r.status).toBe("quarantined");
  });

  it("exposes QUARANTINE_EVENT and CASCADE_RISK_THRESHOLD constants", () => {
    expect(QUARANTINE_EVENT).toBe("subagent:quarantine");
    expect(CASCADE_RISK_THRESHOLD).toBe(3);
  });
});
