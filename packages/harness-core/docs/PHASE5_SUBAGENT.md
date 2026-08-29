# Phase 5: Subagent Orchestration

This document describes Phase 5 of the AgentX Harness upgrade.

## Overview

Phase 5 adds comprehensive subagent orchestration capabilities:

1. **Subagent** - Single agent instance with rich state
2. **Subagent Manager** - Spawn, fork, resume subagents
3. **Orchestrator** - Sequential, Parallel, Pipeline, Fan-out execution

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Subagent Orchestration Architecture                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                       Subagent Manager                                │    │
│  │                                                                       │    │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐          │    │
│  │  │  Worker   │ │Researcher │ │   Coder   │ │  Tester   │          │    │
│  │  │  Subagent │ │ Subagent  │ │ Subagent  │ │ Subagent  │          │    │
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────┘          │    │
│  │       │              │              │              │                │    │
│  │       └──────────────┴──────────────┴──────────────┘                │    │
│  │                              │                                       │    │
│  │                              └────────┐                              │    │
│  └─────────────────────────────────────┼───────────────────────────────┘    │
│                                        │                                     │
│  ┌─────────────────────────────────────┼───────────────────────────────┐    │
│  │                          Orchestrator                                │    │
│  │                                                                       │    │
│  │   ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐  │    │
│  │   │ Sequential │  │  Parallel  │  │  Pipeline  │  │  Fan-out   │  │    │
│  │   │   Mode     │  │   Mode     │  │    Mode    │  │   Mode     │  │    │
│  │   └────────────┘  └────────────┘  └────────────┘  └────────────┘  │    │
│  │                                                                       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Subagent Types

```typescript
type SubagentRole = 
  | "worker"      // Default worker
  | "researcher"  // Research tasks
  | "coder"       // Code generation
  | "reviewer"    // Code/content review
  | "tester"      // Testing
  | "planner"     // Planning
  | "executor"    // Execution
  | "custom";     // User-defined
```

## Subagent Status

```typescript
type SubagentStatus =
  | "initializing"  // Just created
  | "ready"         // Ready to run
  | "running"       // Currently running
  | "paused"        // Paused
  | "completed"     // Successfully completed
  | "failed"        // Failed
  | "cancelled"     // Cancelled
  | "timeout";      // Timed out
```

## Isolation Levels

```typescript
type SubagentIsolation =
  | "shared"   // Shares context with parent
  | "fork"     // Forks parent's context
  | "isolated" // Completely isolated
  | "sandboxed"; // Sandboxed execution
```

## Basic Usage

### Creating a Subagent

```typescript
import { createSubagent } from '@agentx/harness-core';

const subagent = createSubagent('session-1', {
  role: 'researcher',
  name: 'Research Agent',
  prompt: 'Research AI safety',
  timeout: 30000,
  context: { domain: 'AI safety' },
  metadata: { priority: 'high' },
});

subagent.setStatus('running');
// ... do work ...
subagent.complete({ success: true, data: { findings: [] } });
```

### Subagent Manager

```typescript
import { createSubagentManager } from '@agentx/harness-core';

const manager = createSubagentManager({
  maxConcurrent: 10,
  defaultTimeout: 60000,
  autoCleanup: true,
});

// Spawn
const agent = manager.spawn('session-1', {
  role: 'worker',
  prompt: 'Task description',
});

// Fork
const child = manager.fork('session-1', agent.id, {
  role: 'worker',
  prompt: 'Subtask',
});

// Resume
const resumed = manager.resume('session-1', 'agent-id', 'New prompt');

// Query
const running = manager.getRunning();
const byRole = manager.getByRole('researcher');
const children = manager.getChildren(parent.id);
```

### Orchestrator

```typescript
import { createOrchestrator, createSubagentManager } from '@agentx/harness-core';

const manager = createSubagentManager();
const orchestrator = createOrchestrator(manager);

// Sequential orchestration
const seqResult = await orchestrator.execute({
  id: 'pipeline-1',
  name: 'My Pipeline',
  mode: 'sequential',
  tasks: [
    { id: 't1', name: 'First', subagent: { role: 'worker', prompt: 'Task 1' } },
    {
      id: 't2',
      name: 'Second',
      subagent: { role: 'worker', prompt: 'Task 2' },
      dependsOn: ['t1'],
    },
  ],
});

// Parallel orchestration
const parallelResult = await orchestrator.execute({
  id: 'parallel-1',
  name: 'Parallel Work',
  mode: 'parallel',
  tasks: [
    { id: 'p1', name: 'A', subagent: { role: 'worker', prompt: 'A' } },
    { id: 'p2', name: 'B', subagent: { role: 'worker', prompt: 'B' } },
    { id: 'p3', name: 'C', subagent: { role: 'worker', prompt: 'C' } },
  ],
});
```

## Orchestration Modes

### Sequential

Tasks executed one after another, with results available to subsequent tasks.

```typescript
{
  mode: 'sequential',
  tasks: [
    { id: 'a', name: 'A', subagent: ... },
    { id: 'b', name: 'B', subagent: ..., dependsOn: ['a'] },
  ],
}
```

### Parallel

All tasks executed concurrently.

```typescript
{
  mode: 'parallel',
  tasks: [
    { id: 'p1', ... },
    { id: 'p2', ... },
    { id: 'p3', ... },
  ],
}
```

### Pipeline

Strict sequential with data flow between tasks.

```typescript
{
  mode: 'pipeline',
  tasks: [
    { id: 'extract', ... },
    { id: 'transform', ..., dependsOn: ['extract'] },
    { id: 'load', ..., dependsOn: ['transform'] },
  ],
}
```

### Fan-out

Distribute input to multiple tasks, collect results.

```typescript
{
  mode: 'fan-out',
  tasks: [
    { id: 'worker-1', ... },
    { id: 'worker-2', ... },
    { id: 'worker-3', ... },
  ],
}
```

## Messaging

Subagents can send and receive messages via the manager.

```typescript
// Send message
manager.sendMessage({
  id: 'msg-1',
  fromId: 'agent-1',
  toId: 'agent-2',
  type: 'request',
  subject: 'greeting',
  payload: { greeting: 'Hello!' },
  timestamp: Date.now(),
});

// Listen for messages
const unsubscribe = manager.onMessage((msg) => {
  console.log('Received:', msg);
}, { subject: 'greeting' });

// Get message history
const messages = manager.getMessages();
```

## Statistics

```typescript
const stats = manager.getStats();
// {
//   totalSpawned: 10,
//   currentlyRunning: 3,
//   completed: 5,
//   failed: 1,
//   byRole: { researcher: 4, coder: 6 },
//   totalDuration: 12345,
//   averageDuration: 2469,
//   totalTokensUsed: 0,
// }

const detailed = manager.getDetailedStats();
// {
//   total: 9,
//   byRole: { ... },
//   byStatus: { ready: 3, running: 2, completed: 4 },
//   byIsolation: { shared: 5, fork: 4 },
// }
```

## Complete Example: Multi-Agent Workflow

```typescript
import {
  createSubagentManager,
  createOrchestrator,
  type Orchestration,
} from '@agentx/harness-core';

async function multiAgentWorkflow() {
  // 1. Create manager
  const manager = createSubagentManager({
    maxConcurrent: 10,
    defaultTimeout: 60000,
  });

  // 2. Plan and spawn orchestrator
  const orchestrator = createOrchestrator(manager);

  // 3. Define multi-step workflow
  const workflow: Orchestration = {
    id: 'code-review-pipeline',
    name: 'Code Review Pipeline',
    mode: 'sequential',
    onFailure: 'continue',
    tasks: [
      // Step 1: Plan
      {
        id: 'plan',
        name: 'Plan Review',
        subagent: {
          role: 'planner',
          prompt: 'Plan the code review',
          timeout: 15000,
        },
      },
      // Step 2: Analyze (parallel)
      {
        id: 'style-review',
        name: 'Style Review',
        subagent: {
          role: 'reviewer',
          prompt: 'Check code style',
        },
        dependsOn: ['plan'],
      },
      {
        id: 'security-review',
        name: 'Security Review',
        subagent: {
          role: 'reviewer',
          prompt: 'Security analysis',
        },
        dependsOn: ['plan'],
      },
      // Step 3: Test
      {
        id: 'run-tests',
        name: 'Run Tests',
        subagent: {
          role: 'tester',
          prompt: 'Run all tests',
        },
        dependsOn: ['style-review', 'security-review'],
      },
    ],
  };

  // 4. Execute
  const result = await orchestrator.execute(workflow);

  console.log('Workflow completed:', result.success);
  console.log('Tasks completed:', result.completedTasks.length);
  console.log('Tasks failed:', result.failedTasks.length);

  // 5. Cleanup
  await manager.dispose();
}

multiAgentWorkflow().catch(console.error);
```

## Implementation Status

| Component | Status | File |
|----------|--------|------|
| Subagent Types | ✅ Complete | `src/subagent/subagent-types.ts` |
| Subagent | ✅ Complete | `src/subagent/subagent.ts` |
| Subagent Manager | ✅ Complete | `src/subagent/subagent-manager.ts` |
| Orchestrator | ✅ Complete | `src/subagent/orchestrator.ts` |
| Tests | ✅ Complete | `src/subagent/subagent.test.ts` |

## Next Steps

**Phase 6**: MCP Server Integration
- MCP protocol support
- Tool bridging

**Phase 7**: Sandbox Isolation
- Enhanced code sandboxing
- Process isolation
