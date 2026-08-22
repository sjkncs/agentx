/**
 * Cursor SDK Types - Cursor SDK 类型定义
 * 
 * 与 Cursor IDE 集成的类型
 * 基于 @cursor/sdk (TypeScript) 和 cursor-sdk (Python)
 */

// ============================================================================
// Cursor Context Types
// ============================================================================

/**
 * Cursor 文件上下文
 */
export interface CursorFileContext {
  /** 文件路径 */
  path: string;
  /** 文件内容 */
  content: string;
  /** 语言 */
  language: string;
  /** 是否已修改 */
  modified: boolean;
  /** 选择范围 */
  selection?: CursorSelection;
}

/**
 * 光标选择
 */
export interface CursorSelection {
  /** 起始行 */
  startLine: number;
  /** 起始列 */
  startColumn: number;
  /** 结束行 */
  endLine: number;
  /** 结束列 */
  endColumn: number;
}

/**
 * 光标位置
 */
export interface CursorPosition {
  /** 行号 */
  line: number;
  /** 列号 */
  column: number;
}

/**
 * IDE 上下文
 */
export interface CursorIdeContext {
  /** 工作空间 */
  workspace: string;
  /** 当前文件 */
  currentFile?: CursorFileContext;
  /** 打开的文件 */
  openFiles: CursorFileContext[];
  /** 项目信息 */
  project?: {
    name: string;
    root: string;
    framework?: string;
    dependencies?: Record<string, string>;
  };
  /** Git 信息 */
  git?: {
    branch: string;
    commit?: string;
    status?: string;
    diff?: string;
  };
  /** 光标位置 */
  cursor?: CursorPosition;
}

// ============================================================================
// Cursor Agent Types
// ============================================================================

/**
 * Cursor Agent 类型
 */
export type CursorAgentType = 
  | "chat"        // 聊天代理
  | "composer"    // 组合代理
  | "edit"        // 编辑代理
  | "cmd-k"       // 命令面板
  | "reviewer"    // 审查代理
  | "test"        // 测试代理
  | "custom";     // 自定义

/**
 * Cursor Agent 状态
 */
export type CursorAgentStatus =
  | "idle"
  | "thinking"
  | "streaming"
  | "tool-calling"
  | "completed"
  | "cancelled"
  | "error";

/**
 * Cursor Agent 请求
 */
export interface CursorAgentRequest {
  /** 提示 */
  prompt: string;
  /** 类型 */
  type: CursorAgentType;
  /** 上下文 */
  context?: Partial<CursorIdeContext>;
  /** 选区 */
  selection?: CursorSelection;
  /** 模型 */
  model?: string;
  /** 文件 */
  files?: string[];
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * Cursor Agent 响应
 */
export interface CursorAgentResponse {
  /** 响应 ID */
  id: string;
  /** Agent 类型 */
  type: CursorAgentType;
  /** 文本响应 */
  text: string;
  /** 代码变更 */
  edits?: CursorFileEdit[];
  /** 工具调用 */
  toolCalls?: CursorToolCall[];
  /** 状态 */
  status: CursorAgentStatus;
  /** 错误 */
  error?: string;
  /** 完成时间 */
  completedAt?: number;
}

/**
 * 文件编辑
 */
export interface CursorFileEdit {
  /** 文件路径 */
  path: string;
  /** 原始内容 */
  originalContent?: string;
  /** 新内容 */
  newContent: string;
  /** 编辑类型 */
  type: "replace" | "insert" | "delete" | "create";
  /** 行范围 */
  range?: CursorSelection;
}

/**
 * 工具调用
 */
export interface CursorToolCall {
  /** 工具名 */
  name: string;
  /** 参数 */
  arguments: Record<string, unknown>;
  /** 结果 */
  result?: unknown;
  /** 错误 */
  error?: string;
}

// ============================================================================
// Cursor SDK Stream Types
// ============================================================================

/**
 * Cursor 流事件类型
 */
export type CursorStreamEventType =
  | "start"
  | "text"
  | "edit"
  | "tool-call"
  | "tool-result"
  | "complete"
  | "error"
  | "cancelled";

/**
 * Cursor 流事件
 */
export interface CursorStreamEvent {
  type: CursorStreamEventType;
  /** 响应 ID */
  responseId?: string;
  /** 文本增量 */
  textDelta?: string;
  /** 文件编辑 */
  edit?: CursorFileEdit;
  /** 工具调用 */
  toolCall?: CursorToolCall;
  /** 工具结果 */
  toolResult?: unknown;
  /** 错误 */
  error?: string;
  /** 时间戳 */
  timestamp: number;
}

// ============================================================================
// Cursor SDK Errors
// ============================================================================

export class CursorSdkError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "CursorSdkError";
  }
}

export class CursorConnectionError extends CursorSdkError {
  constructor(message: string) {
    super(message, "CONNECTION_ERROR");
    this.name = "CursorConnectionError";
  }
}

export class CursorAgentError extends CursorSdkError {
  constructor(message: string) {
    super(message, "AGENT_ERROR");
    this.name = "CursorAgentError";
  }
}

// ============================================================================
// SDK Configuration
// ============================================================================

/**
 * Cursor SDK 配置
 */
export interface CursorSdkConfig {
  /** SDK 类型 */
  type: "local" | "cloud";
  /** API 密钥 (Cloud) */
  apiKey?: string;
  /** 端点 (Cloud) */
  endpoint?: string;
  /** 工作空间路径 (Local) */
  workspace?: string;
  /** 客户端信息 */
  clientInfo: {
    name: string;
    version: string;
  };
  /** 默认模型 */
  defaultModel?: string;
  /** 超时 (ms) */
  timeout?: number;
}