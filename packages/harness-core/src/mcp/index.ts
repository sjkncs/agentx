/**
 * MCP System - 导出
 */

export {
  // Transport
  McpTransport,
  StdioMcpTransport,
  HttpMcpTransport,
  WebSocketMcpTransport,
  InProcessMcpTransport,
  createMcpTransport,
  type TransportEvents,
} from "./mcp-transport.js";

export {
  McpClient,
  createMcpClient,
  type McpClientEvents,
} from "./mcp-client.js";

export {
  McpServer,
  createMcpServer,
  textResult,
  errorResult,
  type McpServerEvents,
} from "./mcp-server.js";

export {
  McpBridge,
  createMcpBridge,
  mcpToolToHarnessTool,
  harnessToolToMcpTool,
  registerHarnessToolsToMcpServer,
  type McpBridgeOptions,
} from "./mcp-bridge.js";

// Types
export {
  MCP_PROTOCOL_VERSION,
  JSON_RPC_VERSION,
  JsonRpcErrorCode,
  MCPMethods,
  
  // JSON-RPC
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcNotification,
  type JsonRpcError,
  
  // Initialize
  type ClientCapabilities,
  type ServerCapabilities,
  type InitializeParams,
  type InitializeResult,
  type ImplementationInfo,
  
  // Tools
  type McpTool,
  type McpToolInputSchema,
  type McpSchemaProperty,
  type ToolAnnotations,
  type CallToolParams,
  type CallToolResult,
  type ToolContent,
  type TextContent,
  type ImageContent,
  type AudioContent,
  type EmbeddedResource,
  
  // Resources
  type McpResource,
  type ResourceAnnotations,
  type ResourceContents,
  type ReadResourceParams,
  type ReadResourceResult,
  type SubscribeParams,
  type UnsubscribeParams,
  
  // Prompts
  type McpPrompt,
  type PromptArgument,
  type GetPromptParams,
  type GetPromptResult,
  type PromptMessage,
  
  // Logging
  type LogLevel,
  type SetLevelParams,
  type LoggingMessageNotification,
  
  // Progress
  type ProgressNotification,
  
  // Completion
  type CompleteParams,
  type PromptReference,
  type ResourceReference,
  type CompleteResult,
  
  // Transport
  type McpTransportType,
  type McpTransportConfig,
  type StdioTransportConfig,
  type HttpTransportConfig,
  type WebSocketTransportConfig,
  type InProcessTransportConfig,
  
  // Server
  type McpServerLike,
  type McpServerConfig,
  type McpToolDefinition,
  type McpResourceDefinition,
  type McpPromptDefinition,
  
  // Client
  type McpClientConfig,
  
  // Errors
  McpError,
  McpConnectionError,
  McpProtocolError,
  McpToolNotFoundError,
} from "./mcp-types.js";