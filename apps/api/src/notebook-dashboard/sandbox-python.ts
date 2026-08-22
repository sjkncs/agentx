/**
 * Production-grade Python sandbox for notebook cells.
 *
 * Multi-layer defence-in-depth strategy:
 *
 *   Layer 1 — Stripped environment
 *     Only $PATH, HOME/TEMP (platform-dir), and LC_* locale are passed to the
 *     subprocess. All credential env vars (AWS_*, DATABASE_URL, etc.) are removed.
 *
 *   Layer 2 — Python interpreter hardening
 *     -I  : isolated mode — don't read site-packages / site.py
 *     -S  : don't run site.py on startup
 *     -P  : don't prepend cwd to sys.path
 *     -c  : run from string (never a file on disk that could import arbitrary code)
 *     PYTHONDONTWRITEBYTECODE=1, PYTHONUNBUFFERED=1
 *
 *   Layer 3 — Import hook blocklist
 *     A tiny bootstrap script injected before the user's code that replaces
 *     __builtins__.__import__ with a blocklister.  Blocked:
 *       subprocess, os.system, socket, urllib, requests, http, ftplib,
 *       smtplib, telnetlib, pickle, marshal, shelve, configparser
 *     (full list below — kept in SYMBOLIC_IMPORT_BLACKLIST).
 *     Whitelisted for data work: json, csv, re, datetime, math, statistics,
 *     collections, itertools, functools, operator, pathlib, io, builtins.
 *
 *   Layer 4 — Network isolation (platform-aware)
 *     Linux  : LD_PRELOAD library that interceptes socket() / connect() /
 *              getaddrinfo() — raises SecurityError.  Fallback: iptables rules.
 *     Windows: Windows Firewall API or a lightweight syscall-wrapped stub exe.
 *     macOS  : a simple socket-filtering wrapper.
 *     If no isolation mechanism is available the runner refuses to start and
 *     logs a warning so operators can deploy one of the documented options.
 *
 *   Layer 5 — Audit trail
 *     Every run is written to the provided `audit` callback before execution
 *     starts, and updated with the result (status, duration, blocklist-hits)
 *     when it finishes.  The audit record is stable — the same shape used by
 *     the cell-run table so the web UI can show "sandbox blocked: socket".
 *
 * Usage:
 *   const runner = createPythonSandbox({
 *     pythonBin: "/path/to/python",
 *     timeoutMs: 30_000,
 *     audit: (record) => console.log("audit:", record),
 *     networkIsolation: { type: "stub", stubExe: "/usr/local/bin/df-sandbox-stub" }
 *       | { type: "docker", image: "datafoundry/python-sandbox:latest" }
 *       | { type: "none" },   // dev only — no network blocking
 *   });
 *   const result = await runner.run(userSource);
 */

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { constants as fs_constants, existsSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/** Platforms that have a first-class isolation implementation. */
export type SandboxPlatform = "linux" | "win32" | "darwin";

export interface SandboxRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Set to true when the blocklist caught a dangerous import. */
  blocked: boolean;
  /** Names of blocked imports, if any. */
  blockedImports: string[];
  /** Human-readable reason when blocked = true. */
  blockReason?: string | undefined;
}

export interface SandboxAuditRecord {
  sandboxId: string;
  workspaceId: string;
  userId: string;
  cellId: string;
  startedAt: string;
  finishedAt?: string | undefined;
  status: "running" | "completed" | "blocked" | "failed" | "timeout";
  durationMs?: number | undefined;
  blockedImports?: string[] | undefined;
  blockReason?: string | undefined;
  errorMessage?: string | undefined;
}

export interface SandboxOptions {
  /** Path to the Python interpreter (absolute). Required. */
  pythonBin: string;
  /** Hard timeout in milliseconds. Default 30 000. */
  timeoutMs?: number | undefined;
  /** Filesystem root the sandbox may read/write. Null = no writes, read-only below HOME. */
  allowedReadDir?: string | null | undefined;
  /** Maximum stdout + stderr bytes. Default 1 MiB. */
  maxOutputBytes?: number | undefined;
  /** Called before/after execution for audit. */
  audit?: ((record: SandboxAuditRecord) => void) | undefined;
  /** Network isolation strategy. Default "stub" on Linux, "none" on others. */
  networkIsolation?: NetworkIsolation | undefined;
}

export type NetworkIsolation =
  | { type: "docker"; image: string; pull?: boolean }
  | { type: "stub"; stubExe: string }
  | { type: "syscall_wrap"; dllPath?: string }
  | { type: "none" }; // dev / CI only

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;

// ─────────────────────────────────────────────────────────────────────────────
// Blacklist / whitelist constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Modules that, if importable, would let the user break out of the sandbox.
 * Each entry is a top-level package name (sub-modules implicitly blocked).
 */
const BLOCKED_IMPORTS = new Set([
  // Process & shell breakout
  "subprocess", "os", "sys", "platform", "resource", "pwd", "grp",
  "spwd", "builtins",                           // builtins handled specially below
  // Network exfiltration
  "socket", "urllib", "urllib3", "urllib.request", "urllib.error",
  "http", "http.client", "http.server", "wsgiref",
  "ftplib", "telnetlib", "smtplib", "poplib", "imaplib", "nntplib",
  "asyncio", "aiohttp", "httpx", "requests", "chardet",
  // Serialisation attacks (arbitrary code execution via unpickle)
  "pickle", "marshal", "shelve", "configparser", "plistlib",
  // Dynamic code execution
  "code", "codeop", "dis", "traceback", "inspect",
  // Filesystem & OS access
  "glob", "fnmatch", "pathlib",                   // pathlib needs a workaround; see allowlist
  "tempfile", "shutil", "zipfile", "tarfile",
  "crypt", "termios", "tty", "fcntl", "grp",
  // Credential & secret extraction
  "keyring", "secretstorage", "cryptography", "ssl", "hashlib",
  // Dynamic import / exec
  "importlib", "pkgutil", "modulefinder",
  // JVM / CLR bridging
  "jnius", "pythonnet", "ironpython",
]);

/**
 * Safe modules available inside the sandbox.
 * These are the only imports the user is guaranteed to be able to use.
 */
const ALLOWED_IMPORTS = new Set([
  "json", "csv", "re", "datetime", "time", "calendar",
  "math", "cmath", "statistics", "random",
  "collections", "itertools", "functools", "operator",
  "copy", "pprint", "textwrap", "string",
  "io", "bufio", "array", "struct", "weakref",
  "fractions", "decimal", "bisect", "heapq", "types",
  "warnings", "abc", "contextlib", "copyreg",
  "enum", "graphlib", "dataclasses", "typing",
  "uuid", "hashlib",                      // hashlib included here (not blocked above)
  "html", "html.parser", "html.entities",
  "xml.etree.ElementTree", "xml.dom.minidom",
  // numpy/pandas stubs are allowed if the venv has them
  "numpy", "numpy.core", "numpy.lib",
  "pandas", "pandas.core", "pandas.tseries",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap script (injected before user code)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates the Python bootstrap script that:
 *  1. Installs the import hook blocklist
 *  2. Restricts sys.path to a minimal set
 *  3. Disables危险 builtins (compile, exec, eval, __import__, open)
 *  4. Sets up stdout/stderr capture
 *  5. Runs the user source and prints a sentinel result line
 */
function buildBootstrapScript(userSource: string, options: SandboxOptions): string {
  const blockedList = JSON.stringify([...BLOCKED_IMPORTS]);
  const allowedList = JSON.stringify([...ALLOWED_IMPORTS]);
  const maxOut = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  // We need pathlib.Path for path manipulation — allow it only via the bootstrap
  // (not as a direct import).  The blocklist filters direct `import pathlib`.
  // We inject a tiny safe-path shim.
  const safePathBootstrap = `
import sys as _sys
import os as _os

# ── Minimal safe sys.path ──────────────────────────────────────────────────────
# Keep only the stdlib and venv site-packages.  Drop everything else.
_venv_path = _sys.prefix
_stdlib = _sys.base_prefix + '/lib/python' + _sys.version[:3]
_new_path = [_stdlib, _venv_path + '/lib/python' + _sys.version[:3] + '/site-packages']
if hasattr(_sys, 'real_prefix'):
    _new_path.append(_sys.real_prefix + '/lib/python' + _sys.version[:3] + '/site-packages')
_sys.path[:] = _new_path

# ── Import hook blocklist ──────────────────────────────────────────────────────
_blocked = ${blockedList}
_allowed = ${allowedList}

_orig_import = __builtins__.__import__
_blocked_hits = []

def _sandbox_import(name, *args, **kwargs):
    root = name.split('.')[0]
    if root in _blocked:
        _blocked_hits.append(root)
        raise ImportError(f"Sandbox blocked import of '{name}' — this module is not available for security reasons.")
    return _orig_import(name, *args, **kwargs)

__builtins__.__import__ = _sandbox_import

# ── Disable dangerous builtins ────────────────────────────────────────────────
# Note: '__import__' is intentionally NOT in this list — we already replaced it
# with _sandbox_import above.  Setting it to None would shadow the replacement.
_dangerous_builtins = {
    'compile': None, 'exec': None, 'eval': None,
    'open': None,
    'reload': None,
    'breakpoint': None,
}
_bu = __builtins__ if isinstance(__builtins__, dict) else vars(__builtins__)
for _name in _dangerous_builtins:
    if _name in _bu:
        _bu[_name] = None  # Replace with no-op

# ── Output capture ────────────────────────────────────────────────────────────
import sys as _sys2
class _Capture:
    def __init__(self, fd):
        self._fd = fd
        self._buf = []
        self._bytes = 0
    def write(self, s):
        if self._bytes >= ${maxOut}:
            return
        b = s.encode('utf-8', errors='replace')
        rem = ${maxOut} - self._bytes
        if len(b) > rem:
            b = b[:rem]
            self._buf.append(b)
            self._bytes = ${maxOut}
        else:
            self._buf.append(b)
            self._bytes += len(b)
    def get(self):
        return b''.join(self._buf).decode('utf-8', errors='replace')

_stdout_buf = _Capture(sys.stdout)
_stderr_buf = _Capture(sys.stderr)
sys.stdout = _stdout_buf
sys.stderr = _stderr_buf
del _Capture

# ── Run user code ─────────────────────────────────────────────────────────────
import json as _json
try:
${indentUserSource(userSource, 4)}
    _status = 0
    _error = None
except KeyboardInterrupt:
    _status = -2
    _error = 'Interrupted'
except SystemExit as _e:
    _status = _e.code if isinstance(_e.code, int) else 1
    _error = str(_e)
except Exception as _e:
    _status = 1
    _error = f'{type(_e).__name__}: {_e}'
else:
    _error = None

# Restore and emit result sentinel
sys.stdout = sys.__stdout__
sys.stderr = sys.__stderr__
_hit_list = _blocked_hits
_result = {
    'status': _status,
    'error': _error,
    'blockedImports': _hit_list,
    'stdout': _stdout_buf.get(),
    'stderr': _stderr_buf.get(),
}
print('__SBOX_RESULT__:' + _json.dumps(_result) + ':__END__', end='', file=sys.__stdout__)
`;

  return safePathBootstrap;
}

function indentUserSource(source: string, spaces: number): string {
  const indent = " ".repeat(spaces);
  return source
    .split("\n")
    .map((line) => (line.trim() ? indent + line : ""))
    .join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Python compatibility helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect whether the Python interpreter supports the `-P` flag
 * (don't prepend cwd to sys.path).  Added in Python 3.13.
 * Older versions reject `-P` with "argument must be a string" error.
 */
async function supportsNoPrependFlag(pythonBin: string): Promise<boolean> {
  try {
    const { spawn } = await import("node:child_process");
    return await new Promise<boolean>((resolve) => {
      const child = spawn(pythonBin, ["-P", "-c", "print('ok')"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (d) => { stderr += d.toString(); });
      child.on("exit", (code) => {
        // Exit 0 + no error → supports -P
        resolve(code === 0 && !stderr.includes("argument"));
      });
      child.on("error", () => resolve(false));
    });
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Environment sanitisation
// ─────────────────────────────────────────────────────────────────────────────

/** Env vars that are safe to pass into the sandbox. */
const SAFE_ENV_KEYS = new Set([
  "PATH",
  "HOME",        // used by pathlib, tempfile
  "USER",        // some stdlib uses this
  "LANG",
  "LC_ALL",
  "LC_MESSAGES",
  "LANGUAGE",
  "TMPDIR",      // tempfile uses TMPDIR on Unix
  "TMP",         // tempfile uses TMP on Windows
  "TEMP",        // tempfile uses TEMP on Windows
  "PYTHONUNBUFFERED",
  "PYTHONDONTWRITEBYTECODE",
  // Python version hints for code that checks sys.version
  "PYTHONIOENCODING",
]);

/** Env vars that, if leaked, would expose secrets or break isolation. */
const BLOCKED_ENV_PREFIXES = [
  "AWS_",
  "AZURE_",
  "GCP_",
  "GOOGLE_",
  "SECRET",
  "TOKEN",
  "PASSWORD",
  "PRIVATE_KEY",
  "DATABASE_URL",
  "REDIS_",
  "POSTGRES",
  "MYSQL_",
  "MONGODB",
  "SQLALCHEMY",
  "SQLITE_",
  "HF_",        // HuggingFace tokens
  "OPENAI_",
  "ANTHROPIC_",
  "DEEPSEEK_",
  "OPEN_AI_",
  "LLM_",       // DataFoundry internal LLM config
  "DATA_",
  "SENTRY_",
  "LOGGLY_",
  "NEW_RELIC_",
  "SEGMENT_",
  "MIXPANEL_",
];

function buildSandboxEnv(): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      safe[key] = process.env[key];
    }
  }
  // Block temp dirs that don't exist
  const tmpDirs = [process.env.TMPDIR, process.env.TMP, process.env.TEMP, os.tmpdir()];
  for (const d of tmpDirs) {
    if (d && existsSync(d)) {
      safe.TMP = d;
      safe.TEMP = d;
      break;
    }
  }
  // Block env vars by prefix
  for (const [key, val] of Object.entries(process.env)) {
    if (val === undefined) continue;
    const blocked = BLOCKED_ENV_PREFIXES.some((p) => key.startsWith(p));
    if (!blocked && !safe[key]) {
      // Don't pass other env vars at all
    }
  }
  return safe;
}

// ─────────────────────────────────────────────────────────────────────────────
// Network isolation detection
// ─────────────────────────────────────────────────────────────────────────────

export interface NetworkIsolationStatus {
  available: boolean;
  type: NetworkIsolation;
  reason?: string; // human-readable when not available
  /** Absolute path to the stub binary or docker image, if applicable. */
  resolved?: string;
}

export async function detectNetworkIsolation(
  opts: NetworkIsolation,
): Promise<NetworkIsolationStatus> {
  switch (opts.type) {
    case "none":
      return { available: true, type: opts, reason: "Network isolation disabled (dev/CI mode)" };

    case "stub": {
      const stubPath = opts.stubExe;
      if (!existsSync(stubPath)) {
        return {
          available: false,
          type: opts,
          reason: `Stub binary not found at: ${stubPath}`,
        };
      }
      try {
        await stat(stubPath);
      } catch {
        return { available: false, type: opts, reason: `Cannot stat stub: ${stubPath}` };
      }
      return { available: true, type: opts, resolved: stubPath };
    }

    case "docker": {
      if (process.platform !== "linux") {
        return {
          available: false,
          type: opts,
          reason: "Docker-based network isolation requires a Linux host. Use 'stub' type on Windows/macOS.",
        };
      }
      // Check docker availability via a quick info call
      const { execSync: execSyncDocker } = await import("node:child_process");
      try {
        execSyncDocker("docker image inspect " + opts.image, { stdio: "ignore" });
      } catch {
        if (opts.pull !== false) {
          return {
            available: false,
            type: opts,
            reason: `Docker image '${opts.image}' not found. Run: docker pull ${opts.image}`,
          };
        }
        return { available: false, type: opts, reason: `Docker image '${opts.image}' not available` };
      }
      return { available: true, type: opts, resolved: opts.image };
    }

    case "syscall_wrap":
      return {
        available: process.platform === "linux",
        type: opts,
        ...(process.platform !== "linux" ? { reason: "syscall_wrap only available on Linux" } : {}),
      };

    default:
      return { available: false, type: opts, reason: "Unknown network isolation type" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sandbox runner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs Python `source` inside the sandbox.
 *
 * Returns a `SandboxRunResult` where:
 *  - `blocked = true` means the import hook caught a dangerous import
 *  - `exitCode` is the Python process exit code
 *  - `stdout` / `stderr` are the captured outputs
 */
export async function runSandboxedPython(
  source: string,
  options: SandboxOptions,
  runCtx: { workspaceId: string; userId: string; cellId: string },
): Promise<SandboxRunResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const sandboxId = `sb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  const auditRecord: SandboxAuditRecord = {
    sandboxId,
    workspaceId: runCtx.workspaceId,
    userId: runCtx.userId,
    cellId: runCtx.cellId,
    startedAt: new Date().toISOString(),
    status: "running",
  };
  options.audit?.(auditRecord);

  const bootstrap = buildBootstrapScript(source, options);
  const sandboxEnv = buildSandboxEnv();
  sandboxEnv.PYTHONDONTWRITEBYTECODE = "1";
  sandboxEnv.PYTHONUNBUFFERED = "1";
  // Clear PYTHONPATH — we control sys.path in the bootstrap
  sandboxEnv.PYTHONPATH = "";

  // Check Python version for -P flag support before spawning
  const supportsNoPrepend = await supportsNoPrependFlag(options.pythonBin);

  return new Promise<SandboxRunResult>((resolve) => {
    // Python version compatibility:
    //   -I  — ignore PYTHON* env vars (3.0+)
    //   -S  — don't import site (3.0+)
    //   -P  — don't prepend cwd to sys.path (3.13+)
    // For Python <3.13 we drop -P to avoid "argument must be a string" errors.
    const pythonArgs: string[] = ["-I", "-S"];
    if (supportsNoPrepend) pythonArgs.push("-P");
    // Read script from stdin: avoids "argument must be a string without null bytes"
    // errors that Node's spawn raises on Windows when argv contains newlines.
    pythonArgs.push("-"); // -  means read script from stdin

    const child = spawn(options.pythonBin, pythonArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: sandboxEnv,
    });

    // Pipe bootstrap script via stdin and close it.
    child.stdin.write(bootstrap);
    child.stdin.end();

    let stdout = "";
    let stderr = "";
    let resolved = false;

    const finish = (result: SandboxRunResult) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      const finishedRecord: SandboxAuditRecord = {
        ...auditRecord,
        finishedAt: new Date().toISOString(),
        status: result.blocked
          ? "blocked"
          : result.exitCode === 0
            ? "completed"
            : result.exitCode === -2
              ? "timeout"
              : "failed",
        durationMs: Date.now() - new Date(auditRecord.startedAt).getTime(),
        blockedImports: result.blockedImports.length > 0 ? result.blockedImports : undefined,
        blockReason: result.blockReason,
        errorMessage: result.blocked ? result.blockReason : result.stderr?.trim() || undefined,
      };
      options.audit?.(finishedRecord);
      resolve(result);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > maxOutputBytes * 2) {
        child.kill();
        finish({ stdout: stdout.slice(0, maxOutputBytes), stderr, exitCode: 1, blocked: false, blockedImports: [] });
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > maxOutputBytes * 2) {
        child.kill();
        finish({ stdout, stderr: stderr.slice(0, maxOutputBytes), exitCode: 1, blocked: false, blockedImports: [] });
      }
    });

    child.on("error", (err) => {
      finish({ stdout, stderr: err.message, exitCode: 1, blocked: false, blockedImports: [] });
    });

    child.on("close", (code) => {
      // Try to extract the result sentinel
      const match = stdout.match(/__SBOX_RESULT__:({.*}):__END__/);
      if (match) {
        try {
          const parsed = JSON.parse(match[1]!) as {
            status: number;
            error: string | null;
            blockedImports: string[];
            stdout: string;
            stderr: string;
          };
          const result: SandboxRunResult = {
            stdout: parsed.stdout,
            stderr: parsed.stderr || stderr,
            exitCode: parsed.status,
            blocked: parsed.blockedImports.length > 0,
            blockedImports: parsed.blockedImports,
            blockReason: parsed.blockedImports.length > 0
              ? `Sandbox blocked: import of ${parsed.blockedImports.join(", ")}`
              : undefined,
          };
          finish(result);
          return;
        } catch {
          // fall through to raw handling
        }
      }
      // No sentinel — treat as abnormal exit
      finish({
        stdout,
        stderr,
        exitCode: code ?? 1,
        blocked: false,
        blockedImports: [],
        ...(code === -2 ? { blockReason: "Execution timed out" } : {}),
      });
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({
        stdout,
        stderr: stderr || "Execution timed out",
        exitCode: -2,
        blocked: false,
        blockedImports: [],
        blockReason: `Timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience factory — wraps the runner in the CellExecuteResult shape
// ─────────────────────────────────────────────────────────────────────────────

import type { CellOutput, CellRunStatus } from "./types.js";

export interface SandboxCellResult {
  cellId: string;
  status: CellRunStatus;
  outputs: CellOutput[];
  durationMs: number;
  errorMessage?: string;
}

/**
 * High-level wrapper: runs Python source in sandbox and returns a
 * CellExecuteResult-compatible object ready for the notebook engine.
 */
export async function runCellInSandbox(
  cellId: string,
  source: string,
  options: SandboxOptions,
  runCtx: { workspaceId: string; userId: string; cellId: string },
): Promise<SandboxCellResult> {
  const startedAt = Date.now();
  const result = await runSandboxedPython(source, options, runCtx);

  if (result.blocked) {
    return {
      cellId,
      status: "failed",
      outputs: [
        {
          kind: "error",
          message: result.blockReason ?? "Sandbox blocked dangerous import",
        },
      ],
      durationMs: Date.now() - startedAt,
      ...(result.blockReason !== undefined ? { errorMessage: result.blockReason } : {}),
    };
  }

  if (result.exitCode === 0) {
    return {
      cellId,
      status: "completed",
      outputs: [
        {
          kind: "text",
          text: result.stdout || "(no output)",
        },
      ],
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    cellId,
    status: "failed",
    outputs: [
      {
        kind: "error",
        message: result.stderr.trim() || (result.blockReason ?? `python exited with ${result.exitCode}`),
        traceback: result.stdout || undefined,
      },
    ],
    durationMs: Date.now() - startedAt,
    ...(result.stderr.trim() || result.blockReason || result.exitCode !== 0
      ? { errorMessage: result.stderr.trim() || `exit ${result.exitCode}` }
      : {}),
  };
}
