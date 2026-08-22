/**
 * Subagent Quarantine Helper
 *
 * 实现 per-subagent 隔离 + 主动 cleanup：
 *   - 任何 subagent 失败只影响它自己
 *   - cleanup() 只清理 quarantine 状态，不会级联停止其他
 *   - onSubagentBindFailure() 标记某个 subagent bind 失败，让主代理知道是单点问题
 *
 * 实现目的：解决"注册 tel 机器人后所有机器人失能"的级联问题。
 *
 * 用法（与 harness-core SubagentManager 一起）：
 *   const helper = createSubagentQuarantineHelper(manager);
 *   helper.onSubagentBindFailure(subagentId, error);
 *   // ... 单点失败，others 继续工作
 *   helper.retrySubagent(subagentId);  // 用户手动重试
 *   helper.skipSubagent(subagentId);   // 彻底跳过
 */

export interface QuarantineRecord {
  subagentId: string;
  reason: string;
  failedAt: number;
  retryCount: number;
  nextRetryAt: number;
  status: "quarantined" | "recovered" | "skipped";
}

export interface SubagentQuarantineHelperOptions {
  /** 初始重试间隔（ms） */
  initialRetryDelayMs?: number;
  /** 最大重试间隔（ms） */
  maxRetryDelayMs?: number;
  /** 最大重试次数；超过后转为 skipped */
  maxRetries?: number;
  /** 每次进入 quarantine / 状态变化时触发 */
  onChange?: (record: QuarantineRecord) => void;
  /** 检测到 cascade 风险时（多个 subagent 同时失败）触发 */
  onCascadeRisk?: (failedIds: string[]) => void;
}

export const QUARANTINE_EVENT = "subagent:quarantine";
export const CASCADE_RISK_THRESHOLD = 3; // 3+ 同时失败 → 触发 cascade alert

export interface SubagentQuarantineHelper {
  /** 标记一个 subagent bind 失败，进入隔离态 */
  onSubagentBindFailure(subagentId: string, reason: string): void;
  /** 用户手动 retry 单个 subagent */
  retrySubagent(subagentId: string): void;
  /** 用户跳过单个 subagent（彻底禁用） */
  skipSubagent(subagentId: string): void;
  /** 列出当前 quarantine 状态 */
  listQuarantined(): QuarantineRecord[];
  /** 列出当前 active 状态（已恢复 / 正常） */
  listActive(): string[];
  /** 清理：仅清理已 skipped 的条目，**不影响其他** */
  cleanup(): { removed: number; remaining: number };
  /** 模拟一次"cascade attempt"：批量 fail — interceptor 会判断风险 */
  simulateCascade(subagentIds: string[], reason: string): { cascadeTriggered: boolean; quarantined: string[] };
}

export function createSubagentQuarantineHelper(
  options: SubagentQuarantineHelperOptions = {},
): SubagentQuarantineHelper {
  const {
    initialRetryDelayMs = 1_000,
    maxRetryDelayMs = 30_000,
    maxRetries = 5,
    onChange,
    onCascadeRisk,
  } = options;

  const records = new Map<string, QuarantineRecord>();

  const update = (record: QuarantineRecord) => {
    records.set(record.subagentId, record);
    onChange?.(record);
  };

  const getOrCreate = (id: string): QuarantineRecord => {
    const existing = records.get(id);
    if (existing) return existing;
    const fresh: QuarantineRecord = {
      subagentId: id,
      reason: "",
      failedAt: 0,
      retryCount: 0,
      nextRetryAt: 0,
      status: "quarantined",
    };
    records.set(id, fresh);
    return fresh;
  };

  const onSubagentBindFailure = (subagentId: string, reason: string) => {
    const rec = getOrCreate(subagentId);
    rec.reason = reason;
    rec.failedAt = Date.now();
    rec.retryCount += 1;
    // Exponential backoff
    const delay = Math.min(
      maxRetryDelayMs,
      initialRetryDelayMs * Math.pow(2, Math.max(0, rec.retryCount - 1)),
    );
    rec.nextRetryAt = rec.failedAt + delay;
    rec.status = rec.retryCount > maxRetries ? "skipped" : "quarantined";
    update({ ...rec });

    // Cascade detection — only counts currently quarantined records.
    const activeFails = Array.from(records.values()).filter(
      (r) => r.status === "quarantined" && Date.now() - r.failedAt < 60_000,
    );
    if (activeFails.length >= CASCADE_RISK_THRESHOLD) {
      onCascadeRisk?.(activeFails.map((r) => r.subagentId));
    }
  };

  const retrySubagent = (subagentId: string) => {
    const rec = records.get(subagentId);
    if (!rec) return;
    // Mark recovered — leaves the quarantine list, surfaces in the active list.
    rec.status = "recovered";
    onChange?.({ ...rec });
  };

  const skipSubagent = (subagentId: string) => {
    const rec = getOrCreate(subagentId);
    rec.status = "skipped";
    update({ ...rec });
  };

  function deleteRecord(id: string) {
    records.delete(id);
  }

  // listQuarantined returns every record that still requires a decision
  // (still quarantined OR skipped but pending cleanup). Recovered records
  // have moved to `listActive` and are no longer in the quarantine set.
  const listQuarantined = () =>
    Array.from(records.values()).filter((r) => r.status !== "recovered");
  const listActive = () =>
    Array.from(records.values())
      .filter((r) => r.status === "recovered")
      .map((r) => r.subagentId);

  const cleanup = () => {
    const before = records.size;
    for (const [id, rec] of records.entries()) {
      if (rec.status === "skipped") records.delete(id);
    }
    return { removed: before - records.size, remaining: records.size };
  };

  const simulateCascade = (subagentIds: string[], reason: string) => {
    // 关键改进：单点失败，不会触发"全部 stop"
    const quarantined: string[] = [];
    for (const id of subagentIds) {
      onSubagentBindFailure(id, reason);
      quarantined.push(id);
    }
    const cascadeTriggered = quarantined.length >= CASCADE_RISK_THRESHOLD;
    return { cascadeTriggered, quarantined };
  };

  return {
    onSubagentBindFailure,
    retrySubagent,
    skipSubagent,
    listQuarantined,
    listActive,
    cleanup,
    simulateCascade,
  };
}

// ============================================================================
// Unit-test friendly factory
// ============================================================================

export function createMockQuarantineRecord(overrides: Partial<QuarantineRecord> = {}): QuarantineRecord {
  return {
    subagentId: overrides.subagentId ?? "mock-subagent",
    reason: overrides.reason ?? "bind failed",
    failedAt: overrides.failedAt ?? Date.now(),
    retryCount: overrides.retryCount ?? 1,
    nextRetryAt: overrides.nextRetryAt ?? Date.now() + 1_000,
    status: overrides.status ?? "quarantined",
  };
}
