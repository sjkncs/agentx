/**
 * Hook System Types for DataFoundry Harness
 * 
 * 生命周期Hook系统，借鉴 Claude Code 的 Hook 架构，
 * 但保持与现有 DataFoundry 系统的向后兼容。
 */

import { z } from "zod";

// ============================================================================
// Lifecycle Events
// ============================================================================

/**
 * Hook 生命周期事件类型
 */
export const HOOK_EVENTS = [
  // Agent Lifecycle
  "agent.start",
  "agent.end",
  
  // Turn Lifecycle
  "turn.start",
  "turn.end",
  "turn/stopping",
  
  // Step Lifecycle
  "step.start",
  "step.end",
  
  // Tool Lifecycle
  "tool.pre-execute",
  "tool.post-execute",
  "tool.error",
  
  // LLM Lifecycle
  "llm.request",
  "llm.response",
  "llm.error",
  
  // Context Lifecycle
  "context.compact",
  "context.inject",
  
  // Session Lifecycle
  "session.start",
  "session.end",
  "session.resume",
  "session.fork",
] as const;

export type HookEvent = typeof HOOK_EVENTS[number];

// ============================================================================
// Hook Action Types
// ============================================================================

/**
 * Shell 命令执行
 */
export const ShellHookActionSchema = z.object({
  type: z.literal("shell"),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  timeout: z.number().positive().optional().default(30000),
  cwd: z.string().optional(),
});

export type ShellHookAction = z.infer<typeof ShellHookActionSchema>;

/**
 * HTTP 请求
 */
export const HttpHookActionSchema = z.object({
  type: z.literal("http"),
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("POST"),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
  timeout: z.number().positive().optional().default(10000),
});

export type HttpHookAction = z.infer<typeof HttpHookActionSchema>;

/**
 * MCP 工具调用
 */
export const McpHookActionSchema = z.object({
  type: z.literal("mcp"),
  server: z.string().min(1),
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
});

export type McpHookAction = z.infer<typeof McpHookActionSchema>;

/**
 * Prompt 模板
 */
export const PromptHookActionSchema = z.object({
  type: z.literal("prompt"),
  template: z.string().min(1),
  inject: z.record(z.string(), z.string()).optional(),
});

export type PromptHookAction = z.infer<typeof PromptHookActionSchema>;

/**
 * Hook Action 联合类型
 */
export const HookActionSchema = z.discriminatedUnion("type", [
  ShellHookActionSchema,
  HttpHookActionSchema,
  McpHookActionSchema,
  PromptHookActionSchema,
]);

export type HookAction = z.infer<typeof HookActionSchema>;

// ============================================================================
// Hook Configuration
// ============================================================================

/**
 * Hook 过滤器
 */
export const HookFilterSchema = z.object({
  toolName: z.union([z.string(), z.array(z.string())]).optional(),
  toolPattern: z.string().optional(),
  filePattern: z.string().optional(),
  errorType: z.string().optional(),
  phase: z.string().optional(),
});

export type HookFilter = z.infer<typeof HookFilterSchema>;

/**
 * 单个 Hook 定义
 */
export const HookDefinitionSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(256).optional(),
  events: z.array(z.enum(HOOK_EVENTS)).min(1),
  action: HookActionSchema,
  filter: HookFilterSchema.optional(),
  order: z.number().int().optional(),
  enabled: z.boolean().optional(),
  timeout: z.number().positive().optional(),
  retry: z.object({
    maxAttempts: z.number().int().min(0).max(5).default(0),
    delay: z.number().positive().optional(),
  }).optional(),
});

export type HookDefinition = z.infer<typeof HookDefinitionSchema>;

/**
 * Hook 配置文件
 */
export const HookConfigSchema = z.object({
  hooks: z.array(HookDefinitionSchema),
  defaults: z.object({
    timeout: z.number().positive().optional(),
    enabled: z.boolean().optional(),
  }).optional(),
});

export type HookConfig = z.infer<typeof HookConfigSchema>;

// ============================================================================
// Hook Context
// ============================================================================

/**
 * Hook 执行上下文
 */
export interface HookContext {
  /** 事件类型 */
  event: HookEvent;
  
  /** 会话ID */
  sessionId: string;
  
  /** 运行ID */
  runId: string;
  
  /** Turn ID (如果存在) */
  turnId?: string;
  
  /** Step ID (如果存在) */
  stepId?: string;
  
  /** 负载数据 */
  payload: unknown;
  
  /** 工具名称 (如果与工具相关) */
  toolName?: string;
  
  /** 工具输入 (如果与工具相关) */
  toolInput?: unknown;
  
  /** 工具输出 (如果与工具相关) */
  toolOutput?: unknown;
  
  /** 错误信息 (如果与错误相关) */
  error?: string;
  
  /** 步骤索引 */
  stepIndex?: number;
  
  /** Agent 名称 */
  agentName?: string;
  
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/**
 * Hook 执行结果
 */
export interface HookResult {
  /** 是否成功 */
  success: boolean;
  
  /** 输出内容 */
  output?: string;
  
  /** 错误信息 */
  error?: string;
  
  /** 执行时间 (毫秒) */
  duration: number;
  
  /** 是否阻止后续执行 */
  blocked?: boolean;
  
  /** 阻塞消息 */
  blockMessage?: string;
  
  /** 附加输出 */
  attachments?: HookAttachment[];

  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * Hook 附件
 */
export interface HookAttachment {
  type: "text" | "file" | "json";
  name: string;
  content: string;
}

// ============================================================================
// Hook Bus Types
// ============================================================================

/**
 * Hook 监听器
 */
export interface HookListener {
  id: string;
  hookName: string;
  events: HookEvent[];
  handler: HookHandler;
  filter?: HookFilter;
  order: number;
}

/**
 * Hook 处理函数
 */
export type HookHandler = (
  context: HookContext
) => Promise<HookResult | void>;

// ============================================================================
// Event Mapping
// ============================================================================

/**
 * DataFoundry/Mastra 事件到 Hook 事件的映射
 */
export const EVENT_SOURCE_MAP: Record<string, HookEvent> = {
  // Agent 事件
  "agent.start": "agent.start",
  "agent.end": "agent.end",
  "agentStop": "agent.end",
  "agentStart": "agent.start",
  
  // Turn 事件
  "turnStart": "turn.start",
  "turnEnd": "turn.end",
  "turn/stopping": "turn/stopping",
  
  // Step 事件
  "stepStart": "step.start",
  "stepEnd": "step.end",
  
  // 工具 事件
  "beforeToolUse": "tool.pre-execute",
  "afterToolUse": "tool.post-execute",
  "toolError": "tool.error",
  
  // LLM 事件
  "beforeModelCall": "llm.request",
  "afterModelCall": "llm.response",
  "modelError": "llm.error",
  
  // 上下文事件
  "contextCompact": "context.compact",
  "contextInject": "context.inject",
  
  // Session 事件
  "sessionStart": "session.start",
  "sessionEnd": "session.end",
};

/**
 * 从原始事件创建 Hook Context
 */
export function createHookContext(
  sourceEvent: string,
  sourcePayload: unknown,
  defaults: Partial<HookContext> = {}
): HookContext {
  const hookEvent = EVENT_SOURCE_MAP[sourceEvent];
  
  return {
    event: hookEvent || ("session.start" as HookEvent),
    sessionId: defaults.sessionId || "",
    runId: defaults.runId || "",
    payload: sourcePayload,
    metadata: {},
    ...defaults,
  };
}
