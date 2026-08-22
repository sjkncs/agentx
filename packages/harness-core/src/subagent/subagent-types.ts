/**
 * Subagent Types - 子代理编排核心类型
 * 
 * 支持:
 * - Fork/Resume/Parallel 子代理
 * - 多代理协调
 * - 父子代理通信
 */

import { z } from "zod";

// ============================================================================
// Subagent Status
// ============================================================================

/**
 * 子代理状态
 */
export type SubagentStatus =
  | "initializing"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout";

/**
 * 子代理类型/角色
 */
export type SubagentRole =
  | "worker"
  | "researcher"
  | "coder"
  | "reviewer"
  | "tester"
  | "planner"
  | "executor"
  | "custom";

// ============================================================================
// Subagent Configuration
// ============================================================================

/**
 * 子代理配置
 */
export interface SubagentConfig {
  /** 子代理 ID (可选，自动生成) */
  id?: string;
  /** 子代理角色 */
  role: SubagentRole;
  /** 子代理名称 */
  name?: string;
  /** 任务提示 */
  prompt: string;
  /** 父代理 ID */
  parentId?: string;
  /** 隔离级别 */
  isolation?: SubagentIsolation;
  /** 超时 (ms) */
  timeout?: number;
  /** 模型配置 */
  model?: SubagentModelConfig;
  /** 工具配置 */
  tools?: SubagentToolConfig;
  /** 系统提示 */
  systemPrompt?: string;
  /** 上下文 */
  context?: Record<string, unknown>;
  /** 元数据 */
  metadata?: Record<string, unknown>;
  /** 标签 */
  tags?: string[];
  /** Fork 来源 (从哪个会话 fork) */
  forkFromSessionId?: string;
  /** Resume 来源 */
  resumeFromSubagentId?: string;
}

/**
 * 子代理隔离级别
 */
export type SubagentIsolation =
  | "shared"      // 共享父代理上下文
  | "fork"        // Fork 上下文
  | "isolated"    // 完全隔离
  | "sandboxed";  // 沙箱隔离

/**
 * 子代理模型配置
 */
export interface SubagentModelConfig {
  /** 模型名称 */
  name: string;
  /** 温度 */
  temperature?: number;
  /** 最大 token */
  maxTokens?: number;
  /** Top-P */
  topP?: number;
}

/**
 * 子代理工具配置
 */
export interface SubagentToolConfig {
  /** 允许的工具 */
  allowed?: string[];
  /** 禁止的工具 */
  forbidden?: string[];
  /** 是否允许工具调用 */
  canMakeNetworkCalls?: boolean;
  /** 是否允许读取文件 */
  canReadFiles?: boolean;
  /** 是否允许写入文件 */
  canWriteFiles?: boolean;
}

// ============================================================================
// Subagent Run
// ============================================================================

/**
 * 子代理运行
 */
export interface SubagentRun {
  /** 运行 ID */
  id: string;
  /** 子代理 ID */
  subagentId: string;
  /** 会话 ID */
  sessionId: string;
  /** 父运行 ID */
  parentRunId?: string;
  /** 状态 */
  status: SubagentStatus;
  /** 开始时间 */
  startedAt: number;
  /** 结束时间 */
  endedAt?: number;
  /** 持续时间 (ms) */
  duration?: number;
  /** 执行步骤 */
  steps: SubagentStep[];
  /** 结果 */
  result?: SubagentResult;
  /** 错误 */
  error?: string;
  /** 进度 (0-100) */
  progress?: number;
  /** 消耗的 token */
  tokensUsed?: {
    input: number;
    output: number;
  };
}

/**
 * 子代理步骤
 */
export interface SubagentStep {
  /** 步骤 ID */
  id: string;
  /** 步骤类型 */
  type: "llm" | "tool" | "reasoning" | "message" | "completed";
  /** 输入 */
  input?: unknown;
  /** 输出 */
  output?: unknown;
  /** 开始时间 */
  startedAt: number;
  /** 结束时间 */
  endedAt?: number;
  /** 错误 */
  error?: string;
}

/**
 * 子代理结果
 */
export interface SubagentResult<T = unknown> {
  /** 是否成功 */
  success: boolean;
  /** 结果数据 */
  data?: T;
  /** 错误信息 */
  error?: string;
  /** 执行时间 (ms) */
  duration: number;
  /** 总结 */
  summary?: string;
  /** 输出文件/资源 */
  artifacts?: Array<{
    type: "file" | "code" | "report";
    name: string;
    content?: string;
    url?: string;
  }>;
}

// ============================================================================
// Orchestration
// ============================================================================

/**
 * 编排模式
 */
export type OrchestrationMode =
  | "sequential"   // 顺序执行
  | "parallel"     // 并行执行
  | "pipeline"     // 流水线
  | "fan-out";     // 分发-收集

/**
 * 编排任务定义
 */
export interface OrchestrationTask {
  /** 任务 ID */
  id: string;
  /** 任务名称 */
  name: string;
  /** 子代理配置 */
  subagent: SubagentConfig;
  /** 依赖的任务 */
  dependsOn?: string[];
  /** 输入上下文 */
  input?: Record<string, unknown>;
  /** 期望输出 schema */
  outputSchema?: z.ZodType<unknown>;
  /** 任务权重 */
  weight?: number;
  /** 重试次数 */
  retries?: number;
}

/**
 * 编排定义
 */
export interface Orchestration {
  /** 编排 ID */
  id: string;
  /** 编排名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 执行模式 */
  mode: OrchestrationMode;
  /** 任务列表 */
  tasks: OrchestrationTask[];
  /** 全局上下文 */
  context?: Record<string, unknown>;
  /** 超时 (ms) */
  timeout?: number;
  /** 失败策略 */
  onFailure?: "abort" | "continue" | "retry";
}

/**
 * 编排结果
 */
export interface OrchestrationResult {
  /** 编排 ID */
  orchestrationId: string;
  /** 是否成功 */
  success: boolean;
  /** 各任务结果 */
  taskResults: Record<string, SubagentResult>;
  /** 执行时间 (ms) */
  duration: number;
  /** 完成的任务 */
  completedTasks: string[];
  /** 失败的任务 */
  failedTasks: string[];
  /** 全局输出 */
  output?: Record<string, unknown>;
}

// ============================================================================
// Messaging
// ============================================================================

/**
 * 消息类型
 */
export type MessageType =
  | "request"
  | "response"
  | "notification"
  | "broadcast"
  | "ping"
  | "pong";

/**
 * 子代理消息
 */
export interface SubagentMessage {
  /** 消息 ID */
  id: string;
  /** 源子代理 */
  fromId: string;
  /** 目标子代理 (broadcast 时为空) */
  toId?: string;
  /** 消息类型 */
  type: MessageType;
  /** 主题 */
  subject: string;
  /** 消息体 */
  payload: unknown;
  /** 关联 ID (request/response 对应) */
  correlationId?: string;
  /** 时间戳 */
  timestamp: number;
}

// ============================================================================
// Errors
// ============================================================================

export class SubagentError extends Error {
  constructor(
    message: string,
    public readonly subagentId?: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = "SubagentError";
  }
}

export class SubagentSpawnError extends SubagentError {
  constructor(subagentId: string, message: string) {
    super(`Failed to spawn subagent ${subagentId}: ${message}`, subagentId, "SPAWN_ERROR");
    this.name = "SubagentSpawnError";
  }
}

export class SubagentTimeoutError extends SubagentError {
  constructor(subagentId: string, timeout: number) {
    super(
      `Subagent ${subagentId} timed out after ${timeout}ms`,
      subagentId,
      "TIMEOUT"
    );
    this.name = "SubagentTimeoutError";
  }
}

export class SubagentNotFoundError extends SubagentError {
  constructor(subagentId: string) {
    super(`Subagent ${subagentId} not found`, subagentId, "NOT_FOUND");
    this.name = "SubagentNotFoundError";
  }
}

export class OrchestrationError extends SubagentError {
  constructor(orchestrationId: string, message: string) {
    super(
      `Orchestration ${orchestrationId} failed: ${message}`,
      orchestrationId,
      "ORCHESTRATION_ERROR"
    );
    this.name = "OrchestrationError";
  }
}

// ============================================================================
// Manager Configuration
// ============================================================================

/**
 * 子代理管理器配置
 */
export interface SubagentManagerConfig {
  /** 最大并发子代理数 */
  maxConcurrent?: number;
  /** 默认超时 (ms) */
  defaultTimeout?: number;
  /** 是否自动清理已完成 */
  autoCleanup?: boolean;
  /** 历史保留时间 (ms) */
  historyRetentionMs?: number;
  /** 默认隔离级别 */
  defaultIsolation?: SubagentIsolation;
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * 子代理统计
 */
export interface SubagentStats {
  totalSpawned: number;
  currentlyRunning: number;
  completed: number;
  failed: number;
  byRole: Record<string, number>;
  totalDuration: number;
  averageDuration: number;
  totalTokensUsed: number;
}
