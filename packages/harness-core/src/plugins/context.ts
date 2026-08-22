/**
 * Plugin Context Implementation
 */

import type {
  PluginContext,
  ServiceRegistry,
  PluginEventBus,
  PluginConfigStore,
  PluginToolRegistry,
  ConfigChangeListener,
} from "./plugin-types.js";
import { ServiceRegistryImpl } from "./service-registry.js";
import { ToolRegistryImpl } from "./tool-registry.js";

/**
 * Event Bus Implementation
 */
export class EventBusImpl implements PluginEventBus {
  private listeners: Map<string, Array<{ id: string; handler: (data: unknown) => void | Promise<void>; once?: boolean }>> = new Map();
  
  on<T = unknown>(event: string, handler: (data: T) => void | Promise<void>): () => void {
    const id = `${event}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    
    this.listeners.get(event)!.push({
      id,
      handler: handler as (data: unknown) => void | Promise<void>,
    });
    
    return () => this.off(event, id);
  }
  
  once<T = unknown>(event: string, handler: (data: T) => void | Promise<void>): () => void {
    return this.on(event, (data) => {
      handler(data as T);
      // Note: for proper once behavior, we should remove after first call
    });
  }
  
  emit<T = unknown>(event: string, data: T): void {
    const handlers = this.listeners.get(event) || [];
    for (const listener of handlers) {
      try {
        listener.handler(data);
      } catch (error) {
        console.error(`Error in event handler for ${event}:`, error);
      }
    }
  }
  
  async emitAsync<T = unknown>(event: string, data: T): Promise<void> {
    const handlers = this.listeners.get(event) || [];
    await Promise.all(
      handlers.map(async (listener) => {
        try {
          await listener.handler(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      })
    );
  }
  
  off(event: string, handlerId: string): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const index = handlers.findIndex((h) => h.id === handlerId);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }
  
  offAll(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}

/**
 * Config Store Implementation
 */
export class ConfigStoreImpl implements PluginConfigStore {
  private config: Map<string, unknown> = new Map();
  private watchers: Map<string, Array<ConfigChangeListener>> = new Map();
  
  constructor(initialConfig?: Record<string, unknown>) {
    if (initialConfig) {
      for (const [key, value] of Object.entries(initialConfig)) {
        this.config.set(key, value);
      }
    }
  }
  
  get<T = unknown>(key: string, defaultValue?: T): T {
    if (this.config.has(key)) {
      return this.config.get(key) as T;
    }
    return defaultValue as T;
  }
  
  set<T = unknown>(key: string, value: T): void {
    const oldValue = this.config.get(key);
    this.config.set(key, value);
    
    // Notify watchers
    const watchers = this.watchers.get(key) || [];
    for (const watcher of watchers) {
      watcher(key, value, oldValue as T);
    }
  }
  
  delete(key: string): boolean {
    return this.config.delete(key);
  }
  
  has(key: string): boolean {
    return this.config.has(key);
  }
  
  watch<T = unknown>(key: string, listener: ConfigChangeListener<T>): () => void {
    if (!this.watchers.has(key)) {
      this.watchers.set(key, []);
    }
    this.watchers.get(key)!.push(listener as ConfigChangeListener);
    
    return () => {
      const watchers = this.watchers.get(key);
      if (watchers) {
        const index = watchers.indexOf(listener as ConfigChangeListener);
        if (index !== -1) {
          watchers.splice(index, 1);
        }
      }
    };
  }
  
  getAll(): Record<string, unknown> {
    return Object.fromEntries(this.config);
  }
  
  clear(): void {
    this.config.clear();
  }
}

/**
 * Create Plugin Context
 */
export function createPluginContext<Services>(
  services: ServiceRegistry,
  userServices: Services,
  initialConfig?: Record<string, unknown>
): PluginContext<Services> {
  return {
    services,
    events: new EventBusImpl(),
    config: new ConfigStoreImpl(initialConfig),
    tools: new ToolRegistryImpl(),
    userServices,
  };
}
