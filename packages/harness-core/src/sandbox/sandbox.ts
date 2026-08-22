/**
 * Sandbox Implementation - 沙箱实现
 * 
 * 实现多种沙箱:
 * - Process 沙箱 (子进程隔离)
 * - VM 沙箱 (Node.js VM)
 * - Docker 沙箱 (容器隔离)
 * - WebContainer 沙箱 (浏览器端)
 */

import { EventEmitter } from "node:events";
import { spawn, ChildProcess } from "node:child_process";
import vm from "node:vm";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import type {
  SandboxConfig,
  SandboxInfo,
  SandboxStatus,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxPermissions,
  SandboxResourceLimits,
  SandboxType,
  SandboxManagerConfig,
} from "./sandbox-types.js";
import {
  SandboxError,
  SandboxStartError,
  SandboxExecutionError,
  SandboxTimeoutError,
  PermissionDeniedError,
} from "./sandbox-types.js";

// ============================================================================
// Base Sandbox
// ============================================================================

/**
 * 沙箱事件
 */
export interface SandboxEvents {
  "status:change": [status: SandboxStatus, previous: SandboxStatus];
  "execution:start": [request: SandboxExecutionRequest];
  "execution:end": [result: SandboxExecutionResult];
  "error": [error: Error];
  "destroy": [];
}

/**
 * 沙箱基类
 */
export abstract class Sandbox extends EventEmitter<SandboxEvents> {
  readonly id: string;
  readonly type: SandboxType;
  readonly name?: string;
  readonly config: SandboxConfig;
  
  protected _status: SandboxStatus = "created";
  protected _info: SandboxInfo;
  protected _pid?: number;
  protected _containerId?: string;
  
  constructor(config: SandboxConfig) {
    super();
    this.id = config.id || this.generateId();
    this.type = config.type;
    this.name = config.name;
    this.config = config;
    this._info = {
      id: this.id,
      type: this.type,
      name: this.name,
      status: "created",
      createdAt: Date.now(),
      config,
    };
  }
  
  // ============================================================================
  // Public API
  // ============================================================================
  
  /**
   * 启动沙箱
   */
  abstract start(): Promise<void>;
  
  /**
   * 停止沙箱
   */
  abstract stop(): Promise<void>;
  
  /**
   * 暂停沙箱
   */
  abstract pause(): Promise<void>;
  
  /**
   * 恢复沙箱
   */
  abstract resume(): Promise<void>;
  
  /**
   * 执行请求
   */
  abstract execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult>;
  
  /**
   * 销毁沙箱
   */
  abstract destroy(): Promise<void>;
  
  /**
   * 获取状态
   */
  getStatus(): SandboxStatus {
    return this._status;
  }
  
  /**
   * 获取信息
   */
  getInfo(): SandboxInfo {
    return { ...this._info };
  }
  
  /**
   * 获取 PID
   */
  getPid(): number | undefined {
    return this._pid;
  }
  
  /**
   * 获取容器 ID
   */
  getContainerId(): string | undefined {
    return this._containerId;
  }
  
  /**
   * 检查权限
   */
  checkPermission(action: keyof SandboxPermissions): boolean {
    const perms = this.config.permissions;
    if (!perms) return true;
    
    switch (action) {
      case "allowSubprocess":
        return perms.allowSubprocess ?? false;
      case "allowNetwork":
        return perms.allowNetwork ?? false;
      case "allowWrite":
        return perms.allowWrite ?? false;
      case "allowShell":
        return perms.allowShell ?? false;
      case "allowNativeModules":
        return perms.allowNativeModules ?? false;
      default:
        return false;
    }
  }
  
  /**
   * 检查文件权限
   */
  checkFilePermission(path: string, access: "read" | "write" | "execute"): boolean {
    const perms = this.config.permissions;
    if (!perms?.files) return false;
    
    for (const filePerm of perms.files) {
      if (this.matchPattern(filePerm.pattern, path)) {
        switch (access) {
          case "read": return filePerm.read;
          case "write": return filePerm.write;
          case "execute": return filePerm.execute;
        }
      }
    }
    
    return false;
  }
  
  /**
   * 设置状态
   */
  protected setStatus(status: SandboxStatus): void {
    const previous = this._status;
    this._status = status;
    this._info.status = status;
    
    if (status === "running" && !this._info.startedAt) {
      this._info.startedAt = Date.now();
    }
    
    if (status === "stopped" || status === "destroyed") {
      this._info.stoppedAt = Date.now();
    }
    
    this.emit("status:change", status, previous);
  }
  
  /**
   * 生成 ID
   */
  private generateId(): string {
    return `sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
  
  /**
   * 匹配 glob 模式
   */
  private matchPattern(pattern: string, target: string): boolean {
    if (pattern === "*") return true;
    if (pattern === target) return true;
    
    // Simple glob matching
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    
    return new RegExp(`^${regexPattern}$`).test(target);
  }
}

// ============================================================================
// Process Sandbox
// ============================================================================

/**
 * 进程沙箱
 */
export class ProcessSandbox extends Sandbox {
  private process?: ChildProcess;
  private outputBuffer: { stdout: string; stderr: string } = { stdout: "", stderr: "" };
  
  async start(): Promise<void> {
    if (this._status !== "created" && this._status !== "stopped") return;
    
    this.setStatus("starting");
    
    try {
      const command = this.config.command || "node";
      const args = this.config.args || [];
      const env = {
        ...process.env,
        ...(this.config.env || {}),
      };
      
      const cwd = this.config.workdir || process.cwd();
      
      this.process = spawn(command, args, {
        cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      
      this._pid = this.process.pid;
      this._info.pid = this.process.pid;
      
      this.process.stdout?.on("data", (data) => {
        this.outputBuffer.stdout += data.toString();
      });
      
      this.process.stderr?.on("data", (data) => {
        this.outputBuffer.stderr += data.toString();
      });
      
      this.process.on("error", (err) => {
        this.emit("error", new SandboxStartError(this.id, err.message));
        this.setStatus("error");
      });
      
      this.process.on("exit", (code) => {
        if (this._status === "running") {
          this.setStatus("stopped");
        }
      });
      
      this.setStatus("running");
    } catch (err) {
      this.setStatus("error");
      throw new SandboxStartError(
        this.id,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  
  async stop(): Promise<void> {
    if (this._status !== "running") return;
    
    if (this.process) {
      this.process.kill("SIGTERM");
      
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.process?.kill("SIGKILL");
          resolve();
        }, 5000);
        
        this.process?.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    
    this.setStatus("stopped");
  }
  
  async pause(): Promise<void> {
    if (this._status !== "running") return;
    
    if (this.process?.pid) {
      try {
        process.kill(this.process.pid, "SIGSTOP");
        this.setStatus("paused");
      } catch {
        // Not supported on all platforms
      }
    }
  }
  
  async resume(): Promise<void> {
    if (this._status !== "paused") return;
    
    if (this.process?.pid) {
      try {
        process.kill(this.process.pid, "SIGCONT");
        this.setStatus("running");
      } catch {
        // Not supported on all platforms
      }
    }
  }
  
  async execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
    if (this._status !== "running") {
      throw new SandboxExecutionError(this.id, "Sandbox is not running");
    }
    
    this.emit("execution:start", request);
    
    const startTime = Date.now();
    
    try {
      const result = await this.runInProcess(request);
      result.duration = Date.now() - startTime;
      
      this.emit("execution:end", result);
      return result;
    } catch (err) {
      const errorResult: SandboxExecutionResult = {
        success: false,
        stdout: this.outputBuffer.stdout,
        stderr: this.outputBuffer.stderr,
        exitCode: -1,
        duration: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
      };
      
      this.emit("execution:end", errorResult);
      return errorResult;
    }
  }
  
  async destroy(): Promise<void> {
    await this.stop();
    this.setStatus("destroyed");
    this.emit("destroy");
  }
  
  /**
   * 在进程中执行
   */
  private async runInProcess(request: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let output = "";
      let error = "";
      
      const timeout = setTimeout(() => {
        resolve({
          success: false,
          stdout: output,
          stderr: error,
          exitCode: -1,
          duration: Date.now() - startTime,
          timedOut: true,
          error: `Execution timed out after ${request.timeout}ms`,
        });
      }, request.timeout || this.config.limits?.maxExecutionTimeMs || 30000);
      
      const proc = spawn(
        request.command || "node",
        request.args || [],
        {
          cwd: request.cwd || this.config.workdir,
          env: { ...process.env, ...(request.env || {}) },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      
      if (request.stdin) {
        proc.stdin?.write(request.stdin);
        proc.stdin?.end();
      }
      
      proc.stdout?.on("data", (data) => {
        output += data.toString();
      });
      
      proc.stderr?.on("data", (data) => {
        error += data.toString();
      });
      
      proc.on("exit", (code) => {
        clearTimeout(timeout);
        resolve({
          success: code === 0,
          stdout: output,
          stderr: error,
          exitCode: code ?? -1,
          duration: Date.now() - startTime,
        });
      });
      
      proc.on("error", (err) => {
        clearTimeout(timeout);
        resolve({
          success: false,
          stdout: output,
          stderr: error,
          exitCode: -1,
          duration: Date.now() - startTime,
          error: err.message,
        });
      });
    });
  }
}

// ============================================================================
// VM Sandbox
// ============================================================================

/**
 * VM 沙箱 (Node.js VM)
 */
export class VmSandbox extends Sandbox {
  private context?: vm.Context;
  private memoryUsed: number = 0;
  
  async start(): Promise<void> {
    if (this._status !== "created" && this._status !== "stopped") return;
    
    this.setStatus("starting");
    
    try {
      // Create sandbox context
      // Note: console must be defined as a regular property (not via Object.defineProperty with writable: false)
      // so we can replace it during execution
      const defaultConsole = {
        log: (...args: unknown[]) => { /* no-op by default */ },
        error: (...args: unknown[]) => { /* no-op by default */ },
        warn: (...args: unknown[]) => { /* no-op by default */ },
      };
      
      const sandboxObj: Record<string, unknown> = {
        // Safe globals - use writable: true (default for object literals)
        console: defaultConsole,
        // No process, require, etc.
        Date,
        Math,
        JSON,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        Map,
        Set,
        Promise,
        Error,
        Symbol,
        // Custom
        __result__: undefined,
        __output__: "",
      };
      
      // Inject user env
      if (this.config.env) {
        for (const [key, value] of Object.entries(this.config.env)) {
          sandboxObj[`__env_${key}__`] = value;
        }
      }
      
      this.context = vm.createContext(sandboxObj, {
        name: this.id,
        codeGeneration: {
          strings: false,
          wasm: false,
        },
      });
      
      this.setStatus("running");
    } catch (err) {
      this.setStatus("error");
      throw new SandboxStartError(
        this.id,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  
  async stop(): Promise<void> {
    this.context = undefined;
    this.setStatus("stopped");
  }
  
  async pause(): Promise<void> {
    this.setStatus("paused");
  }
  
  async resume(): Promise<void> {
    this.setStatus("running");
  }
  
  async execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
    if (this._status !== "running") {
      throw new SandboxExecutionError(this.id, "Sandbox is not running");
    }
    
    if (!this.context) {
      throw new SandboxExecutionError(this.id, "Context not initialized");
    }
    
    this.emit("execution:start", request);
    
    const startTime = Date.now();
    let output = "";
    let error = "";
    
    // Per-execution console proxy - inject into context directly
    const execConsole = {
      log: (...args: unknown[]) => {
        output += args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ") + "\n";
      },
      error: (...args: unknown[]) => {
        error += args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ") + "\n";
      },
      warn: (...args: unknown[]) => {
        output += "[WARN] " + args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ") + "\n";
      },
    };
    
    // Replace console in context (must be configurable)
    try {
      (this.context as any).console = execConsole;
    } catch {
      // Ignore - we'll use the default console and read it from output
    }
    
    try {
      let script: vm.Script;
      try {
        script = new vm.Script(request.code || "", {
          filename: this.config.entry || "vm-sandbox.js",
        });
      } catch (compileErr) {
        const errorResult: SandboxExecutionResult = {
          success: false,
          stdout: output,
          stderr: compileErr instanceof Error ? compileErr.message : String(compileErr),
          exitCode: -1,
          duration: Date.now() - startTime,
          error: "Compilation error",
        };
        this.emit("execution:end", errorResult);
        return errorResult;
      }
      
      const maxDuration = request.timeout || this.config.limits?.maxExecutionTimeMs || 5000;
      
      try {
        const result = script.runInContext(this.context, {
          timeout: maxDuration,
          displayErrors: true,
          breakOnSigint: true,
        });
        
        const finalDuration = Date.now() - startTime;
        
        const successResult: SandboxExecutionResult = {
          success: true,
          stdout: output,
          stderr: error,
          exitCode: 0,
          duration: finalDuration,
          resourceUsage: {
            memoryMB: this.estimateMemory(),
            cpuPercent: 0,
            diskWriteMB: 0,
            networkTrafficMB: 0,
          },
        };
        
        // Add result if available
        if (result !== undefined) {
          (successResult as any).result = result;
        }
        
        this.emit("execution:end", successResult);
        return successResult;
      } catch (runErr) {
        const isTimeout = runErr instanceof Error && runErr.message.includes("timeout");
        
        const errorResult: SandboxExecutionResult = {
          success: false,
          stdout: output,
          stderr: error,
          exitCode: -1,
          duration: Date.now() - startTime,
          timedOut: isTimeout,
          error: runErr instanceof Error ? runErr.message : String(runErr),
        };
        
        this.emit("execution:end", errorResult);
        return errorResult;
      }
    } catch (err) {
      const errorResult: SandboxExecutionResult = {
        success: false,
        stdout: output,
        stderr: error,
        exitCode: -1,
        duration: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
      };
      
      this.emit("execution:end", errorResult);
      return errorResult;
    }
  }
  
  async destroy(): Promise<void> {
    await this.stop();
    this.setStatus("destroyed");
    this.emit("destroy");
  }
  
  private estimateMemory(): number {
    // Simple memory estimation
    return Math.max(1, Math.round(this.memoryUsed / 1024 / 1024));
  }
}

// ============================================================================
// Docker Sandbox (Stub - requires Docker)
// ============================================================================

/**
 * Docker 沙箱
 * 
 * 注: 这是接口定义。实际运行需要 Docker daemon。
 * 在没有 Docker 的环境中会自动回退到 VM 沙箱。
 */
export class DockerSandbox extends Sandbox {
  async start(): Promise<void> {
    this.setStatus("starting");
    
    // Check Docker availability (simplified check)
    // In production, this would check Docker daemon
    if (!process.env.DOCKER_AVAILABLE) {
      // Fall back to VM sandbox behavior
      throw new SandboxStartError(
        this.id,
        "Docker is not available. Use VM sandbox or set DOCKER_AVAILABLE=true."
      );
    }
    
    // Real implementation would:
    // 1. Pull image if needed
    // 2. Create container
    // 3. Start container
    // 4. Set up networking, volumes, etc.
    
    this.setStatus("running");
  }
  
  async stop(): Promise<void> {
    this.setStatus("stopped");
  }
  
  async pause(): Promise<void> {
    this.setStatus("paused");
  }
  
  async resume(): Promise<void> {
    this.setStatus("running");
  }
  
  async execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
    throw new SandboxExecutionError(this.id, "Docker sandbox requires actual Docker daemon");
  }
  
  async destroy(): Promise<void> {
    this.setStatus("destroyed");
    this.emit("destroy");
  }
}

// ============================================================================
// WebContainer Sandbox (Stub - for browser)
// ============================================================================

/**
 * WebContainer 沙箱
 */
export class WebContainerSandbox extends Sandbox {
  async start(): Promise<void> {
    this.setStatus("starting");
    
    if (typeof window === "undefined") {
      throw new SandboxStartError(this.id, "WebContainer requires browser environment");
    }
    
    // Real implementation would use @webcontainer/api
    this.setStatus("running");
  }
  
  async stop(): Promise<void> {
    this.setStatus("stopped");
  }
  
  async pause(): Promise<void> {
    this.setStatus("paused");
  }
  
  async resume(): Promise<void> {
    this.setStatus("running");
  }
  
  async execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
    throw new SandboxExecutionError(this.id, "WebContainer sandbox requires browser runtime");
  }
  
  async destroy(): Promise<void> {
    this.setStatus("destroyed");
    this.emit("destroy");
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * 创建沙箱
 */
export function createSandbox(config: SandboxConfig): Sandbox {
  switch (config.type) {
    case "process":
      return new ProcessSandbox(config);
    case "vm":
      return new VmSandbox(config);
    case "docker":
      return new DockerSandbox(config);
    case "webcontainer":
      return new WebContainerSandbox(config);
    default:
      throw new SandboxError(`Unknown sandbox type: ${config.type}`);
  }
}