# DataFoundry Harness Core - Final Documentation

## Project Overview

DataFoundry Harness Core 是一个完整的 AI Agent 编排框架，基于 Cursor/DeepSeek/Cordis 设计理念实现。

## 10-Phase Implementation Complete

### Phase 1: Hook System ✅
事件驱动的扩展系统，灵感来自 Cursor 的 Hook Bus。

### Phase 2: Session Event Log ✅
不可变、追加式的会话日志，支持分析和回放。

### Phase 3: Plugin System ✅
Cordis 风格的插件架构，支持热加载和服务注册。

### Phase 4: Multi-Runtime Support ✅
多运行时支持（Local/Remote/VM 隔离）。

### Phase 5: Subagent Orchestration ✅
子代理编排（Fork/Resume/Parallel/Pipeline）。

### Phase 6: MCP Server Integration ✅
Model Context Protocol 完整支持。

### Phase 7: Sandbox Isolation ✅
4 种沙箱实现（VM/Process/Docker/WebContainer）。

### Phase 8: Deterministic Gates ✅
确定性门控（Lint/Test/TypeCheck/Build/Format/Coverage）。

### Phase 9: Cursor SDK Integration ✅
Cursor IDE 集成（Local + Cloud）。

### Phase 10: E2E Integration Testing ✅
完整的端到端集成测试套件。

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DataFoundry Harness Core                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  �─────────────────────────────────────────────────────────────────────┐    │
│  │                     External Integrations                            │    │
│  │                                                                       │    │
│  │   ┌──────────┐  ┌──────────�  ┌──────────┐  ┌──────────┐  ┌──────┐│    │
│  │   │ Cursor   │  │   MCP    │  │  Docker  │  │ Subagent │  │ LLM  ││    │
│  │   │   SDK    │  │  Server  │  │ Sandbox  │  │  Manager │  │ API  ││    │
│  │   └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────┘│    │
│  │                                                                       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     Core Systems                                      │    │
│  │                                                                       │    │
│  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────┐ │    │
│  │   │    Hook     │  │  Event Log  │  │   Plugin    │  │  Sandbox │ │    │
│  │   │    Bus      │  │             │  │   Registry  │  │  Manager │ │    │
│  │   └─────────────┘  └─────────────┘  └─────────────┘  └──────────┘ │    │
│  │                                                                       │    │
│  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────┐ │    │
│  │   │  Runtime    │  │  Subagent   │  │    Gate     │  │    IDE   │ │    │
│  │   │  Manager    │  │ Orchestrator│  │   Manager   │  │ Workflow │ │    │
│  │   └─────────────┘  └─────────────┘  └─────────────┘  └──────────┘ │    │
│  │                                                                       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     Foundation Layer                                   │    │
│  │                                                                       │    │
│  │   Types  │  Errors  │  Events  │  State  │  Logging  │  Config       │    │
│  │                                                                       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Module Structure

```
packages/harness-core/src/
├── hooks/              # Phase 1: Hook System
│   ├── hook-types.ts
│   ├── hook-bus.ts
│   ├── hook-registry.ts
│   ├── hook-executor.ts
│   ├── hook-adapter.ts
│   └── index.ts
│
├── eventlog/           # Phase 2: Session Event Log
│   ├── event-types.ts
│   ├── session-event-log.ts
│   ├── event-log-adapter.ts
│   ├── timeline-recorder.ts
│   ├── event-analytics.ts
│   └── index.ts
│
├── plugins/            # Phase 3: Plugin System
│   ├── plugin-types.ts
│   ├── plugin-registry.ts
│   ├── service-registry.ts
│   ├── profile.ts
│   ├── bundle.ts
│   └── index.ts
│
├── runtime/            # Phase 4: Multi-Runtime
│   ├── runtime-types.ts
│   ├── runtime-base.ts
│   ├── local-runtime.ts
│   ├── remote-runtime.ts
│   ├── runtime-manager.ts
│   ├── routing.ts
│   └── index.ts
│
├── subagent/           # Phase 5: Subagent Orchestration
│   ├── subagent-types.ts
│   ├── subagent.ts
│   ├── subagent-manager.ts
│   ├── orchestrator.ts
│   └── index.ts
│
├── mcp/                # Phase 6: MCP Integration
│   ├── mcp-types.ts
│   ├── mcp-transport.ts
│   ├── mcp-client.ts
│   ├── mcp-server.ts
│   ├── mcp-bridge.ts
│   └── index.ts
│
├── sandbox/            # Phase 7: Sandbox Isolation
│   ├── sandbox-types.ts
│   ├── sandbox.ts
│   ├── sandbox-manager.ts
│   └── index.ts
│
├── gates/              # Phase 8: Deterministic Gates
│   ├── gate-types.ts
│   ├── built-in-gates.ts
│   ├── gate-manager.ts
│   └── index.ts
│
├── cursor/             # Phase 9: Cursor SDK
│   ├── cursor-types.ts
│   ├── cursor-adapter.ts
│   ├── ide-workflow.ts
│   └── index.ts
│
├── __tests__/          # Phase 10: E2E Tests
│   ├── integration.test.ts
│   └── performance.test.ts
│
└── index.ts            # Main Entry Point
```

## Key Features

### 1. Extensible Hook System
```typescript
const bus = new HookBus();

bus.register('agent.before_step', async (data) => {
  console.log('Step starting:', data);
});
```

### 2. Append-Only Event Log
```typescript
const log = new SessionEventLog({ workdir: '/tmp' });
log.append({ type: 'user_input', data: { text: 'Hello' } });
const events = log.readAll();
```

### 3. Plugin Architecture (Cordis-style)
```typescript
const plugin = createPlugin({
  id: 'my-plugin',
  name: 'My Plugin',
  version: '1.0.0',
  apply(ctx) {
    ctx.registerService('myService', () => 'Hello');
  },
});
```

### 4. Multi-Runtime Support
```typescript
const local = new LocalRuntime({ /* ... */ });
const remote = new RemoteRuntime({ endpoint: 'https://api.example.com' });
const manager = new RuntimeManager([local, remote]);
```

### 5. Subagent Orchestration
```typescript
const orchestrator = new Orchestrator(subagentManager);
const result = await orchestrator.execute({
  mode: 'parallel',
  tasks: [/* ... */],
});
```

### 6. MCP Integration
```typescript
const server = createMcpServer({ /* ... */ });
server.registerTool('my_tool', /* ... */ );

const client = createMcpClient({ /* ... */ });
await client.connect('server');
```

### 7. Sandbox Isolation
```typescript
const sandbox = createSandbox({
  type: 'vm',
  limits: { maxMemoryMB: 256 },
});
await sandbox.start();
```

### 8. Quality Gates
```typescript
const manager = createGateManager();
await manager.executePipeline({
  gates: [
    { name: 'Lint', type: 'lint' },
    { name: 'Test', type: 'test' },
  ],
});
```

### 9. Cursor SDK Integration
```typescript
const adapter = createCursorSdkAdapter({
  type: 'local',
  clientInfo: { name: 'app', version: '1.0.0' },
});
```

## Usage Examples

### Complete Agent Workflow

```typescript
import {
  HookBus,
  SessionEventLog,
  PluginRegistry,
  SubagentManager,
  Orchestrator,
  VmSandbox,
  GateManager,
  LocalCursorSdkAdapter,
  createIdeResidentWorkflow,
} from '@datafoundry/harness-core';

async function completeWorkflow() {
  // 1. Setup foundation
  const hookBus = new HookBus();
  const eventLog = new SessionEventLog({ workdir: '/tmp' });
  const pluginRegistry = new PluginRegistry();
  
  // 2. Setup subagent system
  const subagentManager = new SubagentManager({ maxConcurrent: 10 });
  const orchestrator = new Orchestrator(subagentManager);
  
  // 3. Setup sandbox
  const sandbox = new VmSandbox({ type: 'vm' });
  await sandbox.start();
  
  // 4. Setup gates
  const gateManager = new GateManager();
  
  // 5. Setup IDE integration
  const cursorAdapter = new LocalCursorSdkAdapter({
    type: 'local',
    clientInfo: { name: 'app', version: '1.0.0' },
  });
  const workflow = createIdeResidentWorkflow(cursorAdapter);
  await workflow.start();
  
  // 6. Execute orchestration
  const result = await orchestrator.execute({
    id: 'main-pipeline',
    name: 'Main Pipeline',
    mode: 'sequential',
    tasks: [
      {
        id: 'plan',
        name: 'Planning Phase',
        subagent: {
          role: 'planner',
          prompt: 'Plan the task',
        },
      },
      {
        id: 'execute',
        name: 'Execution Phase',
        subagent: {
          role: 'worker',
          prompt: 'Execute the plan',
        },
        dependsOn: ['plan'],
      },
    ],
  });
  
  console.log('Pipeline result:', result);
  
  // 7. Cleanup
  await workflow.stop();
  await cursorAdapter.disconnect();
  await sandbox.destroy();
  await subagentManager.dispose();
  gateManager.dispose();
}

completeWorkflow().catch(console.error);
```

## Testing

### Run All Tests

```bash
cd packages/harness-core
npm test
```

### Run Specific Phase Tests

```bash
# Phase 1 (Hooks)
npm test -- hooks.test.ts

# Phase 5 (Subagent)
npm test -- subagent.test.ts

# Phase 10 (Integration)
npm test -- integration.test.ts
```

## API Reference

### Hook System

```typescript
import {
  HookBus,
  HookRegistry,
  HookExecutor,
  createHookBus,
  type Hook,
} from '@datafoundry/harness-core';
```

### Event Log

```typescript
import {
  SessionEventLog,
  EventLogAdapter,
  TimelineRecorder,
  EventAnalytics,
} from '@datafoundry/harness-core';
```

### Plugin System

```typescript
import {
  PluginRegistry,
  ServiceRegistry,
  Profile,
  Bundle,
  createPlugin,
} from '@datafoundry/harness-core';
```

### Multi-Runtime

```typescript
import {
  LocalRuntime,
  RemoteRuntime,
  RuntimeManager,
  createLocalRuntime,
  createRemoteRuntime,
} from '@datafoundry/harness-core';
```

### Subagent

```typescript
import {
  SubagentManager,
  Orchestrator,
  createSubagentManager,
  createOrchestrator,
} from '@datafoundry/harness-core';
```

### MCP

```typescript
import {
  McpClient,
  McpServer,
  McpBridge,
  createMcpClient,
  createMcpServer,
} from '@datafoundry/harness-core';
```

### Sandbox

```typescript
import {
  VmSandbox,
  ProcessSandbox,
  DockerSandbox,
  SandboxManager,
  createSandbox,
  createSandboxManager,
} from '@datafoundry/harness-core';
```

### Gates

```typescript
import {
  GateManager,
  createGateManager,
  lintGateExecutor,
  testGateExecutor,
  typeCheckGateExecutor,
  buildGateExecutor,
  formatGateExecutor,
  coverageGateExecutor,
} from '@datafoundry/harness-core';
```

### Cursor SDK

```typescript
import {
  LocalCursorSdkAdapter,
  CloudCursorSdkAdapter,
  IdeResidentWorkflow,
  createCursorSdkAdapter,
  createIdeResidentWorkflow,
} from '@datafoundry/harness-core';
```

## License

MIT

## Authors

DataFoundry Team

## Acknowledgments

- Cursor for the agent architecture inspiration
- Cordis for the plugin system design
- DeepSeek for the runtime concepts
- MCP for the protocol specification