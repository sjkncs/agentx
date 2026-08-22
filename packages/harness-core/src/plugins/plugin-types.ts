/**
 * Plugin System - 插件系统核心类型
 * 
 * 借鉴 Cordis 的插件架构，提供可插拔的扩展机制
 */

import { z } from "zod";

// ============================================================================
// Plugin Types
// ============================================================================

/**
 * 插件元数据
 */
export interface PluginMetadata {
  /** 唯一标识符 */
  readonly id: string;
  /** 插件名称 */
  readonly name: string;
  /** 版本号 */
  readonly version: string;
  /** 描述 */
  readonly description?: string;
  /** 作者 */
  readonly author?: string;
  /** 许可证 */
  readonly license?: string;
  /** 入口点 */
  readonly entry?: string;
  /** 依赖的插件 */
  readonly dependencies?: string[];
  /** 分类 */
  readonly categories?: PluginCategory[];
  /** 标签 */
  readonly tags?: string[];
}

/**
 * 插件分类
 */
export type PluginCategory =
  | "tool"
  | "skill"
  | "protocol"
  | "runtime"
  | "ui"
  | "integration"
  | "analytics"
  | "custom";

/**
 * 插件接口
 */
export interface Plugin<Services = unknown> {
  /** 元数据 */
  readonly metadata: PluginMetadata;
  
  /**
   * 挂载插件
   * @param context 插件上下文
   */
  onMount(context: PluginContext<Services>): Promise<void>;
  
  /**
   * 卸载插件
   * @param context 插件上下文
   */
  onUnmount(context: PluginContext<Services>): Promise<void>;
  
  /**
   * 注册服务
   * @param context 插件上下文
   */
  registerServices(context: PluginContext<Services>): void;
  
  /**
   * 获取插件配置 schema
   */
  getConfigSchema?(): z.ZodType<unknown>;
}

// ============================================================================
// Plugin Context
// ============================================================================

/**
 * 插件上下文
 */
export interface PluginContext<Services = unknown> {
  /** 服务注册表 */
  readonly services: ServiceRegistry;
  
  /** 事件总线 */
  readonly events: PluginEventBus;
  
  /** 配置存储 */
  readonly config: PluginConfigStore;
  
  /** 工具注册表 */
  readonly tools: PluginToolRegistry;
  
  /** 用户服务 */
  readonly userServices: Services;
}

/**
 * 插件生命周期钩子
 */
export type PluginLifecycleHook = 
  | "beforeMount"
  | "afterMount"
  | "beforeUnmount"
  | "afterUnmount"
  | "beforeRegister"
  | "afterRegister";

// ============================================================================
// Service Registry
// ============================================================================

/**
 * 服务定义
 */
export interface ServiceDefinition<T = unknown> {
  /** 服务名称 */
  readonly name: string;
  /** 服务实例 */
  instance: T;
  /** 服务描述 */
  readonly description?: string;
  /** 是否单例 */
  readonly singleton?: boolean;
}

/**
 * 服务注册表
 */
export interface ServiceRegistry {
  /** 注册服务 */
  register<T>(name: string, instance: T, description?: string): void;
  
  /** 获取服务 */
  get<T>(name: string): T | undefined;
  
  /** 检查服务是否存在 */
  has(name: string): boolean;
  
  /** 注销服务 */
  unregister(name: string): boolean;
  
  /** 获取所有服务名称 */
  list(): string[];
}

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * 工具定义
 */
export interface ToolDefinition {
  /** 工具名称 */
  readonly name: string;
  /** 工具描述 */
  readonly description: string;
  /** 输入 Schema */
  readonly inputSchema?: z.ZodType<unknown>;
  /** 执行函数 */
  readonly execute: ToolExecuteFunction;
  /** 是否启用 */
  enabled?: boolean;
}

/**
 * 工具执行函数
 */
export type ToolExecuteFunction = (
  input: unknown,
  context: PluginToolContext
) => Promise<unknown>;

/**
 * 工具执行上下文
 */
export interface PluginToolContext {
  /** 会话ID */
  sessionId: string;
  /** 运行ID */
  runId: string;
  /** 工具名称 */
  toolName: string;
  /** 用户服务 */
  userServices: unknown;
}

/**
 * 工具注册表
 */
export interface PluginToolRegistry {
  /** 注册工具 */
  register(tool: ToolDefinition): void;
  
  /** 批量注册工具 */
  registerMany(tools: ToolDefinition[]): void;
  
  /** 获取工具 */
  get(name: string): ToolDefinition | undefined;
  
  /** 检查工具是否存在 */
  has(name: string): boolean;
  
  /** 启用工具 */
  enable(name: string): boolean;
  
  /** 禁用工具 */
  disable(name: string): boolean;
  
  /** 注销工具 */
  unregister(name: string): boolean;
  
  /** 获取所有工具 */
  list(): ToolDefinition[];
  
  /** 获取启用的工具 */
  listEnabled(): ToolDefinition[];
}

// ============================================================================
// Event Bus
// ============================================================================

/**
 * 事件监听器
 */
export interface EventListener<T = unknown> {
  /** 监听器ID */
  readonly id: string;
  /** 事件名称 */
  readonly event: string;
  /** 处理函数 */
  handler: (data: T) => void | Promise<void>;
  /** 是否一次性 */
  once?: boolean;
}

/**
 * 插件事件总线
 */
export interface PluginEventBus {
  /** 订阅事件 */
  on<T = unknown>(event: string, handler: (data: T) => void | Promise<void>): () => void;
  
  /** 订阅一次性事件 */
  once<T = unknown>(event: string, handler: (data: T) => void | Promise<void>): () => void;
  
  /** 发布事件 */
  emit<T = unknown>(event: string, data: T): void;
  
  /** 异步发布事件 */
  emitAsync<T = unknown>(event: string, data: T): Promise<void>;
  
  /** 移除事件监听 */
  off(event: string, handlerId: string): void;
  
  /** 移除所有事件监听 */
  offAll(event?: string): void;
}

// ============================================================================
// Config Store
// ============================================================================

/**
 * 配置变更监听器
 */
export type ConfigChangeListener<T = unknown> = (key: string, value: T, oldValue: T) => void;

/**
 * 插件配置存储
 */
export interface PluginConfigStore {
  /** 获取配置 */
  get<T = unknown>(key: string, defaultValue?: T): T;
  
  /** 设置配置 */
  set<T = unknown>(key: string, value: T): void;
  
  /** 删除配置 */
  delete(key: string): boolean;
  
  /** 检查配置是否存在 */
  has(key: string): boolean;
  
  /** 监听配置变更 */
  watch<T = unknown>(key: string, listener: ConfigChangeListener<T>): () => void;
  
  /** 获取所有配置 */
  getAll(): Record<string, unknown>;
  
  /** 清除所有配置 */
  clear(): void;
}

// ============================================================================
// Plugin Profile
// ============================================================================

/**
 * 插件配置文件
 */
export interface PluginProfile {
  /** Profile ID */
  readonly id: string;
  /** Profile 名称 */
  readonly name: string;
  /** 描述 */
  readonly description?: string;
  /** 包含的插件 */
  readonly plugins: PluginReference[];
  /** 全局配置 */
  readonly config?: Record<string, unknown>;
  /** 环境变量 */
  readonly env?: Record<string, string>;
  /** 优先级 (数字越小优先级越高) */
  readonly priority?: number;
}

/**
 * 插件引用
 */
export interface PluginReference {
  /** 插件ID */
  readonly id: string;
  /** 版本约束 */
  readonly version?: string;
  /** 是否启用 */
  readonly enabled?: boolean;
  /** 插件配置 */
  readonly config?: Record<string, unknown>;
}

// ============================================================================
// Plugin Bundle
// ============================================================================

/**
 * 插件包
 */
export interface PluginBundle {
  /** Bundle ID */
  readonly id: string;
  /** Bundle 名称 */
  readonly name: string;
  /** 描述 */
  readonly description?: string;
  /** 包含的 Profile */
  readonly profiles: PluginProfile[];
  /** 默认 Profile */
  readonly defaultProfile?: string;
}

/**
 * Plugin Manager 配置
 */
export interface PluginManagerConfig {
  /** 插件目录 */
  pluginsDir?: string;
  /** 是否启用热加载 */
  hotReload?: boolean;
  /** 是否启用严格模式 */
  strict?: boolean;
  /** 插件加载超时 */
  loadTimeout?: number;
}

// ============================================================================
// Plugin Errors
// ============================================================================

/**
 * 插件错误类型
 */
export class PluginError extends Error {
  constructor(
    message: string,
    public readonly pluginId?: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = "PluginError";
  }
}

export class PluginLoadError extends PluginError {
  constructor(pluginId: string, message: string) {
    super(`Failed to load plugin ${pluginId}: ${message}`, pluginId, "LOAD_ERROR");
    this.name = "PluginLoadError";
  }
}

export class PluginMountError extends PluginError {
  constructor(pluginId: string, message: string) {
    super(`Failed to mount plugin ${pluginId}: ${message}`, pluginId, "MOUNT_ERROR");
    this.name = "PluginMountError";
  }
}

export class PluginDependencyError extends PluginError {
  constructor(pluginId: string, missingDeps: string[]) {
    super(
      `Plugin ${pluginId} has unresolved dependencies: ${missingDeps.join(", ")}`,
      pluginId,
      "DEPENDENCY_ERROR"
    );
    this.name = "PluginDependencyError";
  }
}
