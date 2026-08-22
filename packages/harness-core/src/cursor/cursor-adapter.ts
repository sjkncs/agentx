/**
 * Cursor SDK Adapter - 与 Cursor SDK 集成
 * 
 * 提供:
 * - Cursor Local SDK 适配 (IDE 内)
 * - Cursor Cloud SDK 适配 (云端)
 * - 上下文获取
 * - Agent 调用
 * - 流式响应处理
 */

import { EventEmitter } from "node:events";
import type {
  CursorSdkConfig,
  CursorIdeContext,
  CursorAgentRequest,
  CursorAgentResponse,
  CursorAgentStatus,
  CursorStreamEvent,
  CursorStreamEventType,
  CursorFileContext,
  CursorFileEdit,
  CursorToolCall,
} from "./cursor-types.js";
import {
  CursorSdkError,
  CursorConnectionError,
  CursorAgentError,
} from "./cursor-types.js";

/**
 * Cursor SDK 事件
 */
export interface CursorSdkEvents {
  "connected": [context: CursorIdeContext];
  "disconnected": [];
  "agent:start": [request: CursorAgentRequest];
  "agent:status": [status: CursorAgentStatus];
  "stream": [event: CursorStreamEvent];
  "error": [error: Error];
}

/**
 * Cursor SDK 适配器
 */
export class CursorSdkAdapter extends EventEmitter<CursorSdkEvents> {
  protected config: CursorSdkConfig;
  protected context?: CursorIdeContext;
  protected connected: boolean = false;
  protected currentStatus: CursorAgentStatus = "idle";
  protected currentResponseId?: string;
  
  constructor(config: CursorSdkConfig) {
    super();
    this.config = config;
  }
  
  // ============================================================================
  // Connection
  // ============================================================================
  
  /**
   * 连接到 Cursor IDE
   */
  async connect(): Promise<void> {
    if (this.connected) return;
    
    try {
      this.context = await this.fetchIdeContext();
      this.connected = true;
      this.emit("connected", this.context);
    } catch (err) {
      throw new CursorConnectionError(
        `Failed to connect to Cursor: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  
  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    this.context = undefined;
    this.emit("disconnected");
  }
  
  /**
   * 获取 IDE 上下文
   */
  async getContext(): Promise<CursorIdeContext | undefined> {
    return this.context;
  }
  
  // ============================================================================
  // Agent Invocation
  // ============================================================================
  
  /**
   * 调用 Agent
   */
  async invoke(request: CursorAgentRequest): Promise<CursorAgentResponse> {
    if (!this.connected) {
      throw new CursorConnectionError("Not connected to Cursor");
    }
    
    this.emit("agent:start", request);
    this.setStatus("thinking");
    
    try {
      const responseId = `resp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      this.currentResponseId = responseId;
      
      // Execute and collect events
      const response = await this.executeAgent(request, responseId);
      
      this.setStatus("completed");
      return response;
    } catch (err) {
      this.setStatus("error");
      throw new CursorAgentError(
        `Agent invocation failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  
  /**
   * 流式调用 Agent
   */
  async *stream(request: CursorAgentRequest): AsyncGenerator<CursorStreamEvent> {
    if (!this.connected) {
      throw new CursorConnectionError("Not connected to Cursor");
    }
    
    this.emit("agent:start", request);
    this.setStatus("thinking");
    
    const responseId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.currentResponseId = responseId;
    
    yield {
      type: "start",
      responseId,
      timestamp: Date.now(),
    };
    
    this.setStatus("streaming");
    
    try {
      const events = await this.executeAgentStream(request, responseId);
      
      for await (const event of events) {
        this.emit("stream", event);
        yield event;
      }
      
      this.setStatus("completed");
    } catch (err) {
      const errorEvent: CursorStreamEvent = {
        type: "error",
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      };
      this.emit("stream", errorEvent);
      yield errorEvent;
      this.setStatus("error");
    }
  }
  
  /**
   * 取消当前 Agent
   */
  async cancel(): Promise<void> {
    this.setStatus("cancelled");
    this.currentResponseId = undefined;
    
    const cancelEvent: CursorStreamEvent = {
      type: "cancelled",
      timestamp: Date.now(),
    };
    this.emit("stream", cancelEvent);
  }
  
  // ============================================================================
  // File Operations
  // ============================================================================
  
  /**
   * 获取文件内容
   */
  async getFile(path: string): Promise<CursorFileContext | null> {
    if (!this.context) return null;
    
    return this.context.openFiles.find(f => f.path === path) || null;
  }
  
  /**
   * 应用文件编辑
   */
  async applyEdit(edit: CursorFileEdit): Promise<boolean> {
    if (!this.connected) {
      throw new CursorConnectionError("Not connected");
    }
    
    try {
      await this.applyEditInternal(edit);
      return true;
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }
  
  /**
   * 应用多个编辑
   */
  async applyEdits(edits: CursorFileEdit[]): Promise<number> {
    let count = 0;
    for (const edit of edits) {
      if (await this.applyEdit(edit)) count++;
    }
    return count;
  }
  
  // ============================================================================
  // State
  // ============================================================================
  
  /**
   * 是否已连接
   */
  isConnected(): boolean {
    return this.connected;
  }
  
  /**
   * 获取当前状态
   */
  getStatus(): CursorAgentStatus {
    return this.currentStatus;
  }
  
  /**
   * 设置状态
   */
  protected setStatus(status: CursorAgentStatus): void {
    this.currentStatus = status;
    this.emit("agent:status", status);
  }
  
  // ============================================================================
  // Protected Methods (To be overridden)
  // ============================================================================
  
  /**
   * 获取 IDE 上下文
   */
  protected async fetchIdeContext(): Promise<CursorIdeContext> {
    // Override in subclasses
    return {
      workspace: this.config.workspace || process.cwd(),
      openFiles: [],
    };
  }
  
  /**
   * 执行 Agent
   */
  protected async executeAgent(
    request: CursorAgentRequest,
    responseId: string,
  ): Promise<CursorAgentResponse> {
    // Override in subclasses
    return {
      id: responseId,
      type: request.type,
      text: "",
      status: "completed",
    };
  }
  
  /**
   * 流式执行 Agent
   */
  protected async *executeAgentStream(
    request: CursorAgentRequest,
    responseId: string,
  ): AsyncGenerator<CursorStreamEvent> {
    // Override in subclasses
    yield {
      type: "complete",
      responseId,
      timestamp: Date.now(),
    };
  }
  
  /**
   * 应用编辑
   */
  protected async applyEditInternal(edit: CursorFileEdit): Promise<void> {
    // Override in subclasses
  }
}

// ============================================================================
// Local Adapter (IDE-Resident)
// ============================================================================

/**
 * Local Cursor SDK Adapter
 * 
 * 用于 IDE 内运行的 agent，通过本地文件系统和 IDE 集成工作
 */
export class LocalCursorSdkAdapter extends CursorSdkAdapter {
  constructor(config: CursorSdkConfig) {
    super({
      ...config,
      type: "local",
    });
  }
  
  protected async fetchIdeContext(): Promise<CursorIdeContext> {
    const workspace = this.config.workspace || process.cwd();
    
    return {
      workspace,
      openFiles: [],
      project: {
        name: workspace.split(/[\\/]/).pop() || "workspace",
        root: workspace,
      },
    };
  }
  
  protected async executeAgent(
    request: CursorAgentRequest,
    responseId: string,
  ): Promise<CursorAgentResponse> {
    // In local mode, we would delegate to the Cursor CLI/extension
    // For now, return a mock response
    return {
      id: responseId,
      type: request.type,
      text: `[Local Agent] Received: ${request.prompt}`,
      status: "completed",
    };
  }
  
  protected async *executeAgentStream(
    request: CursorAgentRequest,
    responseId: string,
  ): AsyncGenerator<CursorStreamEvent> {
    const text = `[Local Agent Streaming] ${request.prompt}`;
    
    for (const char of text) {
      yield {
        type: "text",
        responseId,
        textDelta: char,
        timestamp: Date.now(),
      };
    }
    
    yield {
      type: "complete",
      responseId,
      timestamp: Date.now(),
    };
  }
}

// ============================================================================
// Cloud Adapter
// ============================================================================

/**
 * Cloud Cursor SDK Adapter
 * 
 * 通过 Cloud API 调用
 */
export class CloudCursorSdkAdapter extends CursorSdkAdapter {
  constructor(config: CursorSdkConfig) {
    super({
      ...config,
      type: "cloud",
    });
    
    if (!config.apiKey) {
      throw new CursorSdkError("API key required for cloud adapter");
    }
  }
  
  protected async fetchIdeContext(): Promise<CursorIdeContext> {
    // Cloud mode - context provided by API
    return {
      workspace: this.config.workspace || "",
      openFiles: [],
    };
  }
  
  protected async executeAgent(
    request: CursorAgentRequest,
    responseId: string,
  ): Promise<CursorAgentResponse> {
    const endpoint = this.config.endpoint || "https://api.cursor.sh/v1/agent";
    
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(request),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      
      const data = await response.json();
      return {
        id: responseId,
        type: request.type,
        text: data.text || "",
        edits: data.edits,
        toolCalls: data.toolCalls,
        status: "completed",
      };
    } catch (err) {
      throw new CursorAgentError(
        `Cloud request failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  
  protected async *executeAgentStream(
    request: CursorAgentRequest,
    responseId: string,
  ): AsyncGenerator<CursorStreamEvent> {
    // Stream from cloud
    const endpoint = `${this.config.endpoint || "https://api.cursor.sh/v1/agent"}/stream`;
    
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(request),
      });
      
      if (!response.body) {
        yield {
          type: "error",
          error: "No response body",
          timestamp: Date.now(),
        };
        return;
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter(Boolean);
        
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            yield {
              ...event,
              responseId,
              timestamp: Date.now(),
            };
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } catch (err) {
      yield {
        type: "error",
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      };
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * 创建 Cursor SDK Adapter
 */
export function createCursorSdkAdapter(config: CursorSdkConfig): CursorSdkAdapter {
  if (config.type === "cloud") {
    return new CloudCursorSdkAdapter(config);
  }
  return new LocalCursorSdkAdapter(config);
}