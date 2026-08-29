# Phase 3: Plugin System

This document describes Phase 3 of the AgentX Harness upgrade.

## Overview

Phase 3 adds a comprehensive plugin system inspired by Cordis:

1. **Plugin Interface** - Standard interface for all plugins
2. **Plugin Manager** - Load, mount, unmount plugins
3. **Service Registry** - Register and access services
4. **Tool Registry** - Register and manage tools
5. **Profile/Bundle** - Organize plugins into profiles

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Plugin System Architecture                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      Plugin Manager                                │   │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐       │   │
│  │  │  Plugin   │ │  Plugin   │ │  Plugin   │ │  Plugin   │       │   │
│  │  │    A      │ │    B      │ │    C      │ │    D      │       │   │
│  │  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘       │   │
│  │        │             │             │             │               │   │
│  │        └─────────────┴─────────────┴─────────────┘               │   │
│  │                           │                                      │   │
│  │  ┌────────────────────────┴────────────────────────┐            │   │
│  │  │                  Plugin Context                    │            │   │
│  │  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ │            │   │
│  │  │  │   Service   │ │    Tool    │ │    Event    │ │            │   │
│  │  │  │  Registry   │ │  Registry  │ │     Bus     │ │            │   │
│  │  │  └─────────────┘ └─────────────┘ └─────────────┘ │            │   │
│  │  └───────────────────────────────────────────────────┘            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Plugin Interface

```typescript
import type { Plugin, PluginContext, PluginMetadata } from "@agentx/harness-core";

class MyPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: "my-plugin",
    name: "My Plugin",
    version: "1.0.0",
    description: "A custom plugin",
  };

  async onMount(context: PluginContext): Promise<void> {
    // Plugin mounted
  }

  async onUnmount(context: PluginContext): Promise<void> {
    // Plugin unmounted
  }

  registerServices(context: PluginContext): void {
    // Register tools, services, etc.
  }
}
```

## Plugin Manager

```typescript
import { 
  PluginManager, 
  createPluginContext,
  ServiceRegistryImpl,
} from "@agentx/harness-core";

const services = new ServiceRegistryImpl();

// Create plugin manager
const manager = new PluginManager(
  (plugin) => createPluginContext(services, {}),
  {},
  { hotReload: true }
);

// Register plugins
manager.register(new MyPlugin());
manager.register(new AnotherPlugin());

// Mount all plugins
await manager.mountAll();

// Check status
console.log(manager.getStats());
// { totalPlugins: 2, mountedPlugins: 2, loadOrder: [...] }
```

## Service Registry

```typescript
// Register a service
services.register("logger", new LoggerService());
services.register("cache", new CacheService());

// Access a service
const logger = services.get<LoggerService>("logger");

// Check if exists
if (services.has("logger")) {
  // ...
}
```

## Tool Registry

```typescript
import type { PluginContext } from "@agentx/harness-core";

function registerMyTools(context: PluginContext): void {
  // Register single tool
  context.tools.register({
    name: "my_tool",
    description: "A custom tool",
    execute: async (input, ctx) => {
      return { result: "success" };
    },
  });

  // Batch register
  context.tools.registerMany([
    { name: "tool1", description: "...", execute: ... },
    { name: "tool2", description: "...", execute: ... },
  ]);

  // List tools
  const allTools = context.tools.list();
  const enabledTools = context.tools.listEnabled();
}
```

## Profile and Bundle

```typescript
// Define a profile
const profile: PluginProfile = {
  id: "default",
  name: "Default Profile",
  plugins: [
    { id: "tool-plugin", enabled: true },
    { id: "analytics-plugin", enabled: true },
    { id: "custom-plugin", enabled: false },
  ],
};

// Define a bundle
const bundle: PluginBundle = {
  id: "agentx-bundle",
  name: "AgentX Bundle",
  profiles: [profile, devProfile, prodProfile],
  defaultProfile: "default",
};

// Load bundle
await manager.loadBundle(bundle);
```

## Complete Example

```typescript
import {
  PluginManager,
  createPluginContext,
  ServiceRegistryImpl,
  ToolRegistryImpl,
  EventBusImpl,
  ConfigStoreImpl,
} from "@agentx/harness-core";
import { MyPlugin, AnotherPlugin } from "./plugins";

// Create core components
const services = new ServiceRegistryImpl();
const events = new EventBusImpl();
const config = new ConfigStoreImpl();

// Create plugin manager
const manager = new PluginManager(
  (plugin) => ({
    services,
    events,
    config,
    tools: new ToolRegistryImpl(),
    userServices: {},
  }),
  {},
  { hotReload: false }
);

// Register plugins
manager.register(new MyPlugin());
manager.register(new AnotherPlugin());

// Mount
await manager.mountAll();

// Use plugin tools
const context = manager.getContext("my-plugin");
if (context) {
  const result = await context.tools.execute(
    "my_tool",
    { input: "test" },
    { sessionId: "s1", runId: "r1", toolName: "my_tool", userServices: {} }
  );
}

// Cleanup
await manager.dispose();
```

## Lifecycle Hooks

```typescript
// Add lifecycle hook
manager.addLifecycleHook("beforeMount", myPlugin, async () => {
  console.log("About to mount plugin");
});

manager.addLifecycleHook("afterMount", myPlugin, async () => {
  console.log("Plugin mounted successfully");
});
```

## Error Handling

```typescript
try {
  await manager.mount("my-plugin");
} catch (error) {
  if (error instanceof PluginLoadError) {
    console.error(`Failed to load: ${error.pluginId}`);
  } else if (error instanceof PluginMountError) {
    console.error(`Failed to mount: ${error.pluginId}`);
  } else if (error instanceof PluginDependencyError) {
    console.error(`Missing deps: ${error.message}`);
  }
}
```

## Implementation Status

| Component | Status | File |
|----------|--------|------|
| Plugin Types | ✅ Complete | `src/plugins/plugin-types.ts` |
| Plugin Manager | ✅ Complete | `src/plugins/plugin-manager.ts` |
| Service Registry | ✅ Complete | `src/plugins/service-registry.ts` |
| Tool Registry | ✅ Complete | `src/plugins/tool-registry.ts` |
| Context | ✅ Complete | `src/plugins/context.ts` |
| Examples | ✅ Complete | `examples/plugins/` |

## Next Steps

**Phase 4**: Multi-Runtime Support
- Local runtime with Bubblewrap
- Cloud runtime with VM isolation
- Enterprise runtime with custom backends

**Phase 5**: Subagent Orchestration
- Fork/Resume/Parallel execution
- Subagent coordination
