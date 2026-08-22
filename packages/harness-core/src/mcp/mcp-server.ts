/**
 * MCP Server - Model Context Protocol 服务端
 * 
 * 实现 MCP 服务器，可被客户端调用
 */

import { EventEmitter } from "node:events";
import type {
  McpServerConfig,
  McpTool,
  McpResource,
  McpPrompt,
  CallToolParams,
  CallToolResult,
  ReadResourceParams,
  ReadResourceResult,
  GetPromptParams,
  GetPromptResult,
  ImplementationInfo,
  ServerCapabilities,
  McpServerLike,
  MCP_PROTOCOL_VERSION,
} from "./mcp-types.js";
import {
  MCP_PROTOCOL_VERSION as MCP_VERSION,
} from "./mcp-types.js";

/**
 * MCP 服务器事件
 */
export interface McpServerEvents {
  "tool:registered": [tool: McpTool];
  "tool:called": [toolName: string, params: unknown, result: CallToolResult];
  "resource:read": [uri: string, result: ReadResourceResult];
  "prompt:get": [name: string, args: unknown, result: GetPromptResult];
  "error": [error: Error];
}

/**
 * MCP 服务器
 */
export class McpServer extends EventEmitter<McpServerEvents> implements McpServerLike {
  private config: McpServerConfig;
  private info: ImplementationInfo;
  private capabilities: ServerCapabilities;
  private tools: Map<string, McpTool> = new Map();
  private resources: Map<string, McpResource> = new Map();
  private prompts: Map<string, McpPrompt> = new Map();
  private toolHandlers: Map<string, (params: unknown) => Promise<CallToolResult>> = new Map();
  private resourceHandlers: Map<string, (uri: string) => Promise<ReadResourceResult>> = new Map();
  private promptHandlers: Map<string, (args?: Record<string, string>) => Promise<GetPromptResult>> = new Map();
  private started: boolean = false;
  
  constructor(config: McpServerConfig) {
    super();
    this.config = config;
    this.info = {
      name: config.name,
      version: config.version,
    };
    this.capabilities = {
      tools: { listChanged: true },
      resources: { subscribe: false, listChanged: false },
      prompts: { listChanged: false },
    };
  }
  
  // ============================================================================
  // Registration
  // ============================================================================
  
  /**
   * 注册工具
   */
  registerTool(
    name: string,
    description: string,
    inputSchema: McpTool["inputSchema"],
    handler: (params: unknown) => Promise<CallToolResult>
  ): void {
    const tool: McpTool = {
      name,
      description,
      inputSchema,
    };
    
    this.tools.set(name, tool);
    this.toolHandlers.set(name, handler);
    
    this.emit("tool:registered", tool);
  }
  
  /**
   * 注册资源
   */
  registerResource(
    uri: string,
    name: string,
    description: string | undefined,
    mimeType: string | undefined,
    handler: (uri: string) => Promise<ReadResourceResult>
  ): void {
    const resource: McpResource = {
      uri,
      name,
      description,
      mimeType,
    };
    
    this.resources.set(uri, resource);
    this.resourceHandlers.set(uri, handler);
    
    if (!this.capabilities.resources) {
      this.capabilities.resources = { subscribe: false, listChanged: false };
    }
  }
  
  /**
   * 注册提示
   */
  registerPrompt(
    name: string,
    description: string | undefined,
    arguments_: McpPrompt["arguments"] | undefined,
    handler: (args?: Record<string, string>) => Promise<GetPromptResult>
  ): void {
    const prompt: McpPrompt = {
      name,
      description,
      arguments: arguments_,
    };
    
    this.prompts.set(name, prompt);
    this.promptHandlers.set(name, handler);
  }
  
  /**
   * 注销工具
   */
  unregisterTool(name: string): boolean {
    const removed = this.tools.delete(name);
    this.toolHandlers.delete(name);
    return removed;
  }
  
  /**
   * 注销资源
   */
  unregisterResource(uri: string): boolean {
    const removed = this.resources.delete(uri);
    this.resourceHandlers.delete(uri);
    return removed;
  }
  
  /**
   * 注销提示
   */
  unregisterPrompt(name: string): boolean {
    const removed = this.prompts.delete(name);
    this.promptHandlers.delete(name);
    return removed;
  }
  
  // ============================================================================
  // McpServerLike Implementation
  // ============================================================================
  
  async listTools(): Promise<{ tools: McpTool[] }> {
    return {
      tools: Array.from(this.tools.values()),
    };
  }
  
  async callTool(params: CallToolParams): Promise<CallToolResult> {
    const handler = this.toolHandlers.get(params.name);
    if (!handler) {
      return {
        content: [
          {
            type: "text",
            text: `Tool not found: ${params.name}`,
          },
        ],
        isError: true,
      };
    }
    
    try {
      const result = await handler(params.arguments);
      this.emit("tool:called", params.name, params.arguments, result);
      return result;
    } catch (err) {
      const errorResult: CallToolResult = {
        content: [
          {
            type: "text",
            text: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
      return errorResult;
    }
  }
  
  async listResources(): Promise<{ resources: McpResource[] }> {
    return {
      resources: Array.from(this.resources.values()),
    };
  }
  
  async readResource(params: ReadResourceParams): Promise<ReadResourceResult> {
    // Try exact match first
    let handler = this.resourceHandlers.get(params.uri);
    
    // Try prefix match for templated URIs (e.g., file:///{path})
    if (!handler) {
      for (const [pattern, h] of this.resourceHandlers.entries()) {
        if (this.matchUri(pattern, params.uri)) {
          handler = h;
          break;
        }
      }
    }
    
    if (!handler) {
      return {
        contents: [],
      };
    }
    
    const result = await handler(params.uri);
    this.emit("resource:read", params.uri, result);
    return result;
  }
  
  async listPrompts(): Promise<{ prompts: McpPrompt[] }> {
    return {
      prompts: Array.from(this.prompts.values()),
    };
  }
  
  async getPrompt(params: GetPromptParams): Promise<GetPromptResult> {
    const handler = this.promptHandlers.get(params.name);
    if (!handler) {
      throw new Error(`Prompt not found: ${params.name}`);
    }
    
    const result = await handler(params.arguments);
    this.emit("prompt:get", params.name, params.arguments, result);
    return result;
  }
  
  // ============================================================================
  // Server Lifecycle
  // ============================================================================
  
  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    
    // Register predefined tools from config
    if (this.config.tools) {
      for (const tool of this.config.tools) {
        this.registerTool(
          tool.name,
          tool.description,
          tool.inputSchema as McpTool["inputSchema"],
          tool.handler
        );
      }
    }
    
    // Register predefined resources
    if (this.config.resources) {
      for (const resource of this.config.resources) {
        const userHandler = resource.handler;
        this.registerResource(
          resource.uri,
          resource.name,
          resource.description,
          resource.mimeType,
          async (uri: string) => {
            const contents = await userHandler(uri);
            return { contents: Array.isArray(contents) ? contents : [contents] };
          }
        );
      }
    }
    
    // Register predefined prompts
    if (this.config.prompts) {
      for (const prompt of this.config.prompts) {
        this.registerPrompt(
          prompt.name,
          prompt.description,
          prompt.arguments,
          prompt.handler
        );
      }
    }
  }
  
  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    this.started = false;
    this.tools.clear();
    this.resources.clear();
    this.prompts.clear();
    this.toolHandlers.clear();
    this.resourceHandlers.clear();
    this.promptHandlers.clear();
  }
  
  // ============================================================================
  // Information
  // ============================================================================
  
  /**
   * 获取服务器信息
   */
  getInfo(): ImplementationInfo {
    return { ...this.info };
  }
  
  /**
   * 获取能力
   */
  getCapabilities(): ServerCapabilities {
    return { ...this.capabilities };
  }
  
  /**
   * 获取协议版本
   */
  getProtocolVersion(): string {
    return MCP_VERSION;
  }
  
  // ============================================================================
  // Private
  // ============================================================================
  
  private matchUri(pattern: string, uri: string): boolean {
    // Simple wildcard matching for URIs
    // e.g., "file:///{path}" matches "file:///tmp/test.txt"
    
    if (pattern === uri) return true;
    
    const patternParts = pattern.split("/");
    const uriParts = uri.split("/");
    
    if (patternParts.length !== uriParts.length) return false;
    
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith("{")) continue;
      if (patternParts[i] !== uriParts[i]) return false;
    }
    
    return true;
  }
}

/**
 * 创建 MCP 服务器
 */
export function createMcpServer(config: McpServerConfig): McpServer {
  return new McpServer(config);
}

/**
 * 辅助函数：创建简单的文本结果
 */
export function textResult(text: string, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text }],
    isError,
  };
}

/**
 * 辅助函数：创建错误结果
 */
export function errorResult(message: string): CallToolResult {
  return textResult(message, true);
}