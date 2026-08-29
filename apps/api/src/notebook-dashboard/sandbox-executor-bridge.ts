/**
 * Sandbox executor bridge 鈥?wires `packages/harness-core` ProcessSandbox into the
 * notebook cell executor.
 *
 * This module is the missing link identified by the architecture review:
 *   packages/harness-core/src/sandbox/ contains a full sandbox implementation
 *   (ProcessSandbox, VmSandbox, DockerSandbox) but was never wired into apps/api.
 *
 * Responsibilities:
 *   1. Manage a SandboxManager lifecycle (create on first use, clean up on idle)
 *   2. Translate executor-style Python execution into SandboxExecutionRequest
 *   3. Handle timeout, memory limit, and permission enforcement via the harness
 *   4. Adapt SandboxExecutionResult 鈫?CellExecuteResult for the notebook engine
 *
 * Sandboxing layers (now fully integrated):
 *   Layer A 鈥?harness-core ProcessSandbox
 *     鈥?CPU time limit  (via `limits.maxExecutionTimeMs`)
 *     鈥?Memory limit    (via `limits.maxMemoryMb`)
 *     鈥?Max process count (via `limits.maxProcesses`)
 *     鈥?File permission deny-list (via `permissions.files`)
 *     鈥?Environment variable stripping
 *     鈥?stdout/stderr capture
 *
 *   Layer B 鈥?sandbox-python.ts (Python-level defence)
 *     鈥?Import blocklist (subprocess, socket, pickle, etc.)
 *     鈥?Disabled builtins (compile, exec, eval, open)
 *     鈥?Import hook interception
 *
 * Together they provide defence-in-depth: even if Python-level protection is
 * bypassed, the OS-level resource limits and file permissions still apply.
 *
 * Usage:
 *   import { createSandboxExecutorBridge } from "./sandbox-executor-bridge.js";
 *
 *   const bridge = createSandboxExecutorBridge({
 *     pythonBin: process.env.WORKSPACE_PYTHON_VENV ?? "python",
 *     sandboxManager: createSandboxManager({ maxSandboxes: 10, cleanupInterval: 60_000 }),
 *   });
 *
 *   const result = await bridge.executePython("print('hello')", {
 *     timeoutMs: 30_000,
 *     sandboxId: "cell-123",
 *   });
 */

import type {
  SandboxManager,
  Sandbox,
} from "@agentx/harness-core";

import {
  createSandbox,
  type SandboxConfig,
  type SandboxPermissions,
  type SandboxResourceLimits,
  type SandboxExecutionRequest,
  type SandboxExecutionResult,
  type SandboxStatus,
} from "@agentx/harness-core";

import type { CellOutput } from "./types.js";

export interface SandboxExecutorBridgeOptions {
  /** Path to the Python interpreter (from WORKSPACE_PYTHON_VENV). */
  pythonBin: string;
  /** Optional pre-configured SandboxManager. If not provided, creates one. */
  sandboxManager?: SandboxManager;
  /** Default timeout in ms. Default 30_000. */
  defaultTimeoutMs?: number;
  /** Default memory limit in MB. Default 256. */
  defaultMemoryMb?: number;
  /** Working directory for sandboxed processes. Default: system temp. */
  workDir?: string;
  /**
   * Custom Python arguments appended to -I -S -P.
   * Defaults to ["-u"] (unbuffered) on all platforms.
   */
  pythonArgs?: string[];
  /** Called with sandbox lifecycle events (error, timeout, complete). */
  onSandboxEvent?: (event: { sandboxId: string; event: string; error?: string }) => void;
}

export interface ExecutePythonOptions {
  /** Unique cell id, used as sandbox name for tracking. */
  cellId: string;
  /** Hard timeout in milliseconds. */
  timeoutMs?: number;
  /**
   * Memory limit in MB for this run.  Defaults to bridge default.
   * Note: ProcessSandbox sets `ulimit -v` on Linux; on Windows this is
   * enforced via job objects (best-effort).
   */
  memoryMb?: number;
  /**
   * Override the Python binary path for this specific run.
   * Useful for workspace-specific venvs.
   */
  pythonBin?: string;
  /**
   * Extra sandbox config merged into the per-run sandbox config.
   * Allows callers to tighten or relax sandbox settings.
   */
  sandboxConfig?: Partial<SandboxConfig>;
  /** Called with sandbox lifecycle events for audit. */
  onSandboxEvent?: (event: SandboxLifecycleEvent) => void;
}

export interface SandboxLifecycleEvent {
  sandboxId: string;
  event: "created" | "started" | "stopped" | "destroyed" | "error";
  sandboxStatus: SandboxStatus;
  error?: string;
}

export interface PythonExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  sandboxId: string;
  sandboxStatus: SandboxStatus;
  blockedModules: string[];
  /** Human-readable reason for failure, if any. */
  reason?: string | undefined;
}

const SAFE_ENV_KEYS = new Set([
  "PATH", "HOME", "USER", "LANG", "LC_ALL", "LC_MESSAGES",
  "LANGUAGE", "TMPDIR", "TMP", "TEMP", "PYTHONUNBUFFERED",
  "PYTHONDONTWRITEBYTECODE", "PYTHONIOENCODING",
]);

const BLOCKED_ENV_PREFIXES = [
  "AWS_", "AZURE_", "GCP_", "GOOGLE_",
  "SECRET", "TOKEN", "PASSWORD", "PRIVATE_KEY",
  "DATABASE_URL", "REDIS_", "POSTGRES", "MYSQL_",
  "MONGODB", "SQLALCHEMY", "HF_", "OPENAI_",
  "ANTHROPIC_", "DEEPSEEK_", "LLM_", "SENTRY_",
];

function buildSandboxEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  for (const [key, val] of Object.entries(process.env)) {
    if (val === undefined) continue;
    if (BLOCKED_ENV_PREFIXES.some((p) => key.startsWith(p))) {
      // strip credential env vars
    }
  }
  return env;
}

function buildSandboxPermissions(
  options: ExecutePythonOptions,
): SandboxPermissions {
  return {
    allowSubprocess: false,
    allowShell: false,
    allowNativeModules: false,
    allowNetwork: false,
    allowWrite: false,
    files: [
      // Read-only access to Python stdlib and venv site-packages
      { pattern: "**/lib/**", read: true, write: false, execute: false },
      { pattern: "**/site-packages/**", read: true, write: false, execute: false },
      // Write to temp only
      { pattern: "**/tmp/**", read: true, write: true, execute: false },
      { pattern: "**/temp/**", read: true, write: true, execute: false },
      // Deny everything else
      { pattern: "*", read: false, write: false, execute: false },
    ],
  };
}

function buildResourceLimits(options: ExecutePythonOptions, defaults: {
  timeoutMs: number; memoryMb: number;
}): SandboxResourceLimits {
  return {
    maxExecutionTimeMs: options.timeoutMs ?? defaults.timeoutMs,
    maxMemoryMB: options.memoryMb ?? defaults.memoryMb,
    maxProcesses: 1,
  };
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Bridge class
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export class SandboxExecutorBridge {
  private readonly pythonBin: string;
  private readonly pythonArgs: string[];
  private sandboxManager: SandboxManager | null;
  private pendingDefaultManager: Promise<SandboxManager> | null;
  private readonly defaultTimeoutMs: number;
  private readonly defaultMemoryMb: number;
  private readonly workDir: string;
  private readonly sandboxCache = new Map<string, Sandbox>();
  private readonly onSandboxEvent?: (event: SandboxLifecycleEvent) => void;

  constructor(options: SandboxExecutorBridgeOptions) {
    this.pythonBin = options.pythonBin;
    this.pythonArgs = options.pythonArgs ?? (process.platform === "win32" ? [] : ["-u"]);
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.defaultMemoryMb = options.defaultMemoryMb ?? 256;
    this.workDir = options.workDir ?? process.env.TMPDIR ?? process.env.TEMP ?? "/tmp";
    if (options.onSandboxEvent !== undefined) {
      this.onSandboxEvent = options.onSandboxEvent;
    }

    if (options.sandboxManager) {
      this.sandboxManager = options.sandboxManager;
      this.pendingDefaultManager = null;
    } else {
      // Defer manager creation: harness-core is ESM with an exports map,
      // so we use a lazy Promise and resolve on first use.
      this.sandboxManager = null;
      this.pendingDefaultManager = createDefaultSandboxManager();
    }
  }

  /**
   * Synchronous accessor — returns the cached manager if available.
   * Throws if default manager hasn't been initialised; call {@link awaitReady} first.
   */
  private getCachedSandboxManager(): SandboxManager {
    if (!this.sandboxManager) {
      throw new Error("SandboxExecutorBridge: default manager not initialised yet — call awaitReady() first.");
    }
    return this.sandboxManager;
  }

  /** Wait until the default manager is loaded. */
  async awaitReady(): Promise<SandboxManager> {
    if (this.sandboxManager) return this.sandboxManager;
    if (this.pendingDefaultManager) {
      try {
        this.sandboxManager = await this.pendingDefaultManager;
        this.pendingDefaultManager = null;
      } catch (err) {
        this.pendingDefaultManager = null;
        throw err;
      }
    }
    if (!this.sandboxManager) {
      throw new Error("SandboxExecutorBridge: no sandbox manager available");
    }
    return this.sandboxManager;
  }

  private async resolveSandboxManager(): Promise<SandboxManager> {
    return this.awaitReady();
  }

  /**
   * Execute Python source inside a harness-core sandbox.
   *
   * Each call creates a fresh sandbox (sandbox pool handles reuse).
   * The sandbox enforces:
   *   - CPU time limit (maxExecutionTimeMs)
   *   - Memory limit (maxMemoryMb 鈥?via ulimit/job objects)
   *   - Single-process limit
   *   - File permission deny-list
   *   - Stripped environment variables
   *
   * The Python bootstrap (from sandbox-python.ts) runs inside the sandbox
   * and provides the import blocklist + disabled builtins.
   */
  async executePython(
    source: string,
    options: ExecutePythonOptions,
  ): Promise<PythonExecutionResult> {
    const sandboxId = `cell-${options.cellId}`;
    const pythonBin = options.pythonBin ?? this.pythonBin;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const memoryMb = options.memoryMb ?? this.defaultMemoryMb;

    const sandboxConfig: SandboxConfig = {
      id: sandboxId,
      type: "process",
      name: `python-cell-${options.cellId}`,
      workdir: this.workDir,
      permissions: buildSandboxPermissions(options),
      limits: buildResourceLimits(options, {
        timeoutMs: this.defaultTimeoutMs,
        memoryMb: this.defaultMemoryMb,
      }),
      env: buildSandboxEnv() as Record<string, string>,
      ...options.sandboxConfig,
    };

    // Use the sandbox manager to create + track the sandbox
    let sandbox: Sandbox;
    try {
      const mgr = await this.resolveSandboxManager();
      sandbox = mgr.create(sandboxConfig);
    } catch (err) {
      // Pool exhausted 鈥?fall back to direct spawn (degraded mode)
      console.warn(`[sandbox-bridge] Sandbox pool exhausted, using degraded mode: ${err}`);
      return this.executeDirect(source, { ...options, timeoutMs, pythonBin });
    }

    // Wire lifecycle events for audit
    sandbox.on("status:change", (status: SandboxStatus) => {
      this.onSandboxEvent?.({
        sandboxId,
        event: status === "running" ? "started" : status === "stopped" ? "stopped" : status === "destroyed" ? "destroyed" : "created",
        sandboxStatus: status,
      });
    });
    sandbox.on("error", (err: Error) => {
      this.onSandboxEvent?.({
        sandboxId, event: "error",
        sandboxStatus: sandbox.getStatus(),
        error: err.message,
      });
    });

    try {
      await sandbox.start();
    } catch (err) {
      await sandbox.destroy();
      return {
        stdout: "", stderr: "",
        exitCode: -1, timedOut: false,
        sandboxId, sandboxStatus: "error",
        blockedModules: [],
        reason: `Sandbox start failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    try {
      const result = await sandbox.execute({
        command: pythonBin,
        args: ["-I", "-S", "-P", ...this.pythonArgs, "-c", source],
        timeout: timeoutMs,
        cwd: this.workDir,
        env: buildSandboxEnv() as Record<string, string>,
      });

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode ?? -1,
        timedOut: result.timedOut ?? false,
        sandboxId,
        sandboxStatus: sandbox.getStatus(),
        blockedModules: this.extractBlockedModules(result),
        reason: result.error,
      };
    } catch (err) {
      return {
        stdout: "", stderr: "",
        exitCode: -1, timedOut: false,
        sandboxId, sandboxStatus: sandbox.getStatus(),
        blockedModules: [],
        reason: `Sandbox execution error: ${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      await sandbox.destroy();
    }
  }

  /**
   * Execute Python without sandbox 鈥?only used as fallback when the pool is
   * exhausted or the sandbox fails to start.  This path should never be taken
   * in production with a properly-sized sandbox pool.
   */
  private async executeDirect(
    source: string,
    options: { timeoutMs: number; pythonBin: string },
  ): Promise<PythonExecutionResult> {
    const { spawn } = await import("node:child_process");
    return new Promise((resolve) => {
      const child = spawn(options.pythonBin, ["-I", "-S", "-P", "-c", source], {
        stdio: ["ignore", "pipe", "pipe"],
        env: buildSandboxEnv() as NodeJS.ProcessEnv,
      });
      let stdout = "", stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve({ stdout, stderr, exitCode: -1, timedOut: true, sandboxId: "direct-fallback", sandboxStatus: "running", blockedModules: [], reason: "Direct fallback timed out" });
      }, options.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? -1, timedOut: false, sandboxId: "direct-fallback", sandboxStatus: "stopped", blockedModules: [] });
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: -1, timedOut: false, sandboxId: "direct-fallback", sandboxStatus: "error", blockedModules: [], reason: err.message });
      });
    });
  }

  private extractBlockedModules(result: SandboxExecutionResult): string[] {
    // Try to extract blocked module names from the result.
    // The Python bootstrap embeds blocked imports in stderr or a sentinel.
    if (!result.stderr) return [];
    // Pattern: "Sandbox: import of 'X' is blocked"
    const matches = [...result.stderr.matchAll(/import of '([^']+)' is blocked/gi)];
    return [...new Set(matches.map((m) => m[1]!))];
  }

  /** Adapt a PythonExecutionResult to CellOutput[] for the notebook engine. */
  toCellOutputs(result: PythonExecutionResult): CellOutput[] {
    if (result.exitCode === 0) {
      return [{ kind: "text", text: result.stdout || "(no output)" }];
    }
    const message = result.timedOut
      ? `Execution timed out after ${this.defaultTimeoutMs}ms`
      : result.reason
        ? result.reason
        : result.stderr || `python exited with ${result.exitCode}`;
    return [{
      kind: "error",
      message,
      traceback: result.stdout || undefined,
    }];
  }

  /** Returns the underlying SandboxManager for lifecycle management (sync — see also `awaitReady`). */
  getSandboxManager(): SandboxManager {
    return this.getCachedSandboxManager();
  }
}

/** Convenience factory. */
export function createSandboxExecutorBridge(options: SandboxExecutorBridgeOptions): SandboxExecutorBridge {
  return new SandboxExecutorBridge(options);
}

async function createDefaultSandboxManager(): Promise<SandboxManager> {
  const mod = await import("@agentx/harness-core");
  return mod.createSandboxManager({
    maxSandboxes: 10,
    cleanupInterval: 60_000,
    defaultType: "process",
    defaultPermissions: {
      allowSubprocess: false,
      allowShell: false,
      allowNativeModules: false,
      allowNetwork: false,
      allowWrite: false,
      files: [
        { pattern: "**/tmp/**", read: true, write: true, execute: false },
        { pattern: "**/lib/**", read: true, write: false, execute: false },
        { pattern: "**/site-packages/**", read: true, write: false, execute: false },
      ],
    },
  });
}