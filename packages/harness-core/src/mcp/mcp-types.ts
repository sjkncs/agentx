/**
 * MCP Types - Model Context Protocol 类型定义
 * 
 * 实现了 MCP 协议的核心类型，用于工具/资源/提示的对接
 * 
 * 基于 MCP 2024-11-05 规范
 */

import { z } from "zod";

// ============================================================================
// Protocol Constants
// ============================================================================

/**
 * MCP 协议版本
 */
export const MCP_PROTOCOL_VERSION = "2024-11-05";

/**
 * JSON-RPC 版本
 */
export const JSON_RPC_VERSION = "2.0";

// ============================================================================
// JSON-RPC Types
// ============================================================================

/**
 * JSON-RPC 请求
 */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: unknown;
}

/**
 * JSON-RPC 响应
 */
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

/**
 * JSON-RPC 通知 (无响应)
 */
export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

/**
 * JSON-RPC 错误
 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * 标准 JSON-RPC 错误码
 */
export const JsonRpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // MCP-specific
  REQUEST_CANCELLED: -32800,
} as const;

// ============================================================================
// MCP Methods
// ============================================================================

/**
 * MCP 标准方法
 */
export const MCPMethods = {
  INITIALIZE: "initialize",
  PING: "ping",
  TOOLS_LIST: "tools/list",
  TOOLS_CALL: "tools/call",
  RESOURCES_LIST: "resources/list",
  RESOURCES_READ: "resources/read",
  RESOURCES_SUBSCRIBE: "resources/subscribe",
  PROMPTS_LIST: "prompts/list",
  PROMPTS_GET: "prompts/get",
  COMPLETION_COMPLETE: "completion/complete",
  LOGGING_SET_LEVEL: "logging/setLevel",
  NOTIFICATIONS_INITIALIZED: "notifications/initialized",
  NOTIFICATIONS_PROGRESS: "notifications/progress",
  NOTIFICATIONS_MESSAGE: "notifications/message",
  NOTIFICATIONS_RESOURCES_LIST_CHANGED: "notifications/resources/list_changed",
  NOTIFICATIONS_RESOURCES_UPDATED: "notifications/resources/updated",
} as const;

// ============================================================================
// Initialize Types
// ============================================================================

/**
 * 客户端能力
 */
export interface ClientCapabilities {
  experimental?: Record<string, unknown>;
  sampling?: Record<string, unknown>;
  roots?: {
    listChanged?: boolean;
  };
}

/**
 * 服务器能力
 */
export interface ServerCapabilities {
  experimental?: Record<string, unknown>;
  logging?: Record<string, unknown>;
  prompts?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
  tools?: {
    listChanged?: boolean;
  };
}

/**
 * Initialize 参数
 */
export interface InitializeParams {
  protocolVersion: string;
  capabilities: ClientCapabilities;
  clientInfo: ImplementationInfo;
}

/**
 * Initialize 结果
 */
export interface InitializeResult {
  protocolVersion: string;
  capabilities: ServerCapabilities;
  serverInfo: ImplementationInfo;
  instructions?: string;
}

/**
 * 实现信息
 */
export interface ImplementationInfo {
  name: string;
  version: string;
}

// ============================================================================
// Tool Types
// ============================================================================

/**
 * MCP 工具定义
 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: McpToolInputSchema;
  annotations?: ToolAnnotations;
}

/**
 * 工具输入 schema (JSON Schema)
 */
export interface McpToolInputSchema {
  type: "object";
  properties?: Record<string, McpSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

/**
 * JSON Schema 属性
 */
export interface McpSchemaProperty {
  type: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  items?: McpSchemaProperty;
  properties?: Record<string, McpSchemaProperty>;
  required?: string[];
  [key: string]: unknown;
}

/**
 * 工具注释
 */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * 工具调用参数
 */
export interface CallToolParams {
  name: string;
  arguments?: Record<string, unknown>;
}

/**
 * 工具调用结果
 */
export interface CallToolResult {
  content: ToolContent[];
  isError?: boolean;
}

/**
 * 工具内容
 */
export type ToolContent =
  | TextContent
  | ImageContent
  | EmbeddedResource
  | AudioContent;

/**
 * 文本内容
 */
export interface TextContent {
  type: "text";
  text: string;
  annotations?: ToolAnnotations;
}

/**
 * 图片内容
 */
export interface ImageContent {
  type: "image";
  data: string; // base64-encoded
  mimeType: string;
  annotations?: ToolAnnotations;
}

/**
 * 音频内容
 */
export interface AudioContent {
  type: "audio";
  data: string; // base64-encoded
  mimeType: string;
}

/**
 * 嵌入资源
 */
export interface EmbeddedResource {
  type: "resource";
  resource: ResourceContents;
  annotations?: ToolAnnotations;
}

// ============================================================================
// Resource Types
// ============================================================================

/**
 * MCP 资源
 */
export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  annotations?: ResourceAnnotations;
}

/**
 * 资源注释
 */
export interface ResourceAnnotations {
  audience?: ("user" | "assistant")[];
  priority?: number;
}

/**
 * 资源内容
 */
export interface ResourceContents {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string; // base64-encoded
}

/**
 * 读取资源参数
 */
export interface ReadResourceParams {
  uri: string;
}

/**
 * 读取资源结果
 */
export interface ReadResourceResult {
  contents: ResourceContents[];
}

/**
 * 订阅参数
 */
export interface SubscribeParams {
  uri: string;
}

/**
 * 取消订阅参数
 */
export interface UnsubscribeParams {
  uri: string;
}

// ============================================================================
// Prompt Types
// ============================================================================

/**
 * MCP 提示
 */
export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
}

/**
 * 提示参数
 */
export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

/**
 * 读取提示参数
 */
export interface GetPromptParams {
  name: string;
  arguments?: Record<string, string>;
}

/**
 * 读取提示结果
 */
export interface GetPromptResult {
  description?: string;
  messages: PromptMessage[];
}

/**
 * 提示消息
 */
export interface PromptMessage {
  role: "user" | "assistant";
  content: ToolContent;
}

// ============================================================================
// Logging Types
// ============================================================================

/**
 * 日志级别
 */
export type LogLevel = "debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency";

/**
 * 设置日志级别参数
 */
export interface SetLevelParams {
  level: LogLevel;
}

/**
 * 日志消息通知
 */
export interface LoggingMessageNotification {
  level: LogLevel;
  logger?: string;
  data: unknown;
}

// ============================================================================
// Progress Types
// ============================================================================

/**
 * 进度通知
 */
export interface ProgressNotification {
  progressToken: string | number;
  progress: number;
  total?: number;
  message?: string;
}

// ============================================================================
// Completion Types
// ============================================================================

/**
 * 自动补全参数
 */
export interface CompleteParams {
  ref: PromptReference | ResourceReference;
  argument: {
    name: string;
    value: string;
  };
}

/**
 * 提示引用
 */
export interface PromptReference {
  type: "ref/prompt";
  name: string;
}

/**
 * 资源引用
 */
export interface ResourceReference {
  type: "ref/resource";
  uri: string;
}

/**
 * 自动补全结果
 */
export interface CompleteResult {
  completion: {
    values: string[];
    total?: number;
    hasMore?: boolean;
  };
}

// ============================================================================
// Transport Types
// ============================================================================

/**
 * 传输类型
 */
export type McpTransportType = "stdio" | "http" | "websocket" | "in-process";

/**
 * 传输配置
 */
export type McpTransportConfig =
  | StdioTransportConfig
  | HttpTransportConfig
  | WebSocketTransportConfig
  | InProcessTransportConfig;

/**
 * 标准输入输出传输配置
 */
export interface StdioTransportConfig {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * HTTP 传输配置
 */
export interface HttpTransportConfig {
  type: "http";
  endpoint: string;
  headers?: Record<string, string>;
  apiKey?: string;
}

/**
 * WebSocket 传输配置
 */
export interface WebSocketTransportConfig {
  type: "websocket";
  endpoint: string;
  protocols?: string[];
  headers?: Record<string, string>;
}

/**
 * 进程内传输配置
 */
export interface InProcessTransportConfig {
  type: "in-process";
  server: McpServerLike;
}

// ============================================================================
// Server Types
// ============================================================================

/**
 * MCP 服务器接口 (最小)
 */
export interface McpServerLike {
  listTools?(): Promise<{ tools: McpTool[] }>;
  callTool?(params: CallToolParams): Promise<CallToolResult>;
  listResources?(): Promise<{ resources: McpResource[] }>;
  readResource?(params: ReadResourceParams): Promise<ReadResourceResult>;
  listPrompts?(): Promise<{ prompts: McpPrompt[] }>;
  getPrompt?(params: GetPromptParams): Promise<GetPromptResult>;
}

// ============================================================================
// Server Configuration
// ============================================================================

/**
 * MCP 服务器配置
 */
export interface McpServerConfig {
  /** 服务器名称 */
  name: string;
  /** 服务器版本 */
  version: string;
  /** 传输配置 */
  transport: McpTransportConfig;
  /** 工具配置 */
  tools?: McpToolDefinition[];
  /** 资源配置 */
  resources?: McpResourceDefinition[];
  /** 提示配置 */
  prompts?: McpPromptDefinition[];
  /** 是否启用 */
  enabled?: boolean;
}

/**
 * 工具定义 (服务端)
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: McpToolInputSchema | z.ZodType<unknown>;
  handler: (params: unknown) => Promise<CallToolResult>;
}

/**
 * 资源定义 (服务端)
 */
export interface McpResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  handler: (uri: string) => Promise<ResourceContents>;
  subscribe?: boolean;
}

/**
 * 提示定义 (服务端)
 */
export interface McpPromptDefinition {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
  handler: (args?: Record<string, string>) => Promise<GetPromptResult>;
}

// ============================================================================
// Client Configuration
// ============================================================================

/**
 * MCP 客户端配置
 */
export interface McpClientConfig {
  /** 客户端名称 */
  name: string;
  /** 客户端版本 */
  version: string;
  /** 服务器配置列表 */
  servers: Array<{
    name: string;
    transport: McpTransportConfig;
    autoConnect?: boolean;
  }>;
  /** 超时 (ms) */
  timeout?: number;
}

// ============================================================================
// Errors
// ============================================================================

export class McpError extends Error {
  constructor(
    message: string,
    public readonly code: number = JsonRpcErrorCode.INTERNAL_ERROR,
    public readonly data?: unknown
  ) {
    super(message);
    this.name = "McpError";
  }
}

export class McpConnectionError extends McpError {
  constructor(message: string, data?: unknown) {
    super(message, JsonRpcErrorCode.INTERNAL_ERROR, data);
    this.name = "McpConnectionError";
  }
}

export class McpProtocolError extends McpError {
  constructor(message: string, data?: unknown) {
    super(message, JsonRpcErrorCode.INVALID_REQUEST, data);
    this.name = "McpProtocolError";
  }
}

export class McpToolNotFoundError extends McpError {
  constructor(toolName: string) {
    super(`Tool not found: ${toolName}`, JsonRpcErrorCode.METHOD_NOT_FOUND);
    this.name = "McpToolNotFoundError";
  }
}