/**
 * Real cell execution engine for notebooks.
 *
 *   SQL → `LocalDataGateway.runSqlReadonly` (with the existing audit-log
 *         pipeline so every query is row-counted and attributable to the
 *         calling user).
 *   Python → sandboxed via sandbox-python.ts (Layered defence-in-depth):
 *         - stripped environment (no AWS_*, DATABASE_URL, etc.)
 *         - isolated Python interpreter (-I -S -P flags)
 *         - import blocklist (subprocess, socket, pickle, etc.)
 *         - disabled dangerous builtins (compile, exec, eval, open)
 *         - optional network isolation (stub exe / docker)
 *         - output capped at 1 MiB + hard timeout
 *         - process isolation via harness-core ProcessSandbox (CPU/memory/process limits)
 *   AI prompt → forwards the prompt to the workspace's default model
 *         provider (the same provider the chat runtime uses).
 *
 * Every execution returns a `CellExecuteResult` carrying the new outputs,
 * the cell run row, and a stable `errorMessage` whenever the engine had
 * to fall back. The HTTP layer never silently produces a fake output.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { LocalDataGateway } from "@datafoundry/data-gateway";
import { wireMetrics, type WiredMetrics } from "../metrics.js";
import {
  runSandboxedPython,
  detectNetworkIsolation,
  type NetworkIsolation,
  type SandboxOptions,
  type SandboxAuditRecord,
} from "./sandbox-python.js";
import {
  SandboxExecutorBridge,
  createSandboxExecutorBridge,
  type SandboxExecutorBridgeOptions,
} from "./sandbox-executor-bridge.js";
import {
  SqlInjectionGuard,
  createSqlGuard,
  diagnoseSqlError,
  type SqlGuardOptions,
} from "./sql-injection-guard.js";

import type {
  CellOutput,
  CellRunStatus,
  NotebookCell,
} from "./types.js";

export interface CellExecuteResult {
  cellId: string;
  status: CellRunStatus;
  outputs: CellOutput[];
  durationMs: number;
  auditLogId?: string | undefined;
  rowCount?: number | undefined;
  /** Populated whenever status === "failed". */
  errorMessage?: string | undefined;
  /** Semantic validation warnings surfaced after SQL execution. */
  warnings?: string[] | undefined;
}

export interface CellExecuteContext {
  workspaceId: string;
  userId: string;
  /** Selected datasource for SQL execution; falls back to the first registered. */
  datasourceId?: string | undefined;
  /** Live gateway handles — owned by the server bootstrap. */
  gateway: LocalDataGateway;
  /** Venv python binary; absence disables Python execution. */
  pythonBin?: string | undefined;
  /** Hard timeout for any cell execution. */
  timeoutMs?: number | undefined;
  /** Optional AI completion callback. */
  completePrompt?: ((prompt: string, model?: string | undefined) => Promise<string>) | undefined;
  /**
   * Optional SQL injection guard for SQL cells.
   * Validates queries against a table allowlist and dangerous-pattern blocklist
   * before passing them to the data gateway. Provides diagnostic messages for
   * common errors (table not found, column not found, type mismatch, etc.).
   */
  sqlGuard?: SqlInjectionGuard | ReturnType<typeof createSqlGuard>;
  /**
   * Semantic validation context from DataLink.
   * When provided, SQL cell results are validated against the semantic graph
   * and any mismatches are surfaced as warnings in CellExecuteResult.warnings.
   */
  semanticContext?: {
    /** Findings from semantic validation (column/type mismatches, etc.) */
    findings?: Array<{ code: string; message: string; severity: "error" | "warning" }>;
    /** ExploreResult from DataLink for column descriptions */
    exploreResult?: import("./datalink-bridge.js").ExploreResult;
  };
  /**
   * Sandbox configuration for Python cells.
   * When provided, Python cells run inside the multi-layer sandbox.
   * When omitted (undefined), falls back to the legacy runPythonOnce path (dev/CI only).
   */
  sandbox?: SandboxContext | undefined;
  /**
   * Metrics recorder. When provided, cell runs, SQL queries, and sandbox
   * events are recorded for the Prometheus / alert dashboard.
   */
  metrics?: WiredMetrics | null;
}

/**
 * Sandbox-specific configuration merged into the global sandbox options.
 */
export interface SandboxContext {
  /** Network isolation strategy. Default: { type: "none" } (blocked in production). */
  networkIsolation?: NetworkIsolation;
  /**
   * Called with audit records for each sandbox run.
   * The executor uses this to emit structured audit events for the nbd_cell_runs table.
   */
  onAudit?: (record: SandboxAuditRecord) => void;
  /**
   * Directory the sandbox may read (beyond stdlib). Null = read-only access to HOME only.
   * @default null
   */
  allowedReadDir?: string | null;
  /**
   * List of additional Python modules (beyond the default allowlist) to permit.
   * Use sparingly — each addition is a risk trade-off.
   * @default []
   */
  extraAllowedImports?: string[];
  /**
   * Optional harness-core sandbox bridge for OS-level resource enforcement.
   * When provided, Python cells additionally benefit from:
   *   - CPU time limits (via `limits.maxExecutionTimeMs`)
   *   - Memory limits (via `limits.maxMemoryMb`)
   *   - Single-process enforcement
   *   - File permission deny-list
   * If omitted, harness-core enforcement is skipped (sandbox-python.ts still provides
   * the Python-level defence layers).
   */
  harnessBridge?: SandboxExecutorBridge | ReturnType<typeof createSandboxExecutorBridge>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 1_048_576;

export class CellExecutionError extends Error {
  constructor(public status: CellRunStatus, message: string) {
    super(message);
  }
}

export async function executeCell(
  cell: NotebookCell,
  ctx: CellExecuteContext,
): Promise<CellExecuteResult> {
  const startedAt = Date.now();
  const timeoutMs = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  const metrics = ctx.metrics ?? wireMetrics();
  try {
    switch (cell.kind) {
      case "markdown":
        return {
          cellId: cell.id,
          status: "completed",
          outputs: [{ kind: "text", text: "Markdown cell — nothing to run." }],
          durationMs: Date.now() - startedAt,
        };
      case "sql":
        return await executeSqlCell(cell, ctx, abortController.signal, metrics);
      case "python":
        return await executePythonCell(cell, ctx, abortController.signal, metrics);
      case "ai-prompt":
        return await executeAiPromptCell(cell, ctx, abortController.signal, metrics);
      default: {
        const exhaustive: never = cell.kind;
        throw new Error(`unknown cell kind: ${exhaustive as string}`);
      }
    }
  } catch (err) {
    const message =
      err instanceof Error
        ? abortController.signal.aborted
          ? `Execution timed out after ${timeoutMs}ms`
          : err.message
        : String(err);
    const traceback = err instanceof Error ? err.stack : undefined;
    const errorOutput: CellOutput = traceback
      ? { kind: "error", message, traceback }
      : { kind: "error", message };
    const result: CellExecuteResult = {
      cellId: cell.id,
      status: "failed",
      outputs: [errorOutput],
      durationMs: Date.now() - startedAt,
      errorMessage: message,
    };
    metrics.incCellRun("failed", cell.kind);
    metrics.observeCellDuration(result.durationMs, cell.kind);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- SQL

async function executeSqlCell(
  cell: NotebookCell,
  ctx: CellExecuteContext,
  signal: AbortSignal,
  metrics: ReturnType<typeof wireMetrics>,
): Promise<CellExecuteResult> {
  let datasourceId = ctx.datasourceId;
  if (!datasourceId) {
    const sources = await ctx.gateway.listDataSources({
      user_id: ctx.userId,
      enabled_only: true,
    });
    datasourceId = sources[0]?.id;
  }
  if (!datasourceId) {
    metrics.incCellRun("failed", "sql");
    metrics.observeCellDuration(0, "sql");
    return {
      cellId: cell.id,
      status: "failed",
      outputs: [
        {
          kind: "error",
          message:
            "No datasource registered. Configure one in /data-tasks → Data sources before running SQL cells.",
        },
      ],
      durationMs: 0,
      errorMessage: "no datasource",
    };
  }

  // ── SQL injection guard (pre-execution check) ────────────────────────────
  if (ctx.sqlGuard) {
    const guardResult = ctx.sqlGuard.validate(cell.source);
    if (!guardResult.allowed) {
      const diag = diagnoseSqlError(guardResult.reason ?? guardResult.normalizedSql, {
        sql: cell.source,
        tables: guardResult.referencedTables,
        columns: guardResult.referencedColumns,
      });
      return {
        cellId: cell.id,
        status: "failed",
        outputs: [{
          kind: "error",
          message: `[SQL Guard] ${diag.message}`,
          traceback: diag.hint,
        }],
        durationMs: 0,
        errorMessage: diag.code,
      };
    }
  }

  // ── Execute with error diagnosis ─────────────────────────────────────────
  let result: Awaited<ReturnType<typeof ctx.gateway.runSqlReadonly>>;
  try {
    result = await ctx.gateway.runSqlReadonly({
      user_id: ctx.userId,
      workspace_id: ctx.workspaceId,
      datasource_id: datasourceId,
      sql: cell.source,
      signal,
    });
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const diag = diagnoseSqlError(rawMsg, {
      sql: cell.source,
      tables: ctx.sqlGuard
        ? ctx.sqlGuard.fingerprint(cell.source).table
          ? [ctx.sqlGuard.fingerprint(cell.source).table]
          : undefined
        : undefined,
    });
    metrics.incCellRun("failed", "sql");
    metrics.observeCellDuration(0, "sql");
    return {
      cellId: cell.id,
      status: "failed",
      outputs: [{
        kind: "error",
        message: `[SQL Error] ${diag.message}`,
        traceback: diag.hint,
      }],
      durationMs: 0,
      errorMessage: diag.code,
    };
  }

  // ── Post-execution semantic validation ───────────────────────────────────
  // If the notebook has semantic context from DataLink, run semantic validation
  // to surface any column/type mismatches in the results.
  const safeRows = coerceRows(result.rows);
  const datasourceType = datasourceId.split(":")[0] ?? "unknown";
  metrics.incSqlQuery(datasourceType);
  metrics.observeSqlDuration(result.elapsed_ms, datasourceType);
  const truncated = (result.row_count ?? safeRows.length) > safeRows.length;
  const output: CellOutput = {
    kind: "table",
    columns: result.columns,
    rows: safeRows,
    ...(truncated ? { truncated: true } : {}),
  };
  if (ctx.semanticContext) {
    const semanticFindings = ctx.semanticContext.findings ?? [];
    if (semanticFindings.length > 0) {
      // Attach validation findings as a supplemental output
      const findingsOutput: CellOutput = {
        kind: "error",
        message: `Semantic validation: ${semanticFindings.length} warning(s) found. Review your column mappings.`,
        traceback: semanticFindings
          .map((f) => `  • [${f.severity}] ${f.code}: ${f.message}`)
          .join("\n"),
      };
  return {
    cellId: cell.id,
    status: "completed",
    outputs: [output, findingsOutput],
    durationMs: result.elapsed_ms,
    auditLogId: result.audit_log_id,
    rowCount: result.row_count ?? safeRows.length,
    warnings: semanticFindings.map((f) => f.message),
  };
    }
  }

  return {
    cellId: cell.id,
    status: "completed",
    outputs: [output],
    durationMs: result.elapsed_ms,
    auditLogId: result.audit_log_id,
    rowCount: result.row_count ?? safeRows.length,
  };
}

function coerceRows(rows: unknown[][]): Array<Array<string | number | boolean | null>> {
  return rows.map((row) =>
    row.map((cell) => {
      if (cell === null || cell === undefined) return null;
      if (typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean") {
        return cell;
      }
      return String(cell);
    }),
  );
}

// -------------------------------------------------------------- Python

async function executePythonCell(
  cell: NotebookCell,
  ctx: CellExecuteContext,
  signal: AbortSignal,
  metrics: ReturnType<typeof wireMetrics>,
): Promise<CellExecuteResult> {
  if (!ctx.pythonBin) {
    metrics.incCellRun("failed", "python");
    metrics.observeCellDuration(0, "python");
    return {
      cellId: cell.id,
      status: "failed",
      outputs: [
        {
          kind: "error",
          message:
            "Python runtime not configured. Set WORKSPACE_PYTHON_VENV to a venv with python on $PATH.",
        },
      ],
      durationMs: 0,
      errorMessage: "python runtime missing — set WORKSPACE_PYTHON_VENV or install Python.",
    };
  }

  const startedAt = Date.now();

  if (ctx.sandbox) {
    // ── Sandboxed execution path ────────────────────────────────────────────
    const timeoutMs = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);
    try {
      // ── Layer 1: harness-core ProcessSandbox (OS-level) ─────────────────
      if (ctx.sandbox.harnessBridge) {
        const bridgeResult = await ctx.sandbox.harnessBridge.executePython(cell.source, {
          cellId: cell.id,
          timeoutMs,
          onSandboxEvent: (event) => {
            // Forward harness events to audit log
            if (event.event === "error") {
              ctx.sandbox!.onAudit?.({
                sandboxId: event.sandboxId,
                workspaceId: ctx.workspaceId,
                userId: ctx.userId,
                cellId: cell.id,
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                status: "failed",
                errorMessage: event.error,
              });
            }
          },
        });

        const elapsed = Date.now() - startedAt;

        if (bridgeResult.timedOut) {
          metrics.incCellRun("timeout", "python");
          metrics.observeSandboxDuration(elapsed, "timeout");
          return {
            cellId: cell.id,
            status: "failed",
            outputs: [{ kind: "error", message: `Execution timed out after ${timeoutMs}ms` }],
            durationMs: elapsed,
            errorMessage: "timeout",
          };
        }

        if (bridgeResult.blockedModules.length > 0) {
          const reason = bridgeResult.blockedModules.join(",");
          metrics.incSandboxBlock(reason);
          metrics.observeSandboxDuration(elapsed, "blocked");
          return {
            cellId: cell.id,
            status: "failed",
            outputs: [{
              kind: "error",
              message: `Sandbox blocked: ${reason}`,
            }],
            durationMs: elapsed,
            errorMessage: `blocked: ${reason}`,
          };
        }

        if (bridgeResult.exitCode === 0) {
          metrics.incCellRun("completed", "python");
          metrics.observeSandboxDuration(elapsed, "completed");
          return {
            cellId: cell.id,
            status: "completed",
            outputs: [{ kind: "text", text: bridgeResult.stdout || "(no output)" }],
            durationMs: elapsed,
          };
        }

        metrics.incCellRun("failed", "python");
        metrics.observeSandboxDuration(elapsed, "failed");
        return {
          cellId: cell.id,
          status: "failed",
          outputs: [{
            kind: "error",
            message: bridgeResult.stderr.trim() || `python exited with ${bridgeResult.exitCode}`,
            traceback: bridgeResult.stdout || undefined,
          }],
          durationMs: elapsed,
          errorMessage: bridgeResult.stderr.trim() || `exit ${bridgeResult.exitCode}`,
        };
      }

      // ── Layer 2: sandbox-python.ts (Python-level only) ─────────────────
      const sandboxOpts: SandboxOptions = {
        pythonBin: ctx.pythonBin,
        timeoutMs,
        allowedReadDir: ctx.sandbox.allowedReadDir ?? null,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        networkIsolation: ctx.sandbox.networkIsolation ?? { type: "none" },
        audit: ctx.sandbox.onAudit,
      };

      // Check network isolation availability once per process start
      // (cached by the caller; we skip the check inline for perf)
      const result = await runSandboxedPython(cell.source, sandboxOpts, {
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        cellId: cell.id,
      });

      const elapsed = Date.now() - startedAt;

      if (result.blocked) {
        const reason = result.blockReason ?? result.blockedImports.join(",");
        metrics.incSandboxBlock(reason);
        metrics.observeSandboxDuration(elapsed, "blocked");
        return {
          cellId: cell.id,
          status: "failed",
          outputs: [
            {
              kind: "error",
              message:
                result.blockReason ??
                `Sandbox blocked dangerous import: ${result.blockedImports.join(", ")}`,
            },
          ],
          durationMs: elapsed,
          errorMessage: result.blockReason,
        };
      }

      if (result.exitCode === 0) {
        metrics.incCellRun("completed", "python");
        metrics.observeSandboxDuration(elapsed, "completed");
        return {
          cellId: cell.id,
          status: "completed",
          outputs: [{ kind: "text", text: result.stdout || "(no output)" }],
          durationMs: elapsed,
        };
      }

      metrics.incCellRun("failed", "python");
      metrics.observeSandboxDuration(elapsed, "failed");
      return {
        cellId: cell.id,
        status: "failed",
        outputs: [
          {
            kind: "error",
            message: result.stderr.trim() || `python exited with ${result.exitCode}`,
            traceback: result.stdout || undefined,
          },
        ],
        durationMs: elapsed,
        errorMessage: result.stderr.trim() || `exit ${result.exitCode}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Legacy execution path (dev/CI only — no sandbox) ────────────────────
  // DEPRECATED: remove this branch once sandbox path is stable in production.
  if (process.env.NODE_ENV === "production") {
    return {
      cellId: cell.id,
      status: "failed",
      outputs: [
        {
          kind: "error",
          message:
            "Sandbox is required in production but not configured. Set sandbox configuration in CellExecuteContext.",
        },
      ],
      durationMs: 0,
      errorMessage: "sandbox required in production",
    };
  }

  const stdout = await runPythonOnce(ctx.pythonBin, cell.source, signal);
  const elapsed = Date.now() - startedAt;
  if (stdout.exitCode === 0) {
    return {
      cellId: cell.id,
      status: "completed",
      outputs: [
        {
          kind: "text",
          text: stdout.stdout || "(no output)",
        },
      ],
      durationMs: elapsed,
    };
  }
  return {
    cellId: cell.id,
    status: "failed",
    outputs: [
      {
        kind: "error",
        message: stdout.stderr.trim() || `python exited with ${stdout.exitCode}`,
        traceback: stdout.stdout || undefined,
      },
    ],
    durationMs: elapsed,
    errorMessage: stdout.stderr.trim() || `python exited with ${stdout.exitCode}`,
  };
}

interface PythonRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runPythonOnce(
  pythonBin: string,
  source: string,
  signal: AbortSignal,
): Promise<PythonRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, ["-I", "-S", "-c", source], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONDONTWRITEBYTECODE: "1",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length > MAX_OUTPUT_BYTES) {
        child.kill();
        return;
      }
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length > MAX_OUTPUT_BYTES) {
        child.kill();
        return;
      }
      stderr += chunk.toString("utf8");
    });
    const onAbort = () => {
      child.kill();
      reject(new CellExecutionError("failed", "Execution aborted by signal"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    child.on("error", (err) => {
      signal.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

// ----------------------------------------------------------- AI prompt

async function executeAiPromptCell(
  cell: NotebookCell,
  ctx: CellExecuteContext,
  _signal: AbortSignal,
  metrics: ReturnType<typeof wireMetrics>,
): Promise<CellExecuteResult> {
  if (!ctx.completePrompt) {
    return {
      cellId: cell.id,
      status: "failed",
      outputs: [
        {
          kind: "error",
          message:
            "AI completion is not configured for this server. Configure a model provider in /admin → LLM profiles.",
        },
      ],
      durationMs: 0,
      errorMessage: "completion missing",
    };
  }
  const startedAt = Date.now();
  const prompt = cell.source.trim();
  const completion = await ctx.completePrompt(prompt, cell.model);
  return {
    cellId: cell.id,
    status: "completed",
    outputs: [{ kind: "text", text: completion }],
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Helper for callers that want to bind default cell ids without
 * duplicating the random-id logic.
 */
export function newCellId(): string {
  return `cell-${randomUUID().slice(0, 8)}`;
}
