/**
 * Plugin Manager - 插件管理器
 * 
 * 管理插件的加载、挂载、卸载
 */

import type {
  Plugin,
  PluginMetadata,
  PluginContext,
  PluginProfile,
  PluginManagerConfig,
  PluginBundle,
  PluginLifecycleHook,
} from "./plugin-types.js";
import { PluginLoadError, PluginMountError, PluginDependencyError } from "./plugin-types.js";

// ============================================================================
// Lifecycle Hook Handlers
// ============================================================================

interface LifecycleHookHandlers {
  beforeMount: Array<{ plugin: Plugin; handler: () => void | Promise<void> }>;
  afterMount: Array<{ plugin: Plugin; handler: () => void | Promise<void> }>;
  beforeUnmount: Array<{ plugin: Plugin; handler: () => void | Promise<void> }>;
  afterUnmount: Array<{ plugin: Plugin; handler: () => void | Promise<void> }>;
}

/**
 * Plugin Manager - 插件管理器
 */
export class PluginManager<Services = unknown> {
  private plugins: Map<string, Plugin> = new Map();
  private mountedPlugins: Set<string> = new Set();
  private contexts: Map<string, PluginContext<Services>> = new Map();
  private lifecycleHooks: LifecycleHookHandlers = {
    beforeMount: [],
    afterMount: [],
    beforeUnmount: [],
    afterUnmount: [],
  };
  private loadOrder: string[] = [];
  
  constructor(
    private contextFactory: (plugin: Plugin) => PluginContext<Services>,
    private userServices: Services,
    private config: PluginManagerConfig = {}
  ) {}
  
  /**
   * 注册插件
   */
  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.metadata.id)) {
      throw new PluginLoadError(
        plugin.metadata.id,
        "Plugin already registered"
      );
    }
    
    this.plugins.set(plugin.metadata.id, plugin);
  }
  
  /**
   * 批量注册插件
   */
  registerMany(plugins: Plugin[]): void {
    for (const plugin of plugins) {
      this.register(plugin);
    }
  }
  
  /**
   * 加载并挂载插件
   */
  async mount(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new PluginLoadError(pluginId, "Plugin not found");
    }
    
    if (this.mountedPlugins.has(pluginId)) {
      return; // Already mounted
    }
    
    // Check dependencies
    const missingDeps = this.checkDependencies(plugin);
    if (missingDeps.length > 0) {
      throw new PluginDependencyError(pluginId, missingDeps);
    }
    
    // Ensure dependencies are mounted
    for (const depId of plugin.metadata.dependencies || []) {
      if (!this.mountedPlugins.has(depId)) {
        await this.mount(depId);
      }
    }
    
    // Create context
    const context = this.contextFactory(plugin);
    this.contexts.set(pluginId, context);
    
    // Execute beforeMount hooks
    await this.executeLifecycleHook("beforeMount", plugin);
    
    try {
      // Register services first
      plugin.registerServices(context);
      
      // Mount plugin
      await plugin.onMount(context);
      
      // Mark as mounted
      this.mountedPlugins.add(pluginId);
      this.loadOrder.push(pluginId);
      
      // Execute afterMount hooks
      await this.executeLifecycleHook("afterMount", plugin);
    } catch (error) {
      // Rollback
      this.contexts.delete(pluginId);
      this.mountedPlugins.delete(pluginId);
      const idx = this.loadOrder.indexOf(pluginId);
      if (idx !== -1) this.loadOrder.splice(idx, 1);
      
      throw new PluginMountError(
        pluginId,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  
  /**
   * 卸载插件
   */
  async unmount(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin || !this.mountedPlugins.has(pluginId)) {
      return; // Not mounted
    }
    
    const context = this.contexts.get(pluginId);
    if (!context) {
      return;
    }
    
    // Execute beforeUnmount hooks
    await this.executeLifecycleHook("beforeUnmount", plugin);
    
    try {
      await plugin.onUnmount(context);
      
      // Remove from mounted
      this.mountedPlugins.delete(pluginId);
      this.contexts.delete(pluginId);
      
      // Remove from load order
      const idx = this.loadOrder.indexOf(pluginId);
      if (idx !== -1) this.loadOrder.splice(idx, 1);
      
      // Execute afterUnmount hooks
      await this.executeLifecycleHook("afterUnmount", plugin);
    } catch (error) {
      console.error(`Failed to unmount plugin ${pluginId}:`, error);
      // Force unmount even on error
      this.mountedPlugins.delete(pluginId);
      this.contexts.delete(pluginId);
    }
  }
  
  /**
   * 挂载所有已注册的插件
   */
  async mountAll(): Promise<void> {
    // Resolve load order
    const sortedPlugins = this.resolveLoadOrder();
    
    for (const plugin of sortedPlugins) {
      if (!this.mountedPlugins.has(plugin.metadata.id)) {
        await this.mount(plugin.metadata.id);
      }
    }
  }
  
  /**
   * 卸载所有插件
   */
  async unmountAll(): Promise<void> {
    // Unmount in reverse order
    const reversed = [...this.loadOrder].reverse();
    
    for (const pluginId of reversed) {
      await this.unmount(pluginId);
    }
  }
  
  /**
   * 获取插件
   */
  get(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId);
  }
  
  /**
   * 获取所有已注册的插件
   */
  getAll(): Plugin[] {
    return Array.from(this.plugins.values());
  }
  
  /**
   * 获取已挂载的插件
   */
  getMounted(): Plugin[] {
    return this.loadOrder
      .map((id) => this.plugins.get(id))
      .filter((p): p is Plugin => p !== undefined);
  }
  
  /**
   * 获取插件上下文
   */
  getContext(pluginId: string): PluginContext<Services> | undefined {
    return this.contexts.get(pluginId);
  }
  
  /**
   * 检查插件是否已挂载
   */
  isMounted(pluginId: string): boolean {
    return this.mountedPlugins.has(pluginId);
  }
  
  /**
   * 添加生命周期钩子
   */
  addLifecycleHook(
    hook: PluginLifecycleHook,
    plugin: Plugin,
    handler: () => void | Promise<void>
  ): void {
    const hookKey = hook as keyof LifecycleHookHandlers;
    if (this.lifecycleHooks[hookKey]) {
      this.lifecycleHooks[hookKey].push({ plugin, handler });
    }
  }
  
  /**
   * 从 Profile 加载
   */
  async loadProfile(profile: PluginProfile): Promise<void> {
    for (const ref of profile.plugins) {
      if (ref.enabled !== false) {
        const plugin = this.plugins.get(ref.id);
        if (plugin) {
          if (ref.config) {
            // Merge config
            for (const [key, value] of Object.entries(ref.config)) {
              const context = this.contexts.get(ref.id);
              context?.config.set(key, value);
            }
          }
          await this.mount(ref.id);
        }
      }
    }
  }
  
  /**
   * 从 Bundle 加载
   */
  async loadBundle(bundle: PluginBundle): Promise<void> {
    const profileId = bundle.defaultProfile || bundle.profiles[0]?.id;
    const profile = bundle.profiles.find((p) => p.id === profileId);
    
    if (profile) {
      await this.loadProfile(profile);
    }
  }
  
  /**
   * 获取插件统计
   */
  getStats(): {
    totalPlugins: number;
    mountedPlugins: number;
    loadOrder: string[];
  } {
    return {
      totalPlugins: this.plugins.size,
      mountedPlugins: this.mountedPlugins.size,
      loadOrder: [...this.loadOrder],
    };
  }
  
  /**
   * 清理
   */
  async dispose(): Promise<void> {
    await this.unmountAll();
    this.plugins.clear();
    this.contexts.clear();
    this.lifecycleHooks = {
      beforeMount: [],
      afterMount: [],
      beforeUnmount: [],
      afterUnmount: [],
    };
  }
  
  // ============================================================================
  // Private Methods
  // ============================================================================
  
  private checkDependencies(plugin: Plugin): string[] {
    const missing: string[] = [];
    
    for (const depId of plugin.metadata.dependencies || []) {
      if (!this.plugins.has(depId)) {
        missing.push(depId);
      }
    }
    
    return missing;
  }
  
  private resolveLoadOrder(): Plugin[] {
    const result: Plugin[] = [];
    const visited = new Set<string>();
    
    const visit = (plugin: Plugin) => {
      if (visited.has(plugin.metadata.id)) return;
      visited.add(plugin.metadata.id);
      
      // Visit dependencies first
      for (const depId of plugin.metadata.dependencies || []) {
        const dep = this.plugins.get(depId);
        if (dep) visit(dep);
      }
      
      result.push(plugin);
    };
    
    for (const plugin of this.plugins.values()) {
      visit(plugin);
    }
    
    return result;
  }
  
  private async executeLifecycleHook(
    hook: PluginLifecycleHook,
    plugin: Plugin
  ): Promise<void> {
    const hookKey = hook as keyof LifecycleHookHandlers;
    const handlers = this.lifecycleHooks[hookKey] || [];
    
    for (const { handler } of handlers) {
      await Promise.resolve(handler());
    }
  }
}

/**
 * 创建 Plugin Manager
 */
export function createPluginManager<Services>(
  contextFactory: (plugin: Plugin) => PluginContext<Services>,
  userServices: Services,
  config?: PluginManagerConfig
): PluginManager<Services> {
  return new PluginManager(contextFactory, userServices, config);
}
