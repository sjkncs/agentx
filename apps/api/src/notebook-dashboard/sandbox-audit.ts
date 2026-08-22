/**
 * Sandbox audit trail — persists sandbox run records to the nbd_cell_runs table.
 *
 * The audit log is the authoritative record of every sandbox execution:
 *   - who ran what, when, for how long
 *   - whether the blocklist caught any imports
 *   - whether the execution was blocked, timed out, or completed
 *
 * This service is instantiated once at server startup and passed to the
 * sandbox via CellExecuteContext.sandbox.onAudit.
 *
 * The nbd_cell_runs table already exists (created by schema.ts); we extend
 * it with sandbox-specific fields via a JSON column so we don't need a migration.
 */
import type { NotebookDashboardRepository } from "./repository.js";
import type { SandboxAuditRecord } from "./sandbox-python.js";

export class SandboxAuditService {
  constructor(private readonly repo: NotebookDashboardRepository) {}

  /**
   * Called by the sandbox runner after each execution.
   * Persists the sandbox audit record alongside the existing cell-run record.
   */
  onAudit(record: SandboxAuditRecord): void {
    try {
      // Persist to nbd_cell_runs — the cellId maps to the existing run record.
      // The sandbox-specific fields are stored as a JSON comment on the run.
      // If the run doesn't exist yet (shouldn't happen), we log and skip.
      const existingRun = this.repo.findCellRunById(record.sandboxId);
      if (existingRun) {
      this.repo.updateCellRunSandboxInfo(record.sandboxId, {
        sandboxId: record.sandboxId,
        sandboxStatus: record.status,
        sandboxDurationMs: record.durationMs ?? 0,
        blockedImports: record.blockedImports ?? [],
        blockReason: record.blockReason,
        sandboxError: record.errorMessage,
        sandboxStartedAt: record.startedAt,
        sandboxFinishedAt: record.finishedAt,
      });
      }
      // Also emit to the server's structured log for correlation with the
      // general audit trail (logs/Splunk/Datadog/etc.)
      this.logStructured(record);
    } catch (err) {
      // Never let audit failures affect cell execution
      console.error("[sandbox-audit] Failed to persist audit record:", err);
    }
  }

  private logStructured(record: SandboxAuditRecord): void {
    const level = record.status === "blocked" || record.status === "failed" ? "warn" : "info";
    const log = {
      ts: new Date().toISOString(),
      service: "sandbox-audit",
      sandboxId: record.sandboxId,
      workspaceId: record.workspaceId,
      userId: record.userId,
      cellId: record.cellId,
      status: record.status,
      durationMs: record.durationMs,
      blocked: record.blockedImports?.length ?? 0,
      blockedModules: record.blockedImports ?? [],
      blockReason: record.blockReason,
      error: record.errorMessage,
    };
    if (level === "warn") {
      console.warn(JSON.stringify(log));
    } else {
      console.info(JSON.stringify(log));
    }
  }
}

/**
 * Security event types for the general audit log.
 * Used by the audit-service to emit structured security events.
 */
export type SandboxSecurityEventType =
  | "sandbox_blocked_import"
  | "sandbox_execution_timeout"
  | "sandbox_execution_error"
  | "sandbox_execution_complete";

export interface SandboxSecurityEvent {
  type: SandboxSecurityEventType;
  workspaceId: string;
  userId: string;
  cellId: string;
  sandboxId: string;
  blockedImports?: string[];
  blockReason?: string;
  durationMs?: number;
  error?: string;
}

export function buildSecurityEvent(record: SandboxAuditRecord): SandboxSecurityEvent {
  switch (record.status) {
    case "blocked":
      return {
        type: "sandbox_blocked_import",
        workspaceId: record.workspaceId,
        userId: record.userId,
        cellId: record.cellId,
        sandboxId: record.sandboxId,
        ...(record.blockedImports !== undefined ? { blockedImports: record.blockedImports } : {}),
        ...(record.blockReason !== undefined ? { blockReason: record.blockReason } : {}),
      };
    case "timeout":
      return {
        type: "sandbox_execution_timeout",
        workspaceId: record.workspaceId,
        userId: record.userId,
        cellId: record.cellId,
        sandboxId: record.sandboxId,
        ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
      };
    case "failed":
      return {
        type: "sandbox_execution_error",
        workspaceId: record.workspaceId,
        userId: record.userId,
        cellId: record.cellId,
        sandboxId: record.sandboxId,
        ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
        ...(record.errorMessage !== undefined ? { error: record.errorMessage } : {}),
      };
    case "completed":
      return {
        type: "sandbox_execution_complete",
        workspaceId: record.workspaceId,
        userId: record.userId,
        cellId: record.cellId,
        sandboxId: record.sandboxId,
        ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
      };
    default:
      return {
        type: "sandbox_execution_complete",
        workspaceId: record.workspaceId,
        userId: record.userId,
        cellId: record.cellId,
        sandboxId: record.sandboxId,
        ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
      };
  }
}
