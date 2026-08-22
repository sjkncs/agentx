/**
 * Hook System - 导出
 * 
 * DataFoundry Harness Core Hook系统
 */

// Types
export {
  type HookEvent,
  type HookAction,
  type HookContext,
  type HookResult,
  type HookDefinition,
  type HookConfig,
  type HookFilter,
  type HookListener,
  type HookHandler,
  type HookAttachment,
  HOOK_EVENTS,
  EVENT_SOURCE_MAP,
  createHookContext,
  ShellHookActionSchema,
  HttpHookActionSchema,
  McpHookActionSchema,
  PromptHookActionSchema,
  HookActionSchema,
  HookDefinitionSchema,
  HookConfigSchema,
  HookFilterSchema,
} from "./hook-types.js";

// Hook Bus
export { HookBus, type HookBusConfig } from "./hook-bus.js";

// Hook Executor
export { HookExecutor, type HookExecutorConfig } from "./hook-executor.js";

// Hook Registry
export {
  HookRegistry,
  type HookRegistryConfig,
  BUILTIN_HOOKS,
} from "./hook-registry.js";

// Hook Config Loader
export {
  loadHookConfig,
  findHookConfig,
  loadHookConfigFromEnv,
  createDefaultHookConfig,
  HOOK_CONFIG_EXAMPLE,
  HookConfigFileSchema,
} from "./hook-config.js";
