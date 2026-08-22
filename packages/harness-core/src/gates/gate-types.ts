/**
 * Deterministic Gate Types - 确定性门控类型
 * 
 * 支持:
 * - Lint Gate (代码质量)
 * - Test Gate (测试通过)
 * - Type Check Gate (类型检查)
 * - Build Gate (构建成功)
 * - Custom Gate (自定义)
 * - Retry Limits
 * - Composite Gates (组合门控)
 */

// ============================================================================
// Gate Type
// ============================================================================

/**
 * 门控类型
 */
export type GateType =
  | "lint"             // 代码检查
  | "test"             // 测试
  | "typecheck"        // 类型检查
  | "build"            // 构建
  | "format"           // 格式化
  | "security"         // 安全扫描
  | "coverage"         // 覆盖率
  | "review"           // 代码审查
  | "custom"           // 自定义
  | "composite";       // 组合门控

/**
 * 门控状态
 */
export type GateStatus =
  | "pending"     // 待执行
  | "running"     // 执行中
  | "passed"      // 通过
  | "failed"      // 失败
  | "skipped"     // 跳过
  | "error";      // 错误

// ============================================================================
// Gate Result
// ============================================================================

/**
 * 门控严重性
 */
export type GateSeverity = "info" | "warning" | "error" | "critical";

/**
 * 门控问题
 */
export interface GateIssue {
  /** 问题严重性 */
  severity: GateSeverity;
  /** 问题消息 */
  message: string;
  /** 文件路径 */
  file?: string;
  /** 行号 */
  line?: number;
  /** 列号 */
  column?: number;
  /** 规则 ID */
  rule?: string;
  /** 修复建议 */
  fix?: string;
}

/**
 * 门控执行结果
 */
export interface GateResult {
  /** 门控 ID */
  gateId: string;
  /** 门控名称 */
  gateName: string;
  /** 门控类型 */
  gateType: GateType;
  /** 状态 */
  status: GateStatus;
  /** 是否通过 */
  passed: boolean;
  /** 消息 */
  message: string;
  /** 问题列表 */
  issues: GateIssue[];
  /** 执行时间 (ms) */
  duration: number;
  /** 开始时间 */
  startedAt: number;
  /** 结束时间 */
  endedAt: number;
  /** 输出 */
  output?: string;
  /** 错误 */
  error?: string;
  /** 重试次数 */
  retries?: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Gate Definition
// ============================================================================

/**
 * 门控配置
 */
export interface GateConfig {
  /** 门控 ID */
  id?: string;
  /** 门控名称 */
  name: string;
  /** 门控类型 */
  type: GateType;
  /** 描述 */
  description?: string;
  /** 是否必需 */
  required?: boolean;
  /** 是否启用 */
  enabled?: boolean;
  /** 超时 (ms) */
  timeout?: number;
  /** 重试次数 */
  retries?: number;
  /** 重试间隔 (ms) */
  retryDelay?: number;
  /** 命令 */
  command?: string;
  /** 参数 */
  args?: string[];
  /** 工作目录 */
  cwd?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 文件模式 */
  files?: string[];
  /** 严格度 */
  severity?: GateSeverity;
  /** 阈值 */
  threshold?: number;
  /** 失败时是否继续 */
  continueOnFailure?: boolean;
  /** 跳过条件 */
  skipIf?: (context: GateContext) => boolean | Promise<boolean>;
}

/**
 * 门控上下文
 */
export interface GateContext {
  /** 工作目录 */
  workdir: string;
  /** 变更的文件 */
  files?: string[];
  /** 提交信息 */
  commit?: {
    hash: string;
    message: string;
    author: string;
  };
  /** 环境 */
  env?: Record<string, string>;
  /** 上下文数据 */
  data?: Record<string, unknown>;
  /** 之前的门控结果 */
  previousResults?: GateResult[];
}

/**
 * 门控执行器
 */
export type GateExecutor = (
  config: GateConfig,
  context: GateContext,
) => Promise<GateResult>;

// ============================================================================
// Composite Gate
// ============================================================================

/**
 * 组合模式
 */
export type CompositeMode = "all" | "any" | "majority";

/**
 * 组合门控
 */
export interface CompositeGateConfig extends GateConfig {
  type: "composite";
  mode?: CompositeMode;
  gates: GateConfig[];
  executor?: GateExecutor;
}

// ============================================================================
// Pipeline
// ============================================================================

/**
 * 门控管道
 */
export interface GatePipeline {
  /** 管道 ID */
  id: string;
  /** 管道名称 */
  name: string;
  /** 门控列表 */
  gates: GateConfig[];
  /** 全局失败时是否继续 */
  continueOnFailure?: boolean;
  /** 并行执行 */
  parallel?: boolean;
}

/**
 * 管道执行结果
 */
export interface PipelineResult {
  /** 管道 ID */
  pipelineId: string;
  /** 管道名称 */
  pipelineName: string;
  /** 是否通过 */
  passed: boolean;
  /** 开始时间 */
  startedAt: number;
  /** 结束时间 */
  endedAt: number;
  /** 持续时间 */
  duration: number;
  /** 各门控结果 */
  gateResults: GateResult[];
  /** 失败的门控 */
  failedGates: string[];
  /** 跳过的门控 */
  skippedGates: string[];
  /** 总问题数 */
  totalIssues: number;
}

// ============================================================================
// Errors
// ============================================================================

export class GateError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "GateError";
  }
}

export class GateExecutionError extends GateError {
  constructor(gateId: string, message: string) {
    super(`Gate ${gateId} execution failed: ${message}`, "EXECUTION_ERROR");
    this.name = "GateExecutionError";
  }
}

export class GateTimeoutError extends GateError {
  constructor(gateId: string, timeout: number) {
    super(`Gate ${gateId} timed out after ${timeout}ms`, "TIMEOUT");
    this.name = "GateTimeoutError";
  }
}

// ============================================================================
// Manager
// ============================================================================

/**
 * 门控管理器配置
 */
export interface GateManagerConfig {
  /** 最大并发 */
  maxConcurrent?: number;
  /** 默认超时 */
  defaultTimeout?: number;
  /** 默认重试次数 */
  defaultRetries?: number;
  /** 是否在失败时停止 */
  stopOnFailure?: boolean;
  /** 默认工作目录 */
  defaultWorkdir?: string;
}

// ============================================================================
// Statistics
// ============================================================================

/**
 * 门控统计
 */
export interface GateStatistics {
  totalGates: number;
  passed: number;
  failed: number;
  skipped: number;
  errored: number;
  byType: Record<GateType, { passed: number; failed: number; skipped: number }>;
  averageDuration: number;
  totalRetries: number;
}