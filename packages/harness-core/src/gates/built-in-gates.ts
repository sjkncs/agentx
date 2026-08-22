/**
 * Built-in Gates - 内置门控实现
 * 
 * 提供开箱即用的门控:
 * - Lint Gate
 * - Test Gate
 * - Type Check Gate
 * - Build Gate
 * - Format Gate
 * - Coverage Gate
 * - Composite Gate
 */

import { spawn } from "node:child_process";
import path from "node:path";
import type {
  GateConfig,
  GateContext,
  GateResult,
  GateIssue,
  GateStatus,
  GateExecutor,
  CompositeGateConfig,
  CompositeMode,
} from "./gate-types.js";
import {
  GateExecutionError,
  GateTimeoutError,
} from "./gate-types.js";

// ============================================================================
// Shell Executor (Base)
// ============================================================================

/**
 * Shell 命令执行结果
 */
interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * 执行 shell 命令
 */
async function executeShell(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeout: number,
): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: true,
    });
    
    let stdout = "";
    let stderr = "";
    
    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new GateTimeoutError(command, timeout));
    }, timeout);
    
    proc.on("exit", (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? -1,
      });
    });
    
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ============================================================================
// Lint Gate
// ============================================================================

/**
 * Lint 门控执行器
 */
export const lintGateExecutor: GateExecutor = async (
  config: GateConfig,
  context: GateContext,
) => {
  const startedAt = Date.now();
  const timeout = config.timeout || 60000;
  const command = config.command || "npx";
  const args = config.args || ["eslint", ".", "--format", "json"];
  
  try {
    const result = await executeShell(
      command,
      args,
      config.cwd || context.workdir,
      config.env || {},
      timeout,
    );
    
    const issues = parseLintOutput(result.stdout);
    const passed = result.exitCode === 0 && issues.length === 0;
    
    return {
      gateId: config.id || "lint",
      gateName: config.name,
      gateType: "lint",
      status: passed ? "passed" : "failed",
      passed,
      message: passed ? "Lint passed" : `Found ${issues.length} lint issues`,
      issues,
      duration: Date.now() - startedAt,
      startedAt,
      endedAt: Date.now(),
      output: result.stdout + result.stderr,
    };
  } catch (err) {
    return {
      gateId: config.id || "lint",
      gateName: config.name,
      gateType: "lint",
      status: "error",
      passed: false,
      message: `Lint failed: ${err instanceof Error ? err.message : String(err)}`,
      issues: [],
      duration: Date.now() - startedAt,
      startedAt,
      endedAt: Date.now(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

/**
 * 解析 lint 输出
 */
function parseLintOutput(output: string): GateIssue[] {
  try {
    const json = JSON.parse(output);
    const issues: GateIssue[] = [];
    
    for (const fileResult of json) {
      for (const message of fileResult.messages || []) {
        issues.push({
          severity: message.severity === 2 ? "error" : "warning",
          message: message.message,
          file: fileResult.filePath,
          line: message.line,
          column: message.column,
          rule: message.ruleId,
        });
      }
    }
    
    return issues;
  } catch {
    return [];
  }
}

// ============================================================================
// Test Gate
// ============================================================================

/**
 * Test 门控执行器
 */
export const testGateExecutor: GateExecutor = async (
  config: GateConfig,
  context: GateContext,
) => {
  const startedAt = Date.now();
  const timeout = config.timeout || 300000;
  const command = config.command || "npm";
  const args = config.args || ["test"];
  
  try {
    const result = await executeShell(
      command,
      args,
      config.cwd || context.workdir,
      config.env || {},
      timeout,
    );
    
    const passed = result.exitCode === 0;
    
    // Try to extract test stats
    const stats = extractTestStats(result.stdout + result.stderr);
    
    return {
      gateId: config.id || "test",
      gateName: config.name,
      gateType: "test",
      status: passed ? "passed" : "failed",
      passed,
      message: passed
        ? `All tests passed${stats ? ` (${stats.passed}/${stats.total})` : ""}`
        : `Tests failed${stats ? ` (${stats.failed} failed, ${stats.passed} passed)` : ""}`,
      issues: [],
      duration: Date.now() - startedAt,
      startedAt,
      endedAt: Date.now(),
      output: result.stdout + result.stderr,
      metadata: stats || undefined,
    };
  } catch (err) {
    return {
      gateId: config.id || "test",
      gateName: config.name,
      gateType: "test",
      status: "error",
      passed: false,
      message: `Tests failed: ${err instanceof Error ? err.message : String(err)}`,
      issues: [],
      duration: Date.now() - startedAt,
      startedAt,
      endedAt: Date.now(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

/**
 * 提取测试统计
 */
function extractTestStats(output: string): { passed: number; failed: number; total: number } | null {
  // Try Jest format
  const jestMatch = output.match(/Tests:\s*(\d+)\s*passed,\s*(\d+)\s*total/);
  if (jestMatch) {
    return {
      passed: parseInt(jestMatch[1]),
      failed: 0,
      total: parseInt(jestMatch[2]),
    };
  }
  
  const jestFailMatch = output.match(/Tests:\s*(\d+)\s*failed,\s*(\d+)\s*passed,\s*(\d+)\s*total/);
  if (jestFailMatch) {
    return {
      failed: parseInt(jestFailMatch[1]),
      passed: parseInt(jestFailMatch[2]),
      total: parseInt(jestFailMatch[3]),
    };
  }
  
  // Try Vitest format
  const vitestMatch = output.match(/(\d+)\s+passed.*?(\d+)\s+total/);
  if (vitestMatch) {
    return {
      passed: parseInt(vitestMatch[1]),
      failed: 0,
      total: parseInt(vitestMatch[2]),
    };
  }
  
  return null;
}

// ============================================================================
// Type Check Gate
// ============================================================================

/**
 * Type Check 门控执行器
 */
export const typeCheckGateExecutor: GateExecutor = async (
  config: GateConfig,
  context: GateContext,
) => {
  const startedAt = Date.now();
  const timeout = config.timeout || 120000;
  const command = config.command || "npx";
  const args = config.args || ["tsc", "--noEmit"];
  
  try {
    const result = await executeShell(
      command,
      args,
      config.cwd || context.workdir,
      config.env || {},
      timeout,
    );
    
    const passed = result.exitCode === 0;
    const issues = passed ? [] : parseTypeCheckOutput(result.stdout + result.stderr);
    
    return {
      gateId: config.id || "typecheck",
      gateName: config.name,
      gateType: "typecheck",
      status: passed ? "passed" : "failed",
      passed,
      message: passed
        ? "Type check passed"
        : `Found ${issues.length} type errors`,
      issues,
      duration: Date.now() - startedAt,
      startedAt,
      endedAt: Date.now(),
      output: result.stdout + result.stderr,
    };
  } catch (err) {
    return {
      gateId: config.id || "typecheck",
      gateName: config.name,
      gateType: "typecheck",
      status: "error",
      passed: false,
      message: `Type check failed: ${err instanceof Error ? err.message : String(err)}`,
      issues: [],
      duration: Date.now() - startedAt,
      startedAt,
      endedAt: Date.now(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

/**
 * 解析类型检查输出
 */
function parseTypeCheckOutput(output: string): GateIssue[] {
  const issues: GateIssue[] = [];
  
  // TypeScript error format: file.ts(line,col): error TS1234: message
  const regex = /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/gm;
  let match;
  
  while ((match = regex.exec(output)) !== null) {
    issues.push({
      severity: "error",
      file: match[1],
      line: parseInt(match[2]),
      column: parseInt(match[3]),
      rule: match[4],
      message: match[5],
    });
  }
  
  return issues;
}

// ============================================================================
// Build Gate
// ============================================================================

/**
 * Build 门控执行器
 */
export const buildGateExecutor: GateExecutor = async (
  config: GateConfig,
  context: GateContext,
) => {
  const startedAt = Date.now();
  const timeout = config.timeout || 300000;
  const command = config.command || "npm";
  const args = config.args || ["run", "build"];
  
  try {
    const result = await executeShell(
      command,
      args,
      config.cwd || context.workdir,
      config.env || {},
      timeout,
    );
    
    const passed = result.exitCode === 0;
    
    return {
      gateId: config.id || "build",
      gateName: config.name,
      gateType: "build",
      status: passed ? "passed" : "failed",
      passed,
      message: passed ? "Build succeeded" : "Build failed",
      issues: [],
      duration: Date.now() - startedAt,
      startedAt,
      endedAt: Date.now(),
      output: result.stdout + result.stderr,
    };
  } catch (err) {
    return {
      gateId: config.id || "build",
      gateName: config.name,
      gateType: "build",
      status: "error",
      passed: false,
      message: `Build failed: ${err instanceof Error ? err.message : String(err)}`,
      issues: [],
      duration: Date.now() - startedAt,
      startedAt,
      endedAt: Date.now(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

// ============================================================================
// Format Gate
// ============================================================================

/**
 * Format 门控执行器
 */
export const formatGateExecutor: GateExecutor = async (
  config: GateConfig,
  context: GateContext,
) => {
  const startedAt = Date.now();
  const timeout = config.timeout || 60000;
  const command = config.command || "npx";
  const args = config.args || ["prettier", "--check", "."];
  
  try {
    const result = await executeShell(
      command,
      args,
      config.cwd || context.workdir,
      config.env || {},
      timeout,
    );
    
    const passed = result.exitCode === 0;
    
    return {
      gateId: config.id || "format",
      gateName: config.name,
      gateType: "format",
      status: passed ? "passed" : "failed",
      passed,
      message: passed ? "Format check passed" : "Format check failed",
      issues: [],
      duration: Date.now() - startedAt,
      startedAt,
      endedAt: Date.now(),
      output: result.stdout + result.stderr,
    };
  } catch (err) {
    return {
      gateId: config.id || "format",
      gateName: config.name,
      gateType: "format",
      status: "error",
      passed: false,
      message: `Format check failed: ${err instanceof Error ? err.message : String(err)}`,
      issues: [],
      duration: Date.now() - startedAt,
      startedAt,
      endedAt: Date.now(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

// ============================================================================
// Coverage Gate
// ============================================================================

/**
 * Coverage 门控执行器
 */
export const coverageGateExecutor: GateExecutor = async (
  config: GateConfig,
  context: GateContext,
) => {
  const startedAt = Date.now();
  const timeout = config.timeout || 300000;
  const threshold = config.threshold || 80;
  const command = config.command || "npm";
  const args = config.args || ["test", "--", "--coverage"];
  
  try {
    const result = await executeShell(
      command,
      args,
      config.cwd || context.workdir,
      config.env || {},
      timeout,
    );
    
    // Try to extract coverage
    const coverage = extractCoverage(result.stdout + result.stderr);
    const passed = coverage !== null && coverage >= threshold;
    
    return {
      gateId: config.id || "coverage",
      gateName: config.name,
      gateType: "coverage",
      status: passed ? "passed" : "failed",
      passed,
      message: coverage !== null
        ? `Coverage: ${coverage.toFixed(2)}% (threshold: ${threshold}%)`
        : "Coverage not measured",
      issues: passed || coverage === null ? [] : [{
        severity: "warning",
        message: `Coverage ${coverage.toFixed(2)}% below threshold ${threshold}%`,
      }],
      duration: Date.now() - startedAt,
      startedAt,
      endedAt: Date.now(),
      output: result.stdout + result.stderr,
      metadata: { coverage, threshold },
    };
  } catch (err) {
    return {
      gateId: config.id || "coverage",
      gateName: config.name,
      gateType: "coverage",
      status: "error",
      passed: false,
      message: `Coverage failed: ${err instanceof Error ? err.message : String(err)}`,
      issues: [],
      duration: Date.now() - startedAt,
      startedAt,
      endedAt: Date.now(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

/**
 * 提取覆盖率
 */
function extractCoverage(output: string): number | null {
  // Try istanbul/jest format: "All files | 85.5 |"
  const match = output.match(/All files\s*\|\s*([\d.]+)/);
  if (match) {
    return parseFloat(match[1]);
  }
  
  // Try Vitest format
  const vitestMatch = output.match(/Coverage.*?(\d+(?:\.\d+)?)\s*%/);
  if (vitestMatch) {
    return parseFloat(vitestMatch[1]);
  }
  
  return null;
}

// ============================================================================
// Composite Gate
// ============================================================================

/**
 * Composite Gate 执行器
 */
export async function executeCompositeGate(
  config: CompositeGateConfig,
  context: GateContext,
  executors: Map<string, GateExecutor>,
): Promise<GateResult> {
  const startedAt = Date.now();
  const mode = config.mode || "all";
  
  const childResults: GateResult[] = [];
  
  for (const childConfig of config.gates) {
    const executor = executors.get(childConfig.type);
    if (!executor) continue;
    
    const result = await executor(childConfig, context);
    childResults.push(result);
  }
  
  // Aggregate
  let passed = false;
  switch (mode) {
    case "all":
      passed = childResults.every(r => r.passed);
      break;
    case "any":
      passed = childResults.some(r => r.passed);
      break;
    case "majority":
      const passedCount = childResults.filter(r => r.passed).length;
      passed = passedCount > childResults.length / 2;
      break;
  }
  
  const allIssues = childResults.flatMap(r => r.issues);
  
  return {
    gateId: config.id || "composite",
    gateName: config.name,
    gateType: "composite",
    status: passed ? "passed" : "failed",
    passed,
    message: passed
      ? `Composite gate (${mode}) passed: ${childResults.filter(r => r.passed).length}/${childResults.length}`
      : `Composite gate (${mode}) failed: ${childResults.filter(r => !r.passed).length}/${childResults.length}`,
    issues: allIssues,
    duration: Date.now() - startedAt,
    startedAt,
    endedAt: Date.now(),
    metadata: { mode, childResults },
  };
}

// ============================================================================
// Built-in Executor Map
// ============================================================================

/**
 * 内置门控执行器
 */
export const builtInExecutors: Map<string, GateExecutor> = new Map([
  ["lint", lintGateExecutor],
  ["test", testGateExecutor],
  ["typecheck", typeCheckGateExecutor],
  ["build", buildGateExecutor],
  ["format", formatGateExecutor],
  ["coverage", coverageGateExecutor],
]);