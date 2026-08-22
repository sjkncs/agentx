/**
 * Hook Bus - 事件总线和Hook执行引擎
 *
 * 负责Hook的注册、监听和执行
 */

import { EventEmitter } from "events";
import type {
  HookEvent,
  HookContext,
  HookResult,
  HookListener,
  HookFilter,
  HookDefinition,
} from "./hook-types.js";
import { EVENT_SOURCE_MAP } from "./hook-types.js";

/**
 * Hook Bus 配置
 */
export interface HookBusConfig {
  /** 是否启用异步执行 */
  async?: boolean;
  /** 默认超时时间 (毫秒) */
  defaultTimeout?: number;
  /** 最大并发Hook数 */
  maxConcurrent?: number;
}

/**
 * Hook Bus - 事件总线
 *
 * 管理Hook的注册和执行，支持：
 * - 事件驱动的Hook触发
 * - 过滤器匹配
 * - 顺序执行
 * - 错误处理
 *
 * 使用组合而非继承 EventEmitter，避免与 Node.js EventEmitter 的类型冲突。
 * 通过内部 EventEmitter 用于跨实例的 'hook:blocked' 等系统事件。
 */
export class HookBus {
  private listeners: Map<string, HookListener[]> = new Map();
  private filterCache: Map<string, boolean> = new Map();
  private systemEmitter: EventEmitter = new EventEmitter();

  constructor(private config: HookBusConfig = {}) {
    this.systemEmitter.setMaxListeners(1000);
  }

  /**
   * 注册一个Hook监听器
   */
  register(hook: HookDefinition, handler: (context: HookContext) => Promise<HookResult | void>): string {
    const listener: HookListener = {
      id: `${hook.name}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      hookName: hook.name,
      events: hook.events,
      handler,
      filter: hook.filter,
      order: hook.order ?? 0,
    };

    // 按事件类型分组注册
    for (const event of hook.events) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, []);
      }

      const eventListeners = this.listeners.get(event)!;

      // 按order排序插入
      const insertIndex = eventListeners.findIndex((l) => l.order > listener.order);
      if (insertIndex === -1) {
        eventListeners.push(listener);
      } else {
        eventListeners.splice(insertIndex, 0, listener);
      }
    }

    return listener.id;
  }

  /**
   * 注销一个Hook监听器
   */
  unregister(listenerId: string): boolean {
    for (const [, listeners] of this.listeners) {
      const index = listeners.findIndex((l) => l.id === listenerId);
      if (index !== -1) {
        listeners.splice(index, 1);
        return true;
      }
    }
    return false;
  }

  /**
   * 注销所有Hook
   */
  clear(): void {
    this.listeners.clear();
    this.filterCache.clear();
  }

  /**
   * 触发Hook执行
   */
  async emit(
    event: HookEvent | string,
    context: HookContext
  ): Promise<HookResult[]> {
    const listeners = this.listeners.get(event as HookEvent) || [];
    const results: HookResult[] = [];

    for (const listener of listeners) {
      // 检查过滤器
      if (listener.filter && !this.matchesFilter(context, listener.filter)) {
        continue;
      }

      try {
        const result = await this.executeHook(listener, context);
        results.push(result);

        // 如果Hook阻止执行，提前返回
        if (result.blocked) {
          this.systemEmitter.emit("hook:blocked", { listener, context, result });
          return results;
        }
      } catch (error) {
        results.push({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          duration: 0,
          blocked: false,
        });
      }
    }

    return results;
  }

  /**
   * 执行单个Hook
   */
  private async executeHook(
    listener: HookListener,
    context: HookContext
  ): Promise<HookResult> {
    const startTime = Date.now();
    const timeout = this.config.defaultTimeout ?? 60000;

    try {
      const handlerResult = await Promise.race([
        Promise.resolve(listener.handler(context)),
        new Promise<HookResult>((_, reject) =>
          setTimeout(() => reject(new Error("Hook execution timeout")), timeout)
        ),
      ]);

      // 构造结果，避免重复字段
      const baseResult = {
        duration: Date.now() - startTime,
      };

      if (handlerResult && typeof handlerResult === "object") {
        const obj = handlerResult as HookResult;
        return {
          success: obj.success ?? true,
          duration: obj.duration ?? baseResult.duration,
          blocked: obj.blocked ?? false,
          output: obj.output,
          error: obj.error,
          metadata: obj.metadata,
        };
      }

      return {
        success: true,
        duration: baseResult.duration,
        blocked: false,
        output: handlerResult === undefined ? undefined : String(handlerResult),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        blocked: false,
      };
    }
  }

  /**
   * 检查上下文是否匹配过滤器
   */
  private matchesFilter(context: HookContext, filter: HookFilter): boolean {
    // 检查工具名称
    if (filter.toolName) {
      const names = Array.isArray(filter.toolName) ? filter.toolName : [filter.toolName];
      if (!names.includes(context.toolName || "")) {
        return false;
      }
    }

    // 检查工具名称模式
    if (filter.toolPattern && context.toolName) {
      const regex = new RegExp(filter.toolPattern);
      if (!regex.test(context.toolName)) {
        return false;
      }
    }

    // 检查错误类型
    if (filter.errorType && context.error) {
      if (!context.error.includes(filter.errorType)) {
        return false;
      }
    }

    // 检查阶段
    if (filter.phase && context.metadata?.phase) {
      if (context.metadata.phase !== filter.phase) {
        return false;
      }
    }

    return true;
  }

  /**
   * 从DataFoundry/Mastra事件触发Hook
   */
  async emitFromSource(
    sourceEvent: string,
    payload: unknown,
    defaults: Partial<HookContext> = {}
  ): Promise<HookResult[]> {
    const hookEvent = EVENT_SOURCE_MAP[sourceEvent];

    if (!hookEvent) {
      return [];
    }

    const context: HookContext = {
      event: hookEvent,
      sessionId: defaults.sessionId || "",
      runId: defaults.runId || "",
      payload,
      metadata: defaults.metadata || {},
      ...defaults,
    };

    return this.emit(hookEvent, context);
  }

  /**
   * 监听系统事件（如 hook:blocked）
   */
  on(event: string, listener: (...args: unknown[]) => void): this {
    this.systemEmitter.on(event, listener);
    return this;
  }

  /**
   * 取消监听系统事件
   */
  off(event: string, listener: (...args: unknown[]) => void): this {
    this.systemEmitter.off(event, listener);
    return this;
  }

  /**
   * 移除所有系统事件监听器
   */
  removeAllListeners(event?: string): this {
    this.systemEmitter.removeAllListeners(event);
    return this;
  }

  /**
   * 获取所有已注册的Hook
   */
  getRegisteredHooks(): { event: HookEvent; listeners: HookListener[] }[] {
    const result: { event: HookEvent; listeners: HookListener[] }[] = [];

    for (const [event, listeners] of this.listeners) {
      if (listeners.length > 0) {
        result.push({ event: event as HookEvent, listeners: [...listeners] });
      }
    }

    return result;
  }

  /**
   * 获取Hook数量统计
   */
  getStats(): {
    totalHooks: number;
    byEvent: Record<HookEvent, number>;
    byName: Record<string, number>;
  } {
    const byEvent: Partial<Record<HookEvent, number>> = {};
    const byName: Record<string, number> = {};
    let total = 0;

    for (const [event, listeners] of this.listeners) {
      byEvent[event as HookEvent] = listeners.length;
      total += listeners.length;

      for (const listener of listeners) {
        byName[listener.hookName] = (byName[listener.hookName] || 0) + 1;
      }
    }

    return {
      totalHooks: total,
      byEvent: byEvent as Record<HookEvent, number>,
      byName,
    };
  }
}