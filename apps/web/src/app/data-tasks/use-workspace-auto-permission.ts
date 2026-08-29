"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Workspace Auto-Permission Hook
 *
 * 解决痛点：在 workspace 内创建了工作文件夹，但 agent 默认不会把东西放进去，
 * 每次都要求显式授权。给全局权限也容易逃逸到 workspace 之外。
 *
 * 设计原则：
 *   1. **scope-aware**：权限严格限制在 workspace 路径前缀下
 *   2. **confirm-aware**：高危操作（删除、外部命令）仍走显式 confirm
 *   3. **撤销友好**：用户随时可一键关闭，不需要重启会话
 *   4. **多端持久**：localStorage，跨刷新保留
 *
 * 用法：
 *   const { auto, scope, setAuto, setScope, isPathAllowed, explainDecision } = useWorkspaceAutoPermission();
 *   if (isPathAllowed(targetPath)) { ...}
 */

const STORAGE_KEY = "agentx-workspace-auto-permission";

/** 用户允许 agent 在此目录下"自由编辑" */
export interface AutoPermissionState {
  /** 是否启用自动授权 */
  enabled: boolean;
  /** 允许的目录前缀（不区分大小写） */
  scope: string;
  /** 用户增加的额外禁止路径（即使在 scope 内也要 confirm） */
  denied: string[];
  /** 风险等级：低 = 仅写文件；中 = 写文件 + shell；高 = 全部 */
  level: "low" | "medium" | "high";
}

export const DEFAULT_AUTO_PERMISSION_STATE: AutoPermissionState = {
  enabled: false,
  scope: "",
  denied: [],
  level: "low",
};

const HIGH_RISK_PATTERNS = [
  /(^|\\|\/)\.\./, // path traversal
  /(^|\\|\/)(node_modules|\.git|\.env)/, // sensitive
  /\.(exe|bat|sh|cmd|ps1)$/i, // executables — high-risk for write, allowed for shell at medium+
];

export function readStoredPermissionState(): AutoPermissionState {
  if (typeof window === "undefined") return DEFAULT_AUTO_PERMISSION_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AUTO_PERMISSION_STATE;
    const parsed = JSON.parse(raw) as Partial<AutoPermissionState>;
    return {
      enabled: Boolean(parsed.enabled),
      scope: typeof parsed.scope === "string" ? parsed.scope : "",
      denied: Array.isArray(parsed.denied) ? parsed.denied.filter((d) => typeof d === "string") : [],
      level: parsed.level === "medium" || parsed.level === "high" ? parsed.level : "low",
    };
  } catch {
    return DEFAULT_AUTO_PERMISSION_STATE;
  }
}

export function persistPermissionState(state: AutoPermissionState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function normalizePath(p: string): string {
  return p.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
}

export function isPathInScope(target: string, scope: string, denied: string[] = []): boolean {
  if (!scope) return false;
  const t = normalizePath(target);
  const s = normalizePath(scope);
  if (!t.startsWith(s)) return false;
  if (denied.some((d) => normalizePath(d) === t)) return false;
  return true;
}

export function isHighRiskPath(path: string): boolean {
  return HIGH_RISK_PATTERNS.some((p) => p.test(path));
}

export type DecisionKind = "write" | "shell" | "delete" | "external";

export interface DecisionResult {
  allowed: boolean;
  reason: string;
}

export function explainPermissionDecision(
  state: AutoPermissionState,
  op: { kind: DecisionKind; path?: string },
): DecisionResult {
  if (!state.enabled) {
    return { allowed: false, reason: "auto-permission disabled" };
  }
  if (op.path && !isPathInScope(op.path, state.scope, state.denied)) {
    return { allowed: false, reason: "path outside workspace scope" };
  }
  // High-risk path check is per-operation:
  //   - write: still blocked (don't let the agent overwrite .sh files)
  //   - shell: bypassed at medium/high level (executing a .sh in scope is fine)
  //   - delete/external: still blocked
  const shouldApplyHighRisk =
    op.kind === "write" || op.kind === "delete" || op.kind === "external";
  if (shouldApplyHighRisk && op.path && isHighRiskPath(op.path)) {
    return { allowed: false, reason: "high-risk path pattern" };
  }
  switch (op.kind) {
    case "write":
      return { allowed: true, reason: "write within scope" };
    case "shell":
      if (state.level === "high" || state.level === "medium") {
        return { allowed: true, reason: `shell allowed (${state.level})` };
      }
      return { allowed: false, reason: "shell requires high level" };
    case "delete":
      return { allowed: false, reason: "delete always requires explicit confirm" };
    case "external":
      return { allowed: state.level === "high", reason: "external requires high level" };
  }
}

/**
 * Pure helper for testing / CLI callers — produces an elevated state object
 * without persisting. Mirrors `autoElevate` semantics from the hook.
 */
export function autoElevateForTesting(
  scope: string,
  targetLevel: AutoPermissionState["level"] = "medium",
): AutoPermissionState {
  return {
    ...DEFAULT_AUTO_PERMISSION_STATE,
    enabled: true,
    scope: scope.trim(),
    level: targetLevel,
  };
}

export function useWorkspaceAutoPermission() {
  const [state, setState] = useState<AutoPermissionState>(DEFAULT_AUTO_PERMISSION_STATE);

  useEffect(() => {
    setState(readStoredPermissionState());
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    setState((prev) => {
      const next = { ...prev, enabled };
      persistPermissionState(next);
      return next;
    });
  }, []);

  const setScope = useCallback((scope: string) => {
    setState((prev) => {
      const next = { ...prev, scope: scope.trim() };
      persistPermissionState(next);
      return next;
    });
  }, []);

  const setLevel = useCallback((level: AutoPermissionState["level"]) => {
    setState((prev) => {
      const next = { ...prev, level };
      persistPermissionState(next);
      return next;
    });
  }, []);

  const addDenied = useCallback((path: string) => {
    setState((prev) => {
      const next = { ...prev, denied: [...prev.denied, path] };
      persistPermissionState(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setState(DEFAULT_AUTO_PERMISSION_STATE);
    persistPermissionState(DEFAULT_AUTO_PERMISSION_STATE);
  }, []);

  /**
   * One-click "let me work in this workspace":
   *   enables auto-permission, scopes to `scope`, and elevates level
   *   to `targetLevel` (default: medium — write + shell).
   *
   * Returns the resulting state so the caller can show a confirmation toast.
   */
  const autoElevate = useCallback(
    (scope: string, targetLevel: AutoPermissionState["level"] = "medium"): AutoPermissionState => {
      const next: AutoPermissionState = {
        ...DEFAULT_AUTO_PERMISSION_STATE,
        enabled: true,
        scope: scope.trim(),
        level: targetLevel,
      };
      setState(next);
      persistPermissionState(next);
      return next;
    },
    [],
  );

  const isPathAllowed = useCallback(
    (target: string): boolean => {
      if (!state.enabled) return false;
      return isPathInScope(target, state.scope, state.denied);
    },
    [state.enabled, state.scope, state.denied],
  );

  const explainDecision = useCallback(
    (op: { kind: DecisionKind; path?: string }): DecisionResult =>
      explainPermissionDecision(state, op),
    [state],
  );

  return {
    state,
    setEnabled,
    setScope,
    setLevel,
    addDenied,
    reset,
    autoElevate,
    isPathAllowed,
    explainDecision,
  };
}
