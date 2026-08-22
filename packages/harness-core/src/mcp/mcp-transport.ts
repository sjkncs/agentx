/**
 * MCP Transport - 传输层抽象
 * 
 * 支持:
 * - Stdio (子进程)
 * - HTTP (SSE)
 * - WebSocket
 * - In-Process (用于测试和嵌入式场景)
 */

import { EventEmitter } from "node:events";
import { spawn, ChildProcess } from "node:child_process";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  McpTransportConfig,
  StdioTransportConfig,
  HttpTransportConfig,
  WebSocketTransportConfig,
  InProcessTransportConfig,
  McpServerLike,
} from "./mcp-types.js";
import { McpConnectionError } from "./mcp-types.js";

/**
 * 传输事件
 */
export interface TransportEvents {
  "message": [message: JsonRpcResponse];
  "notification": [notification: JsonRpcNotification];
  "error": [error: Error];
  "close": [];
  "open": [];
}

/**
 * 传输抽象基类
 */
export abstract class McpTransport extends EventEmitter<TransportEvents> {
  abstract readonly type: "stdio" | "http" | "websocket" | "in-process";
  abstract open(): Promise<void>;
  abstract close(): Promise<void>;
  abstract send(message: JsonRpcRequest | JsonRpcNotification): Promise<void>;
  abstract isOpen(): boolean;
}

// ============================================================================
// Stdio Transport
// ============================================================================

/**
 * Stdio 传输
 */
export class StdioMcpTransport extends McpTransport {
  readonly type = "stdio" as const;
  private process?: ChildProcess;
  private buffer: string = "";
  private _isOpen: boolean = false;
  
  constructor(private config: StdioTransportConfig) {
    super();
  }
  
  async open(): Promise<void> {
    if (this._isOpen) return;
    
    try {
      this.process = spawn(this.config.command, this.config.args || [], {
        env: { ...process.env, ...(this.config.env || {}) },
        cwd: this.config.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
      
      this.process.stdout?.on("data", (data) => this.handleData(data.toString()));
      this.process.stderr?.on("data", (data) => {
        // stderr is usually for logs
        console.error(`[MCP stderr] ${data.toString()}`);
      });
      
      this.process.on("error", (err) => {
        this.emit("error", err);
      });
      
      this.process.on("exit", (code) => {
        if (this._isOpen) {
          this.emit("error", new McpConnectionError(`Process exited with code ${code}`));
        }
        this._isOpen = false;
        this.emit("close");
      });
      
      this._isOpen = true;
      this.emit("open");
    } catch (err) {
      throw new McpConnectionError(
        `Failed to spawn process: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }
  }
  
  async close(): Promise<void> {
    if (!this._isOpen) return;
    
    if (this.process) {
      this.process.kill("SIGTERM");
      // Wait for exit
      await new Promise<void>((resolve) => {
        if (!this.process) return resolve();
        const timeout = setTimeout(() => {
          this.process?.kill("SIGKILL");
          resolve();
        }, 5000);
        
        this.process.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    
    this._isOpen = false;
    this.emit("close");
  }
  
  async send(message: JsonRpcRequest | JsonRpcNotification): Promise<void> {
    if (!this._isOpen || !this.process?.stdin) {
      throw new McpConnectionError("Transport not open");
    }
    
    const data = JSON.stringify(message) + "\n";
    this.process.stdin.write(data);
  }
  
  isOpen(): boolean {
    return this._isOpen;
  }
  
  private handleData(data: string): void {
    this.buffer += data;
    
    // Process complete lines (newline-delimited JSON)
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      
      if (line) {
        try {
          const message = JSON.parse(line);
          if ("id" in message && message.id !== null && message.id !== undefined) {
            this.emit("message", message as JsonRpcResponse);
          } else {
            this.emit("notification", message as JsonRpcNotification);
          }
        } catch (err) {
          this.emit("error", new McpConnectionError(
            `Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`
          ));
        }
      }
    }
  }
}

// ============================================================================
// HTTP Transport (SSE)
// ============================================================================

/**
 * HTTP 传输 (基于 SSE)
 */
export class HttpMcpTransport extends McpTransport {
  readonly type = "http" as const;
  private _isOpen: boolean = false;
  private headers: Record<string, string> = {};
  
  constructor(private config: HttpTransportConfig) {
    super();
    this.headers = {
      "Content-Type": "application/json",
      ...(config.headers || {}),
    };
    if (config.apiKey) {
      this.headers["Authorization"] = `Bearer ${config.apiKey}`;
    }
  }
  
  async open(): Promise<void> {
    // For HTTP, we don't maintain a persistent connection
    // Connection is per-request
    this._isOpen = true;
    this.emit("open");
  }
  
  async close(): Promise<void> {
    this._isOpen = false;
    this.emit("close");
  }
  
  async send(message: JsonRpcRequest | JsonRpcNotification): Promise<void> {
    if (!this._isOpen) {
      throw new McpConnectionError("Transport not open");
    }
    
    try {
      const response = await fetch(this.config.endpoint, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(message),
      });
      
      if (!response.ok) {
        throw new McpConnectionError(`HTTP ${response.status}: ${await response.text()}`);
      }
      
      // For requests with ID, parse response
      if ("id" in message && message.id !== null && message.id !== undefined) {
        const data = await response.json();
        this.emit("message", data as JsonRpcResponse);
      }
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new McpConnectionError(String(err)));
    }
  }
  
  isOpen(): boolean {
    return this._isOpen;
  }
}

// ============================================================================
// WebSocket Transport
// ============================================================================

/**
 * WebSocket 传输
 */
export class WebSocketMcpTransport extends McpTransport {
  readonly type = "websocket" as const;
  private ws?: WebSocket;
  private _isOpen: boolean = false;
  
  constructor(private config: WebSocketTransportConfig) {
    super();
  }
  
  async open(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.endpoint, this.config.protocols);
        
        this.ws.onopen = () => {
          this._isOpen = true;
          this.emit("open");
          resolve();
        };
        
        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            if ("id" in message && message.id !== null && message.id !== undefined) {
              this.emit("message", message as JsonRpcResponse);
            } else {
              this.emit("notification", message as JsonRpcNotification);
            }
          } catch (err) {
            this.emit("error", new McpConnectionError(
              `Failed to parse WebSocket message: ${err instanceof Error ? err.message : String(err)}`
            ));
          }
        };
        
        this.ws.onerror = (err) => {
          this.emit("error", new McpConnectionError("WebSocket error"));
          reject(new McpConnectionError("WebSocket connection failed"));
        };
        
        this.ws.onclose = () => {
          this._isOpen = false;
          this.emit("close");
        };
      } catch (err) {
        reject(new McpConnectionError(
          `Failed to create WebSocket: ${err instanceof Error ? err.message : String(err)}`,
          err
        ));
      }
    });
  }
  
  async close(): Promise<void> {
    if (this.ws && this._isOpen) {
      this.ws.close();
      this._isOpen = false;
      this.emit("close");
    }
  }
  
  async send(message: JsonRpcRequest | JsonRpcNotification): Promise<void> {
    if (!this._isOpen || !this.ws) {
      throw new McpConnectionError("WebSocket not connected");
    }
    
    this.ws.send(JSON.stringify(message));
  }
  
  isOpen(): boolean {
    return this._isOpen;
  }
}

// ============================================================================
// In-Process Transport
// ============================================================================

/**
 * In-Process 传输
 */
export class InProcessMcpTransport extends McpTransport {
  readonly type = "in-process" as const;
  private _isOpen: boolean = false;
  
  constructor(private server: McpServerLike) {
    super();
  }
  
  async open(): Promise<void> {
    this._isOpen = true;
    this.emit("open");
  }
  
  async close(): Promise<void> {
    this._isOpen = false;
    this.emit("close");
  }
  
  async send(message: JsonRpcRequest | JsonRpcNotification): Promise<void> {
    if (!this._isOpen) {
      throw new McpConnectionError("Transport not open");
    }
    
    if (!("id" in message) || message.id === null || message.id === undefined) {
      // Notification - ignore for now
      return;
    }
    
    // Handle request synchronously in-process
    try {
      const result = await this.handleRequest(message.method, message.params);
      this.emit("message", {
        jsonrpc: "2.0",
        id: message.id,
        result,
      });
    } catch (err) {
      this.emit("message", {
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
  
  isOpen(): boolean {
    return this._isOpen;
  }
  
  private async handleRequest(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case "tools/list":
        if (!this.server.listTools) {
          return { tools: [] };
        }
        return await this.server.listTools();
        
      case "tools/call": {
        if (!this.server.callTool) {
          throw new Error("Server does not support tool calls");
        }
        return await this.server.callTool(params as { name: string; arguments?: Record<string, unknown> });
      }
      
      case "resources/list":
        if (!this.server.listResources) {
          return { resources: [] };
        }
        return await this.server.listResources();
        
      case "resources/read":
        if (!this.server.readResource) {
          throw new Error("Server does not support resource reading");
        }
        return await this.server.readResource(params as { uri: string });
        
      case "prompts/list":
        if (!this.server.listPrompts) {
          return { prompts: [] };
        }
        return await this.server.listPrompts();
        
      case "prompts/get":
        if (!this.server.getPrompt) {
          throw new Error("Server does not support prompt getting");
        }
        return await this.server.getPrompt(params as { name: string; arguments?: Record<string, string> });
        
      default:
        throw new Error(`Method not found: ${method}`);
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * 创建传输
 */
export function createMcpTransport(config: McpTransportConfig): McpTransport {
  switch (config.type) {
    case "stdio":
      return new StdioMcpTransport(config);
    case "http":
      return new HttpMcpTransport(config);
    case "websocket":
      return new WebSocketMcpTransport(config);
    case "in-process":
      return new InProcessMcpTransport(config.server);
    default:
      throw new Error(`Unknown transport type: ${(config as { type: string }).type}`);
  }
}