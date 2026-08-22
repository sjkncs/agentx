/**
 * Hook Registry - Hook定义注册和管理
 * 
 * 管理Hook的注册、配置、启用/禁用
 */

import {
  HookDefinition,
  HookConfig,
  HookContext,
  HookResult,
  HOOK_EVENTS,
  HookEvent,
} from "./hook-types.js";
import { HookBus } from "./hook-bus.js";
import { HookExecutor } from "./hook-executor.js";

/**
 * Hook Registry 配置
 */
export interface HookRegistryConfig {
  /** 是否启用Hook */
  enabled?: boolean;
  /** 默认超时时间 */
  defaultTimeout?: number;
  /** Hook目录 */
  hooksDir?: string;
  /** 是否加载内置Hook */
  loadBuiltin?: boolean;
}

/**
 * Hook Registry - 管理Hook注册
 */
export class HookRegistry {
  private hooks: Map<string, HookDefinition> = new Map();
  private enabledHooks: Set<string> = new Set();
  private hookBus: HookBus;
  private hookExecutor: HookExecutor;
  private listenerIds: Map<string, string> = new Map();
  
  constructor(
    private config: HookRegistryConfig = {},
    bus?: HookBus,
    executor?: HookExecutor
  ) {
    this.hookBus = bus || new HookBus();
    this.hookExecutor = executor || new HookExecutor();
  }
  
  /**
   * 初始化 - 注册所有Hook到Bus
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }
    
    // 注册所有启用的Hook
    for (const [name, hook] of this.hooks) {
      if (this.enabledHooks.has(name)) {
        await this.registerToBus(hook);
      }
    }
  }
  
  /**
   * 注册一个Hook定义
   */
  register(hook: HookDefinition): void {
    // 验证Hook定义
    this.validateHook(hook);
    
    this.hooks.set(hook.name, hook);
    
    if (hook.enabled !== false) {
      this.enabledHooks.add(hook.name);
    }
  }
  
  /**
   * 批量注册Hook
   */
  registerMany(hooks: HookDefinition[]): void {
    for (const hook of hooks) {
      this.register(hook);
    }
  }
  
  /**
   * 从配置文件加载Hook
   */
  async loadFromConfig(config: HookConfig): Promise<void> {
    // 应用默认配置
    const defaults = config.defaults || {};
    
    for (const hookDef of config.hooks) {
      const hook: HookDefinition = {
        ...hookDef,
        enabled: hookDef.enabled ?? defaults.enabled ?? true,
        timeout: hookDef.timeout ?? defaults.timeout,
      };
      
      this.register(hook);
    }
  }
  
  /**
   * 启用一个Hook
   */
  enable(hookName: string): boolean {
    if (!this.hooks.has(hookName)) {
      return false;
    }
    
    this.enabledHooks.add(hookName);
    
    // 如果已初始化，立即注册到Bus
    if (this.hookBus) {
      const hook = this.hooks.get(hookName)!;
      this.registerToBus(hook);
    }
    
    return true;
  }
  
  /**
   * 禁用一个Hook
   */
  disable(hookName: string): boolean {
    if (!this.hooks.has(hookName)) {
      return false;
    }
    
    this.enabledHooks.delete(hookName);
    
    // 从Bus注销
    const listenerId = this.listenerIds.get(hookName);
    if (listenerId) {
      this.hookBus.unregister(listenerId);
      this.listenerIds.delete(hookName);
    }
    
    return true;
  }
  
  /**
   * 获取Hook定义
   */
  get(hookName: string): HookDefinition | undefined {
    return this.hooks.get(hookName);
  }
  
  /**
   * 获取所有Hook
   */
  getAll(): HookDefinition[] {
    return Array.from(this.hooks.values());
  }
  
  /**
   * 获取启用的Hook
   */
  getEnabled(): HookDefinition[] {
    return Array.from(this.hooks.values()).filter((h) =>
      this.enabledHooks.has(h.name)
    );
  }
  
  /**
   * 获取Hook统计
   */
  getStats(): {
    total: number;
    enabled: number;
    disabled: number;
    byEvent: Record<HookEvent, number>;
  } {
    const byEvent: Partial<Record<HookEvent, number>> = {};
    
    for (const event of HOOK_EVENTS) {
      byEvent[event] = 0;
    }
    
    for (const hook of this.hooks.values()) {
      for (const event of hook.events) {
        byEvent[event] = (byEvent[event] || 0) + 1;
      }
    }
    
    return {
      total: this.hooks.size,
      enabled: this.enabledHooks.size,
      disabled: this.hooks.size - this.enabledHooks.size,
      byEvent: byEvent as Record<HookEvent, number>,
    };
  }
  
  /**
   * 触发Hook执行
   */
  async emit(
    event: HookEvent,
    context: HookContext
  ): Promise<HookResult[]> {
    if (!this.config.enabled) {
      return [];
    }
    
    return this.hookBus.emit(event, context);
  }
  
  /**
   * 获取Hook Bus实例
   */
  getBus(): HookBus {
    return this.hookBus;
  }
  
  /**
   * 获取Hook Executor实例
   */
  getExecutor(): HookExecutor {
    return this.hookExecutor;
  }
  
  /**
   * 清理 - 注销所有Hook
   */
  dispose(): void {
    this.hookBus.clear();
    this.listenerIds.clear();
    this.hooks.clear();
    this.enabledHooks.clear();
  }
  
  /**
   * 验证Hook定义
   */
  private validateHook(hook: HookDefinition): void {
    if (!hook.name || hook.name.length === 0) {
      throw new Error("Hook name is required");
    }
    
    if (!hook.events || hook.events.length === 0) {
      throw new Error(`Hook ${hook.name}: at least one event is required`);
    }
    
    for (const event of hook.events) {
      if (!HOOK_EVENTS.includes(event as HookEvent)) {
        throw new Error(
          `Hook ${hook.name}: invalid event "${event}". Valid events: ${HOOK_EVENTS.join(", ")}`
        );
      }
    }
    
    if (!hook.action || !hook.action.type) {
      throw new Error(`Hook ${hook.name}: action is required`);
    }
  }
  
  /**
   * 注册Hook到Bus
   */
  private async registerToBus(hook: HookDefinition): Promise<void> {
    // 如果已经注册，先注销
    const existingListenerId = this.listenerIds.get(hook.name);
    if (existingListenerId) {
      this.hookBus.unregister(existingListenerId);
    }
    
    // 创建处理函数
    const handler = async (context: HookContext): Promise<HookResult> => {
      return this.hookExecutor.execute(hook.action, context);
    };
    
    // 注册到Bus
    const listenerId = this.hookBus.register(hook, handler);
    this.listenerIds.set(hook.name, listenerId);
  }
}

// ============================================================================
// Built-in Hooks
// ============================================================================

/**
 * 内置Hook定义
 */
export const BUILTIN_HOOKS: HookDefinition[] = [
  {
    name: "log-turn-start",
    description: "Log turn start event",
    events: ["turn.start"],
    action: {
      type: "prompt",
      template: "[Turn {{turnId}} started for session {{sessionId}}]",
    },
    enabled: false, // 默认禁用
  },
  {
    name: "log-turn-end",
    description: "Log turn end event",
    events: ["turn.end"],
    action: {
      type: "prompt",
      template: "[Turn {{turnId}} ended for session {{sessionId}}]",
    },
    enabled: false,
  },
  {
    name: "log-tool-call",
    description: "Log tool call event",
    events: ["tool.pre-execute"],
    action: {
      type: "prompt",
      template: "[Tool {{toolName}} called with input: {{toolInput}}]",
    },
    enabled: false,
  },
  {
    name: "log-tool-result",
    description: "Log tool result event",
    events: ["tool.post-execute"],
    action: {
      type: "prompt",
      template: "[Tool {{toolName}} returned: {{toolOutput}}]",
    },
    enabled: false,
  },
];
