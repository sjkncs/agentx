/**
 * Runtime System - 多运行时支持核心类型
 * 
 * 支持:
 * - Local Runtime: Node.js 沙箱执行
 * - Remote Runtime: 远程 API 调用
 * - Enterprise Runtime: 企业级自定义后端
 */

import { z } from "zod";

// ============================================================================
// Runtime Types
// ============================================================================

/**
 * 运行时类型
 */
export type RuntimeType = "local" | "remote" | "enterprise";

/**
 * 运行时能力
 */
export interface RuntimeCapabilities {
  /** 支持代码执行 */
  canExecuteCode: boolean;
  /** 支持文件系统访问 */
  canAccessFileSystem: boolean;
  /** 支持网络请求 */
  canMakeNetworkRequests: boolean;
  /** 支持环境变量 */
  canAccessEnvironmentVariables: boolean;
  /** 支持进程管理 */
  canSpawnProcesses: boolean;
  /** 最大内存 (MB) */
  maxMemoryMB?: number;
  /** 超时限制 (ms) */
  timeoutLimit?: number;
}

/**
 * 运行时状态
 */
export type RuntimeStatus = 
  | "idle"
  | "starting"
  | "ready"
  | "busy"
  | "stopping"
  | "stopped"
  | "error";

/**
 * 执行结果
 */
export interface ExecutionResult<T = unknown> {
  /** 是否成功 */
  success: boolean;
  /** 执行结果 */
  result?: T;
  /** 错误信息 */
  error?: string;
  /** 执行时间 (ms) */
  duration: number;
  /** 内存使用 (MB) */
  memoryUsageMB?: number;
  /** 消耗的 token 数 */
  tokensUsed?: number;
}

/**
 * 会话信息
 */
export interface SessionInfo {
  /** 会话 ID */
  sessionId: string;
  /** 运行时类型 */
  runtimeType: RuntimeType;
  /** 状态 */
  status: RuntimeStatus;
  /** 创建时间 */
  createdAt: number;
  /** 最后活动 */
  lastActivity: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Local Runtime Types
// ============================================================================

/**
 * Local Runtime 配置
 */
export interface LocalRuntimeConfig {
  /** 工作目录 */
  workingDirectory?: string;
  /** 环境变量 */
  environment?: Record<string, string>;
  /** 最大内存 (MB) */
  maxMemoryMB?: number;
  /** 执行超时 (ms) */
  timeout?: number;
  /** 是否启用调试 */
  debug?: boolean;
  /** 允许的 Node.js 版本 */
  nodeVersion?: string;
  /** 额外的 npm 包 */
  extraPackages?: string[];
  /** 禁止的模块 */
  blockedModules?: string[];
}

/**
 * Local Runtime 执行请求
 */
export interface LocalExecutionRequest {
  /** 代码 */
  code: string;
  /** 语言 */
  language: "javascript" | "typescript" | "python";
  /** 上下文 */
  context?: Record<string, unknown>;
  /** 超时 (ms) */
  timeout?: number;
  /** 是否需要网络 */
  requireNetwork?: boolean;
}

/**
 * Local Runtime 执行结果
 */
export interface LocalExecutionResult extends ExecutionResult {
  /** 标准输出 */
  stdout?: string;
  /** 标准错误 */
  stderr?: string;
  /** 退出码 */
  exitCode?: number;
}

// ============================================================================
// Remote Runtime Types
// ============================================================================

/**
 * Remote Runtime 配置
 */
export interface RemoteRuntimeConfig {
  /** API 端点 */
  endpoint: string;
  /** API 密钥 */
  apiKey?: string;
  /** 超时 (ms) */
  timeout?: number;
  /** 重试次数 */
  retries?: number;
  /** 区域 */
  region?: string;
}

/**
 * Remote Runtime 执行请求
 */
export interface RemoteExecutionRequest {
  /** 代码 */
  code: string;
  /** 语言 */
  language: string;
  /** 上下文 */
  context?: Record<string, unknown>;
  /** 优先级 */
  priority?: "low" | "normal" | "high";
}

/**
 * Remote Runtime 执行结果
 */
export interface RemoteExecutionResult extends ExecutionResult {
  /** 实例 ID */
  instanceId?: string;
  /** 输出 */
  output?: string;
  /** 日志 */
  logs?: string[];
}

// ============================================================================
// Enterprise Runtime Types
// ============================================================================

/**
 * Enterprise Runtime 配置
 */
export interface EnterpriseRuntimeConfig {
  /** 后端类型 */
  backend: "kubernetes" | "docker" | "aws-lambda" | "custom";
  /** 连接字符串 */
  connectionString: string;
  /** 认证信息 */
  auth?: {
    type: "api-key" | "oauth2" | "mtls";
    credentials: Record<string, string>;
  };
  /** 资源限制 */
  resources?: {
    cpu?: string;
    memory?: string;
    replicas?: number;
  };
  /** 网络策略 */
  networkPolicy?: {
    ingress?: string[];
    egress?: string[];
  };
}

// ============================================================================
// Runtime Manager Types
// ============================================================================

/**
 * 运行时配置联合类型
 */
export type AnyRuntimeConfig = 
  | LocalRuntimeConfig
  | RemoteRuntimeConfig
  | EnterpriseRuntimeConfig;

/**
 * 运行时实例
 */
export interface RuntimeInstance<Config = unknown> {
  /** 实例 ID */
  readonly id: string;
  /** 运行时类型 */
  readonly type: RuntimeType;
  /** 配置 */
  readonly config: Config;
  /** 状态 */
  status: RuntimeStatus;
  /** 能力 */
  readonly capabilities: RuntimeCapabilities;
  /** 启动时间 */
  readonly startedAt?: number;
  
  /** 初始化 */
  initialize(): Promise<void>;
  
  /** 启动 */
  start(): Promise<void>;
  
  /** 停止 */
  stop(): Promise<void>;
  
  /** 执行代码 */
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
  
  /** 获取会话信息 */
  getSession(): SessionInfo;
  
  /** 清理资源 */
  dispose(): Promise<void>;
}

/**
 * 执行请求
 */
export interface ExecutionRequest {
  /** 代码 */
  code: string;
  /** 语言 */
  language: string;
  /** 上下文 */
  context?: Record<string, unknown>;
  /** 超时 */
  timeout?: number;
  /** 会话 ID */
  sessionId?: string;
}

// ============================================================================
// Runtime Registry Types
// ============================================================================

/**
 * 运行时注册表配置
 */
export interface RuntimeRegistryConfig {
  /** 默认运行时类型 */
  defaultType: RuntimeType;
  /** 默认配置 */
  defaultConfig?: AnyRuntimeConfig;
  /** 是否自动启动 */
  autoStart?: boolean;
  /** 最大实例数 */
  maxInstances?: number;
}

/**
 * 路由策略
 */
export type RoutingStrategy = 
  | "random"
  | "round-robin"
  | "least-loaded"
  | "capability-based";

/**
 * 路由规则
 */
export interface RoutingRule {
  /** 规则名称 */
  name: string;
  /** 匹配条件 */
  match: (request: ExecutionRequest) => boolean;
  /** 目标运行时类型 */
  runtimeType: RuntimeType;
  /** 目标配置 */
  config?: AnyRuntimeConfig;
  /** 优先级 (数字越小优先级越高) */
  priority: number;
}

// ============================================================================
// Runtime Errors
// ============================================================================

export class RuntimeError extends Error {
  constructor(
    message: string,
    public readonly runtimeId?: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}

export class RuntimeInitError extends RuntimeError {
  constructor(runtimeId: string, message: string) {
    super(`Failed to initialize runtime ${runtimeId}: ${message}`, runtimeId, "INIT_ERROR");
    this.name = "RuntimeInitError";
  }
}

export class RuntimeExecutionError extends RuntimeError {
  constructor(
    runtimeId: string,
    message: string,
    public readonly originalError?: Error
  ) {
    super(`Execution error in runtime ${runtimeId}: ${message}`, runtimeId, "EXECUTION_ERROR");
    this.name = "RuntimeExecutionError";
  }
}

export class RuntimeTimeoutError extends RuntimeError {
  constructor(runtimeId: string, timeout: number) {
    super(`Execution timeout in runtime ${runtimeId} after ${timeout}ms`, runtimeId, "TIMEOUT");
    this.name = "RuntimeTimeoutError";
  }
}

export class RuntimeNotAvailableError extends RuntimeError {
  constructor(runtimeId: string) {
    super(`Runtime ${runtimeId} is not available`, runtimeId, "NOT_AVAILABLE");
    this.name = "RuntimeNotAvailableError";
  }
}

// ============================================================================
// Execution Schemas (Zod)
// ============================================================================

export const ExecutionRequestSchema = z.object({
  code: z.string(),
  language: z.string(),
  context: z.record(z.string(), z.unknown()).optional(),
  timeout: z.number().optional(),
  sessionId: z.string().optional(),
});

export const LocalRuntimeConfigSchema = z.object({
  workingDirectory: z.string().optional(),
  environment: z.record(z.string(), z.string()).optional(),
  maxMemoryMB: z.number().optional(),
  timeout: z.number().optional(),
  debug: z.boolean().optional(),
  nodeVersion: z.string().optional(),
  extraPackages: z.array(z.string()).optional(),
  blockedModules: z.array(z.string()).optional(),
});

export const RemoteRuntimeConfigSchema = z.object({
  endpoint: z.string().url(),
  apiKey: z.string().optional(),
  timeout: z.number().optional(),
  retries: z.number().optional(),
  region: z.string().optional(),
});

export const EnterpriseRuntimeConfigSchema = z.object({
  backend: z.enum(["kubernetes", "docker", "aws-lambda", "custom"]),
  connectionString: z.string(),
  auth: z.object({
    type: z.enum(["api-key", "oauth2", "mtls"]),
    credentials: z.record(z.string(), z.string()),
  }).optional(),
  resources: z.object({
    cpu: z.string().optional(),
    memory: z.string().optional(),
    replicas: z.number().optional(),
  }).optional(),
  networkPolicy: z.object({
    ingress: z.array(z.string()).optional(),
    egress: z.array(z.string()).optional(),
  }).optional(),
});
