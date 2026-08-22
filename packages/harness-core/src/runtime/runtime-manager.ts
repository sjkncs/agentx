/**
 * Runtime Manager - 运行时管理器
 * 
 * 管理多个运行时实例，提供路由和负载均衡
 */

import {
  type RuntimeInstance,
  type RuntimeRegistryConfig,
  type RoutingStrategy,
  type RoutingRule,
  type ExecutionRequest,
  type ExecutionResult,
  type RuntimeType,
  type AnyRuntimeConfig,
  RuntimeError,
  RuntimeNotAvailableError,
} from "./runtime-types.js";
import { LocalRuntime } from "./local-runtime.js";
import { RemoteRuntime } from "./remote-runtime.js";

/**
 * Runtime Manager - 运行时管理器
 */
export class RuntimeManager {
  private runtimes: Map<string, RuntimeInstance> = new Map();
  private rules: RoutingRule[] = [];
  private strategy: RoutingStrategy = "round-robin";
  private counters: Map<string, number> = new Map();
  private autoStart = false;
  private maxInstances: number;
  private defaultType: RuntimeType;
  
  constructor(config: RuntimeRegistryConfig = { defaultType: "local" }) {
    this.defaultType = config.defaultType;
    this.autoStart = config.autoStart ?? true;
    this.maxInstances = config.maxInstances ?? 10;
  }
  
  /**
   * 注册运行时
   */
  register(runtime: RuntimeInstance): void {
    if (this.runtimes.size >= this.maxInstances) {
      throw new RuntimeError(
        `Maximum number of runtimes (${this.maxInstances}) reached`,
        undefined,
        "MAX_INSTANCES"
      );
    }
    
    if (this.runtimes.has(runtime.id)) {
      throw new RuntimeError(`Runtime ${runtime.id} already registered`, runtime.id, "ALREADY_EXISTS");
    }
    
    this.runtimes.set(runtime.id, runtime);
    
    if (this.autoStart) {
      runtime.initialize().catch((err) => {
        console.error(`Failed to initialize runtime ${runtime.id}:`, err);
      });
    }
  }
  
  /**
   * 注销运行时
   */
  async unregister(runtimeId: string): Promise<void> {
    const runtime = this.runtimes.get(runtimeId);
    if (runtime) {
      await runtime.dispose();
      this.runtimes.delete(runtimeId);
      this.counters.delete(runtimeId);
    }
  }
  
  /**
   * 获取运行时
   */
  get(runtimeId: string): RuntimeInstance | undefined {
    return this.runtimes.get(runtimeId);
  }
  
  /**
   * 获取所有运行时
   */
  getAll(): RuntimeInstance[] {
    return Array.from(this.runtimes.values());
  }
  
  /**
   * 获取默认运行时
   */
  getDefault(): RuntimeInstance | undefined {
    const defaults = this.getByType(this.defaultType);
    return defaults[0];
  }
  
  /**
   * 按类型获取运行时
   */
  getByType(type: RuntimeType): RuntimeInstance[] {
    return this.getAll().filter((r) => r.type === type);
  }
  
  /**
   * 执行代码 (自动路由)
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const runtime = this.route(request);
    if (!runtime) {
      throw new RuntimeNotAvailableError("no-runtime");
    }
    
    return runtime.execute(request);
  }
  
  /**
   * 根据路由规则选择运行时
   */
  route(request: ExecutionRequest): RuntimeInstance | undefined {
    // 1. 检查规则匹配
    const matchedRule = this.rules
      .sort((a, b) => a.priority - b.priority)
      .find((rule) => rule.match(request));
    
    if (matchedRule) {
      const runtime = this.getRuntimeByType(matchedRule.runtimeType);
      if (runtime) return runtime;
    }
    
    // 2. 使用策略选择
    return this.selectByStrategy();
  }
  
  /**
   * 添加路由规则
   */
  addRule(rule: RoutingRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => a.priority - b.priority);
  }
  
  /**
   * 移除路由规则
   */
  removeRule(name: string): void {
    this.rules = this.rules.filter((r) => r.name !== name);
  }
  
  /**
   * 设置路由策略
   */
  setStrategy(strategy: RoutingStrategy): void {
    this.strategy = strategy;
  }
  
  /**
   * 创建默认 Local Runtime
   */
  createLocal(id?: string): RuntimeInstance {
    const runtimeId = id || `local-${Date.now()}`;
    
    if (this.runtimes.has(runtimeId)) {
      throw new RuntimeError(`Runtime ${runtimeId} already exists`, runtimeId);
    }
    
    const runtime = new LocalRuntime(runtimeId);
    this.register(runtime);
    
    return runtime;
  }
  
  /**
   * 创建默认 Remote Runtime
   */
  createRemote(id: string, config: ConstructorParameters<typeof RemoteRuntime>[1]): RuntimeInstance {
    if (this.runtimes.has(id)) {
      throw new RuntimeError(`Runtime ${id} already exists`, id);
    }
    
    const runtime = new RemoteRuntime(id, config);
    this.register(runtime);
    
    return runtime;
  }
  
  /**
   * 获取统计信息
   */
  getStats(): {
    total: number;
    byType: Record<RuntimeType, number>;
    byStatus: Record<string, number>;
    rules: number;
    strategy: RoutingStrategy;
  } {
    const byType: Record<RuntimeType, number> = { local: 0, remote: 0, enterprise: 0 };
    const byStatus: Record<string, number> = {};
    
    for (const runtime of this.runtimes.values()) {
      byType[runtime.type]++;
      byStatus[runtime.status] = (byStatus[runtime.status] || 0) + 1;
    }
    
    return {
      total: this.runtimes.size,
      byType,
      byStatus,
      rules: this.rules.length,
      strategy: this.strategy,
    };
  }
  
  /**
   * 启动所有运行时
   */
  async startAll(): Promise<void> {
    const promises = Array.from(this.runtimes.values()).map((r) => r.start());
    await Promise.all(promises);
  }
  
  /**
   * 停止所有运行时
   */
  async stopAll(): Promise<void> {
    const promises = Array.from(this.runtimes.values()).map((r) => r.stop());
    await Promise.all(promises);
  }
  
  /**
   * 清理所有运行时
   */
  async dispose(): Promise<void> {
    await this.stopAll();
    this.runtimes.clear();
    this.rules = [];
    this.counters.clear();
  }
  
  // ============================================================================
  // Private Methods
  // ============================================================================
  
  private getRuntimeByType(type: RuntimeType): RuntimeInstance | undefined {
    const runtimes = this.getByType(type);
    if (runtimes.length === 0) return undefined;
    
    // Apply strategy
    switch (this.strategy) {
      case "random":
        return runtimes[Math.floor(Math.random() * runtimes.length)];
        
      case "round-robin":
        return this.roundRobinSelect(runtimes);
        
      case "least-loaded":
        return this.leastLoadedSelect(runtimes);
        
      case "capability-based":
        // For capability-based, we'd check specific capabilities
        // For now, fall through to default
        return runtimes[0];
        
      default:
        return runtimes[0];
    }
  }
  
  private roundRobinSelect(runtimes: RuntimeInstance[]): RuntimeInstance {
    let counter = this.counters.get("round-robin") || 0;
    const selected = runtimes[counter % runtimes.length];
    counter++;
    this.counters.set("round-robin", counter);
    return selected;
  }
  
  private leastLoadedSelect(runtimes: RuntimeInstance[]): RuntimeInstance {
    // Find runtime with fewest busy instances
    // For simplicity, just return first ready runtime
    return runtimes.find((r) => r.status === "ready") || runtimes[0];
  }
  
  private selectByStrategy(): RuntimeInstance | undefined {
    // Try to find any ready runtime of the default type
    const runtimes = this.getByType(this.defaultType);
    if (runtimes.length > 0) {
      return this.getRuntimeByType(this.defaultType);
    }
    
    // Fall back to any ready runtime
    return this.getAll().find((r) => r.status === "ready");
  }
}

/**
 * 创建 Runtime Manager
 */
export function createRuntimeManager(config?: RuntimeRegistryConfig): RuntimeManager {
  return new RuntimeManager(config);
}

/**
 * 默认路由规则工厂
 */
export const DefaultRoutingRules = {
  /**
   * Python 代码路由到 Remote
   */
  pythonToRemote: (remoteType: RuntimeType = "remote"): RoutingRule => ({
    name: "python-remote",
    priority: 10,
    runtimeType: remoteType,
    match: (req) => req.language.toLowerCase() === "python",
  }),
  
  /**
   * 大代码块路由到 Remote
   */
  largeCodeToRemote: (threshold = 10000, remoteType: RuntimeType = "remote"): RoutingRule => ({
    name: "large-code-remote",
    priority: 20,
    runtimeType: remoteType,
    match: (req) => req.code.length > threshold,
  }),
  
  /**
   * 快速执行路由到 Local
   */
  fastExecutionLocal: (timeoutThreshold = 5000): RoutingRule => ({
    name: "fast-local",
    priority: 5,
    runtimeType: "local",
    match: (req) => (req.timeout || 30000) <= timeoutThreshold,
  }),
};
