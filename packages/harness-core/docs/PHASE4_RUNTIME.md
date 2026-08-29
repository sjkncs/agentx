# Phase 4: Multi-Runtime Support

This document describes Phase 4 of the AgentX Harness upgrade.

## Overview

Phase 4 adds comprehensive multi-runtime support:

1. **Runtime Interface** - Standard interface for all runtimes
2. **Local Runtime** - Node.js sandbox execution
3. **Remote Runtime** - Cloud API execution
4. **Runtime Manager** - Manage and route between runtimes

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Multi-Runtime Architecture                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                        Runtime Manager                                  │  │
│  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐           │  │
│  │  │  Routing Rules │ │ Strategy Select │ │ Load Balancer  │           │  │
│  │  └────────────────┘ └────────────────┘ └────────────────┘           │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                      │                                       │
│           ┌──────────────────────────┼──────────────────────────┐          │
│           │                          │                          │          │
│           ▼                          ▼                          ▼          │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐     │
│  │   Local Runtime  │    │  Remote Runtime │    │ Enterprise       │     │
│  │                  │    │                 │    │ Runtime          │     │
│  │  - Node.js VM    │    │  - Cloud API    │    │                  │     │
│  │  - Sandbox       │    │  - Isolated     │    │  - Kubernetes    │     │
│  │  - Fast          │    │  - Scalable    │    │  - Docker        │     │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Runtime Interface

```typescript
import type { RuntimeInstance, ExecutionRequest } from "@agentx/harness-core";

interface RuntimeInstance<Config> {
  readonly id: string;
  readonly type: RuntimeType;
  status: RuntimeStatus;
  capabilities: RuntimeCapabilities;
  
  initialize(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
  getSession(): SessionInfo;
  dispose(): Promise<void>;
}
```

## Local Runtime

```typescript
import { LocalRuntime, createLocalRuntime, createSecureLocalRuntime } from "@agentx/harness-core";

// Basic usage
const runtime = createLocalRuntime("my-local", {
  workingDirectory: "./workspace",
  timeout: 30000,
  maxMemoryMB: 512,
});

await runtime.start();

const result = await runtime.execute({
  code: "console.log('Hello from local runtime!')",
  language: "javascript",
});

console.log(result); // { success: true, stdout: 'Hello from local runtime!' }

// Secure mode
const secureRuntime = createSecureLocalRuntime("secure-1");
// Blocks: child_process, fs, net, http, dns, cluster
```

## Remote Runtime

```typescript
import { RemoteRuntime, createAgentXCloudRuntime } from "@agentx/harness-core";

// Custom endpoint
const runtime = new RemoteRuntime("remote-1", {
  endpoint: "https://api.example.com/runtime",
  apiKey: process.env.API_KEY,
  timeout: 120000,
  retries: 3,
});

// AgentX Cloud
const cloudRuntime = createAgentXCloudRuntime(
  "cloud-1",
  process.env.DF_API_KEY!,
  "us-east-1"
);

await runtime.start();

const result = await runtime.execute({
  code: "# Python code",
  language: "python",
  timeout: 60000,
});
```

## Runtime Manager

```typescript
import { RuntimeManager, createRuntimeManager, DefaultRoutingRules } from "@agentx/harness-core";

// Create manager
const manager = createRuntimeManager({
  defaultType: "local",
  autoStart: true,
  maxInstances: 5,
});

// Register runtimes
manager.register(createLocalRuntime("local-1"));
manager.register(createLocalRuntime("local-2"));
manager.register(createRemoteRuntime("remote-1", {
  endpoint: "https://api.example.com/runtime",
}));

// Add routing rules
manager.addRule(DefaultRoutingRules.pythonToRemote());
manager.addRule(DefaultRoutingRules.largeCodeToRemote(5000));
manager.addRule(DefaultRoutingRules.fastExecutionLocal(1000));

// Set strategy
manager.setStrategy("round-robin"); // or "random", "least-loaded", "capability-based"

// Execute (auto-routed)
const result = await manager.execute({
  code: "...",
  language: "javascript",
});

// Or route manually
const runtime = manager.route({ language: "python", code: "..." });
if (runtime) {
  const result = await runtime.execute({ language: "python", code: "..." });
}
```

## Routing Rules

```typescript
import type { RoutingRule } from "@agentx/harness-core";

// Custom rule
const customRule: RoutingRule = {
  name: "my-rule",
  priority: 1,
  runtimeType: "remote",
  match: (request) => {
    // Route based on any condition
    return request.context?.requiresGpu === true;
  },
};

manager.addRule(customRule);

// Priority: lower number = higher priority
```

## Execution Request & Result

```typescript
interface ExecutionRequest {
  code: string;
  language: string;
  context?: Record<string, unknown>;
  timeout?: number;
  sessionId?: string;
}

interface ExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  duration: number;
  memoryUsageMB?: number;
  tokensUsed?: number;
}
```

## Capabilities

```typescript
interface RuntimeCapabilities {
  canExecuteCode: boolean;
  canAccessFileSystem: boolean;
  canMakeNetworkRequests: boolean;
  canAccessEnvironmentVariables: boolean;
  canSpawnProcesses: boolean;
  maxMemoryMB?: number;
  timeoutLimit?: number;
}

// Check before executing
const runtime = manager.getDefault();
if (runtime.capabilities.canMakeNetworkRequests) {
  // Safe to make network calls
}
```

## Error Handling

```typescript
import { 
  RuntimeError,
  RuntimeInitError,
  RuntimeExecutionError,
  RuntimeTimeoutError,
} from "@agentx/harness-core";

try {
  await runtime.execute({ code: "...", language: "javascript" });
} catch (error) {
  if (error instanceof RuntimeTimeoutError) {
    console.log("Execution timed out");
  } else if (error instanceof RuntimeExecutionError) {
    console.log("Execution failed:", error.originalError);
  } else if (error instanceof RuntimeInitError) {
    console.log("Runtime initialization failed");
  }
}
```

## Complete Example

```typescript
import {
  createRuntimeManager,
  createLocalRuntime,
  createAgentXCloudRuntime,
  DefaultRoutingRules,
} from "@agentx/harness-core";

async function main() {
  // 1. Create manager
  const manager = createRuntimeManager({
    defaultType: "local",
    maxInstances: 3,
  });

  // 2. Register runtimes
  manager.register(createLocalRuntime("fast-local"));
  manager.register(createLocalRuntime("slow-local"));
  manager.register(createAgentXCloudRuntime("cloud", process.env.API_KEY!));

  // 3. Configure routing
  manager.setStrategy("least-loaded");
  manager.addRule(DefaultRoutingRules.pythonToRemote());
  manager.addRule(DefaultRoutingRules.fastExecutionLocal());

  // 4. Execute
  const result = await manager.execute({
    code: "const x = 1 + 2; x;",
    language: "javascript",
    timeout: 5000,
  });

  console.log(result);

  // 5. Cleanup
  await manager.dispose();
}

main();
```

## Implementation Status

| Component | Status | File |
|----------|--------|------|
| Runtime Types | ✅ Complete | `src/runtime/runtime-types.ts` |
| Local Runtime | ✅ Complete | `src/runtime/local-runtime.ts` |
| Remote Runtime | ✅ Complete | `src/runtime/remote-runtime.ts` |
| Runtime Manager | ✅ Complete | `src/runtime/runtime-manager.ts` |
| Export/Integration | ✅ Complete | `src/runtime/index.ts`, `src/index.ts` |

## Next Steps

**Phase 5**: Subagent Orchestration
- Fork/Resume/Parallel execution
- Subagent coordination
- Multi-agent workflows

**Phase 6**: MCP Server Integration
- MCP protocol support
- Tool bridging
