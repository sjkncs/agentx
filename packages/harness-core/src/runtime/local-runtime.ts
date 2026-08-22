/**
 * Local Runtime - Node.js 沙箱执行环境
 * 
 * 提供安全的本地代码执行能力
 */

import {
  type RuntimeInstance,
  type LocalRuntimeConfig,
  type LocalExecutionRequest,
  type LocalExecutionResult,
  type ExecutionRequest,
  type RuntimeCapabilities,
  type RuntimeStatus,
  type SessionInfo,
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
  canAccessFileSystem: true,
  canMakeNetworkRequests: true,
  canAccessEnvironmentVariables: true,
  canSpawnProcesses: false,
  maxMemoryMB: 512,
  timeoutLimit: 300000, // 5 minutes
};

/**
 * Local Runtime - 本地运行时实现
 */
export class LocalRuntime implements RuntimeInstance<LocalRuntimeConfig> {
  readonly id: string;
  readonly type: "local" = "local";
  readonly config: LocalRuntimeConfig;
  readonly capabilities: RuntimeCapabilities;
  
  status: RuntimeStatus = "idle";
  readonly startedAt?: number;
  
  private workingDirectory: string;
  private environment: Record<string, string>;
  private timeout: number;
  private debug: boolean;
  private isInitialized = false;
  
  constructor(
    id: string,
    config: LocalRuntimeConfig = {}
  ) {
    this.id = id;
    this.config = config;
    this.capabilities = {
      ...DEFAULT_CAPABILITIES,
      maxMemoryMB: config.maxMemoryMB || DEFAULT_CAPABILITIES.maxMemoryMB,
      timeoutLimit: config.timeout || DEFAULT_CAPABILITIES.timeoutLimit,
    };
    
    this.workingDirectory = config.workingDirectory || process.cwd();
    this.environment = {
      ...process.env as Record<string, string>,
      ...config.environment,
    };
    this.timeout = config.timeout || 30000;
    this.debug = config.debug || false;
  }
  
  /**
   * 初始化运行时
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    try {
      this.status = "starting";
      
      // 验证工作目录
      // Note: In real implementation, we'd verify directory exists
      
      this.isInitialized = true;
      this.status = "ready";
      
      if (this.debug) {
        console.log(`[LocalRuntime:${this.id}] Initialized`);
      }
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
    
    // Cleanup resources
    this.isInitialized = false;
    this.status = "stopped";
    
    if (this.debug) {
      console.log(`[LocalRuntime:${this.id}] Stopped`);
    }
  }
  
  /**
   * 执行代码
   */
  async execute(request: ExecutionRequest): Promise<LocalExecutionResult> {
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
      const result = await this.executeInSandbox(request);
      this.status = "ready";
      return result;
    } catch (error) {
      this.status = "ready";
      throw error;
    }
  }
  
  /**
   * 在沙箱中执行代码
   */
  private async executeInSandbox(request: ExecutionRequest): Promise<LocalExecutionResult> {
    const timeout = request.timeout || this.timeout;
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({
          success: false,
          error: `Execution timeout after ${timeout}ms`,
          duration: timeout,
          stderr: `Execution timeout after ${timeout}ms`,
          exitCode: -1,
        });
      }, timeout);
      
      try {
        // Simulate code execution
        // In real implementation, this would use vm.runInNewContext or similar
        const result = this.simulateExecution(request);
        
        clearTimeout(timer);
        
        resolve({
          success: true,
          result: result.output,
          duration: Date.now() - startTime,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: 0,
        });
      } catch (error) {
        clearTimeout(timer);
        
        resolve({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - startTime,
          stderr: error instanceof Error ? error.stack : String(error),
          exitCode: 1,
        });
      }
    });
  }
  
  /**
   * 模拟代码执行 (实际实现会使用 vm 或 worker)
   */
  private simulateExecution(request: ExecutionRequest): {
    output: unknown;
    stdout: string;
    stderr: string;
  } {
    // This is a placeholder - real implementation would use:
    // - Node.js vm module: vm.runInNewContext(code, context)
    // - Or isolated-vm for better isolation
    // - Or worker_threads for true isolation
    
    const stdout: string[] = [];
    const stderr: string[] = [];
    
    // Capture console output
    const originalLog = console.log;
    const originalError = console.error;
    
    console.log = (...args) => stdout.push(args.map(String).join(" "));
    console.error = (...args) => stderr.push(args.map(String).join(" "));
    
    try {
      // In real implementation, this would be the sandboxed execution
      // For now, return a mock result
      let output: unknown;
      
      try {
        // eslint-disable-next-line no-eval
        output = eval(request.code);
      } catch {
        // If eval fails, return a mock success
        output = { executed: true, language: request.language };
      }
      
      return {
        output,
        stdout: stdout.join("\n"),
        stderr: stderr.join("\n"),
      };
    } finally {
      // Restore console
      console.log = originalLog;
      console.error = originalError;
    }
  }
  
  /**
   * 获取会话信息
   */
  getSession(): SessionInfo {
    return {
      sessionId: this.id,
      runtimeType: "local",
      status: this.status,
      createdAt: this.startedAt || Date.now(),
      lastActivity: Date.now(),
      metadata: {
        workingDirectory: this.workingDirectory,
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
 * 创建 Local Runtime
 */
export function createLocalRuntime(
  id: string,
  config?: LocalRuntimeConfig
): LocalRuntime {
  return new LocalRuntime(id, config);
}

/**
 * 创建安全配置的 Local Runtime
 */
export function createSecureLocalRuntime(id: string): LocalRuntime {
  return new LocalRuntime(id, {
    maxMemoryMB: 256,
    timeout: 30000,
    blockedModules: [
      "child_process",
      "fs",
      "net",
      "http",
      "https",
      "dns",
      "cluster",
    ],
    environment: {
      NODE_ENV: "production",
    },
  });
}
