/**
 * Plugins - 导出
 */

export {
  // Types
  type Plugin,
  type PluginMetadata,
  type PluginCategory,
  type PluginContext,
  type PluginLifecycleHook,
  type PluginProfile,
  type PluginBundle,
  type PluginManagerConfig,
  type PluginReference,
  type ServiceDefinition,
  type ServiceRegistry,
  type ToolDefinition,
  type ToolExecuteFunction,
  type PluginToolContext,
  type PluginToolRegistry,
  type EventListener,
  type PluginEventBus,
  type PluginConfigStore,
  type ConfigChangeListener,
  
  // Errors
  PluginError,
  PluginLoadError,
  PluginMountError,
  PluginDependencyError,
} from "./plugin-types.js";

export {
  PluginManager,
  createPluginManager,
} from "./plugin-manager.js";

export {
  ServiceRegistryImpl,
} from "./service-registry.js";

export {
  ToolRegistryImpl,
} from "./tool-registry.js";

export {
  EventBusImpl,
  ConfigStoreImpl,
  createPluginContext,
} from "./context.js";
