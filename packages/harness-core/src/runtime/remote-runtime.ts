/**
 * Remote Runtime - 远程 API 执行环境
 * 
 * 提供安全的远程代码执行能力
 */

import {
  type RuntimeInstance,
  type RemoteRuntimeConfig,
  type ExecutionRequest,
  type ExecutionResult,
  type RuntimeCapabilities,
  type RuntimeStatus,
  type SessionInfo,
  type RemoteExecutionResult,
  RuntimeError,
  RuntimeInitError,
  RuntimeExecutionError,
  RuntimeTimeoutError,
} from "./runtime-types.js";

/**
 * 默认能力
 */
const DEFAULT_CAPABILITIES: RuntimeCapabilities = {
  canExecuteCode: true,
  canAccessFileSystem: false,
  canMakeNetworkRequests: false,
  canAccessEnvironmentVariables: false,
  canSpawnProcesses: false,
  maxMemoryMB: 4096,
  timeoutLimit: 600000, // 10 minutes
};

/**
 * Remote Runtime - 远程运行时实现
 */
export class RemoteRuntime implements RuntimeInstance<RemoteRuntimeConfig> {
  readonly id: string;
  readonly type: "remote" = "remote";
  readonly config: RemoteRuntimeConfig;
  readonly capabilities: RuntimeCapabilities;
  
  status: RuntimeStatus = "idle";
  readonly startedAt?: number;
  
  private endpoint: string;
  private apiKey?: string;
  private timeout: number;
  private retries: number;
  private region?: string;
  private isInitialized = false;
  
  constructor(
    id: string,
    config: RemoteRuntimeConfig
  ) {
    this.id = id;
    this.config = config;
    this.capabilities = DEFAULT_CAPABILITIES;
    
    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 60000;
    this.retries = config.retries || 3;
    this.region = config.region;
  }
  
  /**
   * 初始化运行时
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    try {
      this.status = "starting";
      
      // Test connection to endpoint
      const response = await this.request("/health", {
        method: "GET",
      });
      
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }
      
      this.isInitialized = true;
      this.status = "ready";
      
      console.log(`[RemoteRuntime:${this.id}] Initialized (endpoint: ${this.endpoint})`);
    } catch (error) {
      this.status = "error";
      throw new RuntimeInitError(
        this.id,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  
  /**
   * 启动运行时
   */
  async start(): Promise<void> {
    await this.initialize();
    
    if (this.status === "ready") {
      this.status = "ready";
    }
  }
  
  /**
   * 停止运行时
   */
  async stop(): Promise<void> {
    if (this.status === "idle" || this.status === "stopped") {
      return;
    }
    
    this.status = "stopping";
    
    try {
      // Clean up remote session
      await this.request("/session/stop", {
        method: "POST",
        body: JSON.stringify({ sessionId: this.id }),
      });
    } catch {
      // Ignore errors on stop
    }
    
    this.isInitialized = false;
    this.status = "stopped";
    
    console.log(`[RemoteRuntime:${this.id}] Stopped`);
  }
  
  /**
   * 执行代码
   */
  async execute(request: ExecutionRequest): Promise<RemoteExecutionResult> {
    const startTime = Date.now();
    
    // Validate state
    if (!this.isInitialized) {
      throw new RuntimeError(`Runtime ${this.id} not initialized`, this.id, "NOT_INITIALIZED");
    }
    
    if (this.status !== "ready") {
      throw new RuntimeError(`Runtime ${this.id} not ready (status: ${this.status})`, this.id, "NOT_READY");
    }
    
    this.status = "busy";
    
    try {
      const result = await this.executeRemote(request);
      this.status = "ready";
      return result;
    } catch (error) {
      this.status = "ready";
      throw error;
    }
  }
  
  /**
   * 远程执行
   */
  private async executeRemote(request: ExecutionRequest): Promise<RemoteExecutionResult> {
    const timeout = request.timeout || this.timeout;
    let lastError: Error | undefined;
    const startTime = Date.now();

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const response = await this.request("/execute", {
          method: "POST",
          body: JSON.stringify({
            code: request.code,
            language: request.language,
            context: request.context,
            sessionId: request.sessionId || this.id,
            priority: "normal",
          }),
          headers: {
            "Content-Type": "application/json",
          },
        });
        
        if (!response.ok) {
          throw new RuntimeExecutionError(
            this.id,
            `API returned ${response.status}: ${await response.text()}`
          );
        }
        
        const data = await response.json() as {
          success: boolean;
          result?: unknown;
          output?: string;
          logs?: string[];
          error?: string;
          tokensUsed?: number;
          duration?: number;
        };
        
        return {
          success: data.success,
          result: data.result,
          output: data.output,
          logs: data.logs,
          error: data.error,
          duration: data.duration || (Date.now() - startTime),
          tokensUsed: data.tokensUsed,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Don't retry on certain errors
        if (error instanceof RuntimeTimeoutError) {
          throw error;
        }
        
        if (attempt < this.retries) {
          // Exponential backoff
          const delay = Math.pow(2, attempt) * 1000;
          await this.sleep(delay);
        }
      }
    }
    
    throw new RuntimeExecutionError(
      this.id,
      lastError?.message || "Max retries exceeded",
      lastError
    );
  }
  
  /**
   * 发送 HTTP 请求
   */
  private async request(
    path: string,
    options: RequestInit & { timeout?: number }
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = options.timeout || this.timeout;
    
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const headers: Record<string, string> = {
        ...(options.headers as Record<string, string> || {}),
      };
      
      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }
      
      if (this.region) {
        headers["X-Region"] = this.region;
      }
      
      const response = await fetch(`${this.endpoint}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      });
      
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  
  /**
   * 等待
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  
  /**
   * 获取会话信息
   */
  getSession(): SessionInfo {
    return {
      sessionId: this.id,
      runtimeType: "remote",
      status: this.status,
      createdAt: this.startedAt || Date.now(),
      lastActivity: Date.now(),
      metadata: {
        endpoint: this.endpoint,
        region: this.region,
        capabilities: this.capabilities,
      },
    };
  }
  
  /**
   * 清理资源
   */
  async dispose(): Promise<void> {
    await this.stop();
  }
}

/**
 * 创建 Remote Runtime
 */
export function createRemoteRuntime(
  id: string,
  config: RemoteRuntimeConfig
): RemoteRuntime {
  return new RemoteRuntime(id, config);
}

/**
 * 创建 AgentX Cloud Runtime
 */
export function createAgentXCloudRuntime(
  id: string,
  apiKey: string,
  region?: string
): RemoteRuntime {
  const endpoint = region 
    ? `https://api-${region}.agentx.ai/runtime`
    : "https://api.agentx.ai/runtime";
  
  return new RemoteRuntime(id, {
    endpoint,
    apiKey,
    region,
    timeout: 120000,
    retries: 3,
  });
}
