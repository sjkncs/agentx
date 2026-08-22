/**
 * MCP Client - Model Context Protocol 客户端
 * 
 * 用于连接 MCP 服务器，调用工具/读取资源/获取提示
 */

import { EventEmitter } from "node:events";
import {
  type McpTransport,
  createMcpTransport,
} from "./mcp-transport.js";
import type {
  McpClientConfig,
  InitializeParams,
  InitializeResult,
  McpTool,
  McpResource,
  McpPrompt,
  CallToolParams,
  CallToolResult,
  ReadResourceParams,
  ReadResourceResult,
  GetPromptParams,
  GetPromptResult,
  McpServerLike,
  JsonRpcRequest,
  JsonRpcResponse,
  MCP_PROTOCOL_VERSION,
} from "./mcp-types.js";
import {
  MCP_PROTOCOL_VERSION as MCP_VERSION,
  McpError,
  McpConnectionError,
  McpProtocolError,
  McpToolNotFoundError,
} from "./mcp-types.js";

/**
 * 客户端事件
 */
export interface McpClientEvents {
  "connected": [serverName: string];
  "disconnected": [serverName: string];
  "error": [serverName: string, error: Error];
  "tools:updated": [serverName: string, tools: McpTool[]];
  "resources:updated": [serverName: string, resources: McpResource[]];
}

/**
 * MCP 客户端
 */
export class McpClient extends EventEmitter<McpClientEvents> {
  private config: McpClientConfig;
  private connections: Map<string, ServerConnection> = new Map();
  private timeout: number;
  
  constructor(config: McpClientConfig) {
    super();
    this.config = config;
    this.timeout = config.timeout || 30000;
  }
  
  // ============================================================================
  // Connection Management
  // ============================================================================
  
  /**
   * 连接到所有服务器
   */
  async connectAll(): Promise<void> {
    const promises = this.config.servers
      .filter((s) => s.autoConnect !== false)
      .map((s) => this.connect(s.name));
    await Promise.all(promises);
  }
  
  /**
   * 连接到指定服务器
   */
  async connect(serverName: string): Promise<void> {
    if (this.connections.has(serverName)) {
      return;
    }
    
    const serverConfig = this.config.servers.find((s) => s.name === serverName);
    if (!serverConfig) {
      throw new McpConnectionError(`Server not found: ${serverName}`);
    }
    
    const transport = createMcpTransport(serverConfig.transport);
    const connection = new ServerConnection(serverName, transport, this.timeout);
    
    try {
      await transport.open();
      
      // Initialize
      const initParams: InitializeParams = {
        protocolVersion: MCP_VERSION,
        capabilities: {
          roots: { listChanged: true },
          sampling: {},
        },
        clientInfo: {
          name: this.config.name,
          version: this.config.version,
        },
      };
      
      const initResult = await connection.sendRequest<InitializeResult>(
        "initialize",
        initParams
      );
      
      connection.setServerInfo(initResult.serverInfo, initResult.capabilities);
      
      // Send initialized notification
      await transport.send({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });
      
      // Set up event listeners
      transport.on("message", (msg) => connection.handleResponse(msg));
      transport.on("notification", (notif) => connection.handleNotification(notif, this));
      transport.on("error", (err) => this.emit("error", serverName, err));
      transport.on("close", () => {
        this.connections.delete(serverName);
        this.emit("disconnected", serverName);
      });
      
      this.connections.set(serverName, connection);
      this.emit("connected", serverName);
    } catch (err) {
      await transport.close();
      throw new McpConnectionError(
        `Failed to connect to ${serverName}: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }
  }
  
  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.connections.keys()).map((name) => this.disconnect(name));
    await Promise.all(promises);
  }
  
  /**
   * 断开指定连接
   */
  async disconnect(serverName: string): Promise<void> {
    const connection = this.connections.get(serverName);
    if (connection) {
      await connection.transport.close();
      this.connections.delete(serverName);
    }
  }
  
  // ============================================================================
  // Tools
  // ============================================================================
  
  /**
   * 列出所有服务器的工具
   */
  async listAllTools(): Promise<Record<string, McpTool[]>> {
    const result: Record<string, McpTool[]> = {};
    
    for (const [name, connection] of this.connections.entries()) {
      try {
        result[name] = await connection.listTools();
      } catch (err) {
        result[name] = [];
      }
    }
    
    return result;
  }
  
  /**
   * 列出指定服务器的工具
   */
  async listTools(serverName: string): Promise<McpTool[]> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new McpConnectionError(`Server not connected: ${serverName}`);
    }
    return connection.listTools();
  }
  
  /**
   * 调用工具
   */
  async callTool(
    serverName: string,
    params: CallToolParams
  ): Promise<CallToolResult> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new McpConnectionError(`Server not connected: ${serverName}`);
    }
    
    return connection.callTool(params);
  }
  
  /**
   * 查找工具 (跨服务器)
   */
  async findTool(name: string): Promise<{ serverName: string; tool: McpTool } | null> {
    for (const [serverName, connection] of this.connections.entries()) {
      try {
        const tools = await connection.listTools();
        const tool = tools.find((t) => t.name === name);
        if (tool) return { serverName, tool };
      } catch {
        // Continue
      }
    }
    return null;
  }
  
  /**
   * 调用工具 (自动查找服务器)
   */
  async invokeTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult> {
    const found = await this.findTool(name);
    if (!found) {
      throw new McpToolNotFoundError(name);
    }
    
    return this.callTool(found.serverName, {
      name,
      arguments: args,
    });
  }
  
  // ============================================================================
  // Resources
  // ============================================================================
  
  /**
   * 列出资源
   */
  async listResources(serverName: string): Promise<McpResource[]> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new McpConnectionError(`Server not connected: ${serverName}`);
    }
    return connection.listResources();
  }
  
  /**
   * 读取资源
   */
  async readResource(
    serverName: string,
    params: ReadResourceParams
  ): Promise<ReadResourceResult> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new McpConnectionError(`Server not connected: ${serverName}`);
    }
    return connection.readResource(params);
  }
  
  // ============================================================================
  // Prompts
  // ============================================================================
  
  /**
   * 列出提示
   */
  async listPrompts(serverName: string): Promise<McpPrompt[]> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new McpConnectionError(`Server not connected: ${serverName}`);
    }
    return connection.listPrompts();
  }
  
  /**
   * 获取提示
   */
  async getPrompt(
    serverName: string,
    params: GetPromptParams
  ): Promise<GetPromptResult> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new McpConnectionError(`Server not connected: ${serverName}`);
    }
    return connection.getPrompt(params);
  }
  
  // ============================================================================
  // Query
  // ============================================================================
  
  /**
   * 获取已连接服务器列表
   */
  getConnectedServers(): string[] {
    return Array.from(this.connections.keys());
  }
  
  /**
   * 检查服务器是否已连接
   */
  isConnected(serverName: string): boolean {
    return this.connections.has(serverName);
  }
  
  /**
   * 获取统计
   */
  getStats(): {
    totalServers: number;
    connectedServers: number;
    connections: Array<{
      name: string;
      serverInfo?: { name: string; version: string };
    }>;
  } {
    const connections = Array.from(this.connections.entries()).map(([name, conn]) => ({
      name,
      serverInfo: conn.getServerInfo(),
    }));
    
    return {
      totalServers: this.config.servers.length,
      connectedServers: this.connections.size,
      connections,
    };
  }
  
  /**
   * 清理
   */
  async dispose(): Promise<void> {
    await this.disconnectAll();
    this.connections.clear();
  }
}

// ============================================================================
// Server Connection
// ============================================================================

/**
 * 单个服务器连接
 */
class ServerConnection {
  private pendingRequests: Map<string | number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    method: string;
  }> = new Map();
  private serverInfo?: { name: string; version: string };
  private capabilities?: any;
  private requestIdCounter: number = 0;
  
  constructor(
    public readonly name: string,
    public readonly transport: McpTransport,
    private timeout: number,
  ) {}
  
  setServerInfo(info: { name: string; version: string }, caps: any): void {
    this.serverInfo = info;
    this.capabilities = caps;
  }
  
  getServerInfo(): { name: string; version: string } | undefined {
    return this.serverInfo;
  }
  
  /**
   * 发送请求
   */
  async sendRequest<T>(method: string, params?: unknown): Promise<T> {
    const id = ++this.requestIdCounter;
    
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };
    
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new McpProtocolError(`Request timeout: ${method}`));
      }, this.timeout);
      
      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (reason) => {
          clearTimeout(timer);
          reject(reason);
        },
        method,
      });
      
      this.transport.send(request).catch((err) => {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
      });
    });
  }
  
  /**
   * 处理响应
   */
  handleResponse(response: JsonRpcResponse): void {
    const id = response.id;
    if (id === null || id === undefined) return;
    
    const pending = this.pendingRequests.get(id);
    if (!pending) return;
    
    this.pendingRequests.delete(id);
    
    if (response.error) {
      pending.reject(new McpError(
        response.error.message,
        response.error.code,
        response.error.data
      ));
    } else {
      pending.resolve(response.result);
    }
  }
  
  /**
   * 处理通知
   */
  handleNotification(notif: any, client: McpClient): void {
    // Handle standard notifications
    if (notif.method === "notifications/tools/list_changed") {
      client.emit("tools:updated", this.name, []);
    } else if (notif.method === "notifications/resources/list_changed") {
      client.emit("resources:updated", this.name, []);
    }
  }
  
  // Tools
  async listTools(): Promise<McpTool[]> {
    const result = await this.sendRequest<{ tools: McpTool[] }>("tools/list");
    return result.tools;
  }
  
  async callTool(params: CallToolParams): Promise<CallToolResult> {
    return this.sendRequest<CallToolResult>("tools/call", params);
  }
  
  // Resources
  async listResources(): Promise<McpResource[]> {
    const result = await this.sendRequest<{ resources: McpResource[] }>("resources/list");
    return result.resources;
  }
  
  async readResource(params: ReadResourceParams): Promise<ReadResourceResult> {
    return this.sendRequest<ReadResourceResult>("resources/read", params);
  }
  
  // Prompts
  async listPrompts(): Promise<McpPrompt[]> {
    const result = await this.sendRequest<{ prompts: McpPrompt[] }>("prompts/list");
    return result.prompts;
  }
  
  async getPrompt(params: GetPromptParams): Promise<GetPromptResult> {
    return this.sendRequest<GetPromptResult>("prompts/get", params);
  }
}

/**
 * 创建 MCP 客户端
 */
export function createMcpClient(config: McpClientConfig): McpClient {
  return new McpClient(config);
}