/**
 * Sandbox Types - 沙箱隔离类型
 * 
 * 支持:
 * - Process 沙箱 (子进程隔离)
 * - VM 沙箱 (Node VM)
 * - Docker 沙箱 (容器隔离)
 * - WebContainer 沙箱 (浏览器端)
 * - 权限控制
 * - 资源限制
 */

// ============================================================================
// Sandbox Type
// ============================================================================

/**
 * 沙箱类型
 */
export type SandboxType =
  | "process"      // 子进程隔离
  | "vm"           // Node.js VM
  | "docker"       // Docker 容器
  | "webcontainer" // 浏览器 WebContainer
  | "wasm"         // WebAssembly
  | "none";        // 不隔离

// ============================================================================
// Permission
// ============================================================================

/**
 * 文件权限
 */
export interface FilePermission {
  /** 路径模式 (glob) */
  pattern: string;
  /** 是否允许读 */
  read: boolean;
  /** 是否允许写 */
  write: boolean;
  /** 是否允许执行 */
  execute: boolean;
}

/**
 * 网络权限
 */
export interface NetworkPermission {
  /** 主机模式 */
  host: string;
  /** 端口 */
  port?: number;
  /** 协议 */
  protocol?: "http" | "https" | "ws" | "wss" | "*";
}

/**
 * 环境变量权限
 */
export interface EnvPermission {
  /** 变量名模式 */
  pattern: string;
  /** 是否允许访问 */
  allowed: boolean;
}

/**
 * 沙箱权限
 */
export interface SandboxPermissions {
  /** 文件权限 */
  files?: FilePermission[];
  /** 网络权限 */
  network?: NetworkPermission[];
  /** 环境变量权限 */
  env?: EnvPermission[];
  /** 是否允许子进程 */
  allowSubprocess?: boolean;
  /** 是否允许网络访问 */
  allowNetwork?: boolean;
  /** 是否允许文件系统写入 */
  allowWrite?: boolean;
  /** 是否允许执行 shell */
  allowShell?: boolean;
  /** 是否允许加载原生模块 */
  allowNativeModules?: boolean;
}

// ============================================================================
// Resource Limits
// ============================================================================

/**
 * 资源限制
 */
export interface SandboxResourceLimits {
  /** 最大内存 (MB) */
  maxMemoryMB?: number;
  /** 最大 CPU 核心数 */
  maxCpuCores?: number;
  /** 最大执行时间 (ms) */
  maxExecutionTimeMs?: number;
  /** 最大文件描述符数 */
  maxFileDescriptors?: number;
  /** 最大子进程数 */
  maxProcesses?: number;
  /** 最大磁盘写入 (MB) */
  maxDiskWriteMB?: number;
  /** 最大网络流量 (MB) */
  maxNetworkTrafficMB?: number;
}

// ============================================================================
// Sandbox Configuration
// ============================================================================

/**
 * 沙箱配置
 */
export interface SandboxConfig {
  /** 沙箱 ID */
  id?: string;
  /** 沙箱类型 */
  type: SandboxType;
  /** 名称 */
  name?: string;
  /** 镜像 (Docker/WebContainer) */
  image?: string;
  /** 入口 */
  entry?: string;
  /** 工作目录 */
  workdir?: string;
  /** 权限 */
  permissions?: SandboxPermissions;
  /** 资源限制 */
  limits?: SandboxResourceLimits;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 挂载点 */
  mounts?: Array<{
    source: string;
    target: string;
    readonly?: boolean;
  }>;
  /** 启动命令 */
  command?: string;
  /** 命令参数 */
  args?: string[];
  /** 网络模式 */
  networkMode?: "bridge" | "host" | "none" | "custom";
  /** 是否只读根文件系统 */
  readonlyRootfs?: boolean;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Sandbox Execution
// ============================================================================

/**
 * 执行请求
 */
export interface SandboxExecutionRequest {
  /** 代码 */
  code?: string;
  /** 命令 */
  command?: string;
  /** 参数 */
  args?: string[];
  /** 输入 */
  input?: unknown;
  /** 超时 (ms) */
  timeout?: number;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 工作目录 */
  cwd?: string;
  /** stdin */
  stdin?: string;
}

/**
 * 执行结果
 */
export interface SandboxExecutionResult {
  /** 是否成功 */
  success: boolean;
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 退出码 */
  exitCode: number;
  /** 执行时间 (ms) */
  duration: number;
  /** 资源使用 */
  resourceUsage?: {
    memoryMB: number;
    cpuPercent: number;
    diskWriteMB: number;
    networkTrafficMB: number;
  };
  /** 错误信息 */
  error?: string;
  /** 是否超时 */
  timedOut?: boolean;
  /** 是否被终止 */
  killed?: boolean;
}

/**
 * 沙箱状态
 */
export type SandboxStatus =
  | "created"
  | "starting"
  | "running"
  | "stopped"
  | "paused"
  | "error"
  | "destroyed";

/**
 * 沙箱信息
 */
export interface SandboxInfo {
  id: string;
  type: SandboxType;
  name?: string;
  status: SandboxStatus;
  createdAt: number;
  startedAt?: number;
  stoppedAt?: number;
  config: SandboxConfig;
  pid?: number;
  containerId?: string;
}

// ============================================================================
// Errors
// ============================================================================

export class SandboxError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "SandboxError";
  }
}

export class SandboxStartError extends SandboxError {
  constructor(sandboxId: string, message: string) {
    super(`Failed to start sandbox ${sandboxId}: ${message}`, "START_ERROR");
    this.name = "SandboxStartError";
  }
}

export class SandboxExecutionError extends SandboxError {
  constructor(sandboxId: string, message: string) {
    super(`Execution failed in sandbox ${sandboxId}: ${message}`, "EXECUTION_ERROR");
    this.name = "SandboxExecutionError";
  }
}

export class SandboxTimeoutError extends SandboxError {
  constructor(sandboxId: string, timeout: number) {
    super(
      `Sandbox ${sandboxId} timed out after ${timeout}ms`,
      "TIMEOUT"
    );
    this.name = "SandboxTimeoutError";
  }
}

export class PermissionDeniedError extends SandboxError {
  constructor(action: string) {
    super(`Permission denied: ${action}`, "PERMISSION_DENIED");
    this.name = "PermissionDeniedError";
  }
}

// ============================================================================
// Sandbox Manager
// ============================================================================

/**
 * 沙箱管理器配置
 */
export interface SandboxManagerConfig {
  /** 最大沙箱数 */
  maxSandboxes?: number;
  /** 默认资源限制 */
  defaultLimits?: SandboxResourceLimits;
  /** 默认权限 */
  defaultPermissions?: SandboxPermissions;
  /** 默认沙箱类型 */
  defaultType?: SandboxType;
  /** 自动清理间隔 (ms) */
  cleanupInterval?: number;
}