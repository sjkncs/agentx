# Phase 7 & 8: Sandbox + Deterministic Gates

This document describes Phase 7 and Phase 8 of the AgentX Harness upgrade.

## Phase 7: Sandbox Isolation

Provides multiple sandbox types for code execution:

| Sandbox Type | Use Case |
|--------------|----------|
| **Process** | Subprocess isolation (full isolation) |
| **VM** | Node.js VM (lightweight, in-process) |
| **Docker** | Container isolation (requires Docker) |
| **WebContainer** | Browser-based (StackBlitz) |

### Sandbox Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Sandbox System                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     Sandbox Manager                                   │    │
│  │                                                                       │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────┐   │    │
│  │  │   VM        │  │   Process   │  │   Docker    │  │WebContainer│  │    │
│  │  │  Sandbox    │  │   Sandbox   │  │   Sandbox   │  │  Sandbox │   │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └──────────┘   │    │
│  │                                                                       │    │
│  │   - File permissions                                                  │    │
│  │   - Network permissions                                               │    │
│  │   - Resource limits                                                   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Permissions

```typescript
interface SandboxPermissions {
  allowSubprocess?: boolean;
  allowNetwork?: boolean;
  allowWrite?: boolean;
  allowShell?: boolean;
  allowNativeModules?: boolean;
  files?: FilePermission[];
  network?: NetworkPermission[];
  env?: EnvPermission[];
}

interface FilePermission {
  pattern: string;  // glob
  read: boolean;
  write: boolean;
  execute: boolean;
}
```

### Resource Limits

```typescript
interface SandboxResourceLimits {
  maxMemoryMB?: number;
  maxCpuCores?: number;
  maxExecutionTimeMs?: number;
  maxFileDescriptors?: number;
  maxProcesses?: number;
  maxDiskWriteMB?: number;
  maxNetworkTrafficMB?: number;
}
```

### Basic Usage

#### VM Sandbox (Lightweight)

```typescript
import { createSandbox } from '@agentx/harness-core';

const sandbox = createSandbox({
  type: 'vm',
  name: 'my-vm',
  permissions: {
    allowNetwork: false,
    allowWrite: false,
  },
  limits: {
    maxMemoryMB: 256,
    maxExecutionTimeMs: 5000,
  },
});

await sandbox.start();

const result = await sandbox.execute({
  code: `
    const sum = (a, b) => a + b;
    console.log('Result:', sum(5, 3));
    sum(5, 3);  // return value
  `,
});

console.log(result.stdout); // "Result: 8"
console.log((result as any).result); // 8

await sandbox.destroy();
```

#### Process Sandbox (Full Isolation)

```typescript
const sandbox = createSandbox({
  type: 'process',
  command: 'node',
  args: ['-e', 'setInterval(() => {}, 1000)'],
  permissions: {
    allowNetwork: true,
    allowShell: false,
  },
});

await sandbox.start();
const result = await sandbox.execute({
  command: 'python',
  args: ['-c', 'print(2 + 2)'],
});
```

#### Sandbox Manager

```typescript
import { createSandboxManager } from '@agentx/harness-core';

const manager = createSandboxManager({
  maxSandboxes: 10,
  defaultType: 'vm',
  defaultLimits: {
    maxMemoryMB: 256,
    maxExecutionTimeMs: 30000,
  },
  defaultPermissions: {
    allowNetwork: false,
    allowWrite: false,
  },
});

const s1 = manager.create({ type: 'vm' });
const s2 = manager.create({ type: 'process' });

await s1.start();

const stats = manager.getStats();
// { total: 2, byStatus: {...}, byType: { vm: 1, process: 1 } }

await manager.dispose();
```

## Phase 8: Deterministic Gates

Provides quality gates for CI/CD workflows:

| Gate Type | Purpose |
|-----------|---------|
| **Lint** | Code style checking |
| **Test** | Test execution |
| **Type Check** | TypeScript validation |
| **Build** | Build verification |
| **Format** | Code formatting |
| **Coverage** | Test coverage threshold |
| **Security** | Security scanning |
| **Composite** | Combined gates |

### Gate Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Gate System                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      Gate Manager                                     │    │
│  │                                                                       │    │
│  │   Lint → Test → TypeCheck → Build → Coverage                        │    │
│  │     │        │        │          │         │                         │    │
│  │     ▼        ▼        ▼          ▼         ▼                         │    │
│  │   Issues   Pass/Fail Pass/Fail Pass/Fail  %                          │    │
│  │                                                                       │    │
│  │   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │    │
│  │   │ Retry    │  │  Skip    │  │ Parallel │  │  Stats   │           │    │
│  │   │ Logic    │  │ Condition│  │  Mode    │  │          │           │    │
│  │   └──────────┘  └──────────┘  └──────────┘  └──────────┘           │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Built-in Gate Executors

- `lintGateExecutor` - ESLint integration
- `testGateExecutor` - Jest/Vitest integration
- `typeCheckGateExecutor` - TypeScript compiler
- `buildGateExecutor` - npm/yarn build
- `formatGateExecutor` - Prettier check
- `coverageGateExecutor` - Coverage threshold

### Basic Usage

#### Single Gate

```typescript
import { createGateManager } from '@agentx/harness-core';

const manager = createGateManager({
  defaultTimeout: 60000,
  defaultRetries: 2,
});

// Execute lint gate
const result = await manager.executeGate(
  {
    name: 'Lint Check',
    type: 'lint',
    command: 'npx',
    args: ['eslint', '.', '--format', 'json'],
    timeout: 30000,
    retries: 1,
  },
  { workdir: process.cwd() },
);

if (result.passed) {
  console.log('Lint passed!');
} else {
  console.log('Issues:', result.issues);
}
```

#### Custom Gate

```typescript
manager.register('code-review', async (config, context) => ({
  gateId: 'code-review',
  gateName: config.name,
  gateType: 'custom',
  status: 'passed',
  passed: true,
  message: 'Review approved',
  issues: [],
  duration: 0,
  startedAt: Date.now(),
  endedAt: Date.now(),
}));

const result = await manager.executeGate(
  {
    name: 'Code Review',
    type: 'code-review',
    required: true,
  },
  { workdir: process.cwd() },
);
```

#### Pipeline

```typescript
const pipeline = {
  id: 'ci-pipeline',
  name: 'CI Pipeline',
  gates: [
    { name: 'Lint', type: 'lint', required: true },
    { name: 'Type Check', type: 'typecheck', required: true },
    { name: 'Test', type: 'test', required: true },
    { name: 'Build', type: 'build', required: true },
  ],
};

const result = await manager.executePipeline(pipeline, {
  workdir: process.cwd(),
  files: changedFiles,
});

if (result.passed) {
  console.log('All gates passed!');
} else {
  console.log('Failed gates:', result.failedGates);
}
```

#### Parallel Pipeline

```typescript
const pipeline = {
  id: 'parallel-pipeline',
  name: 'Parallel CI',
  parallel: true,
  gates: [
    { name: 'Lint', type: 'lint' },
    { name: 'Format', type: 'format' },
    { name: 'Type Check', type: 'typecheck' },
  ],
};
```

#### Skip Condition

```typescript
{
  name: 'Optional Test',
  type: 'test',
  skipIf: (context) => {
    // Skip if no files changed
    return !context.files || context.files.length === 0;
  },
}
```

### Statistics

```typescript
const stats = manager.getStatistics();
// {
//   totalGates: 10,
//   passed: 8,
//   failed: 2,
//   skipped: 0,
//   errored: 0,
//   byType: {
//     lint: { passed: 1, failed: 0, skipped: 0 },
//     test: { passed: 1, failed: 0, skipped: 0 },
//     ...
//   },
//   averageDuration: 1234,
//   totalRetries: 1,
// }
```

## Complete CI/CD Example

```typescript
import {
  createGateManager,
  createSandbox,
  type GatePipeline,
} from '@agentx/harness-core';

async function runCI(changedFiles: string[]) {
  // 1. Setup gate manager
  const gateManager = createGateManager({
    defaultTimeout: 300000,
    defaultRetries: 1,
    stopOnFailure: true,
  });
  
  // 2. Define pipeline
  const pipeline: GatePipeline = {
    id: 'full-ci',
    name: 'Full CI Pipeline',
    parallel: false,
    continueOnFailure: false,
    gates: [
      {
        id: 'lint',
        name: 'ESLint',
        type: 'lint',
        command: 'npx',
        args: ['eslint', '.', '--format', 'json'],
        timeout: 60000,
        required: true,
      },
      {
        id: 'typecheck',
        name: 'TypeScript Check',
        type: 'typecheck',
        command: 'npx',
        args: ['tsc', '--noEmit'],
        timeout: 120000,
        required: true,
      },
      {
        id: 'test',
        name: 'Unit Tests',
        type: 'test',
        command: 'npm',
        args: ['test', '--', '--reporter=json'],
        timeout: 300000,
        required: true,
      },
      {
        id: 'coverage',
        name: 'Coverage Check',
        type: 'coverage',
        command: 'npm',
        args: ['test', '--', '--coverage'],
        threshold: 80,
        timeout: 300000,
        required: true,
      },
      {
        id: 'build',
        name: 'Build',
        type: 'build',
        command: 'npm',
        args: ['run', 'build'],
        timeout: 300000,
        required: true,
      },
    ],
  };
  
  // 3. Execute pipeline
  const result = await gateManager.executePipeline(pipeline, {
    workdir: process.cwd(),
    files: changedFiles,
  });
  
  // 4. Report results
  if (!result.passed) {
    console.error(`CI Failed: ${result.failedGates.length} gates failed`);
    for (const failedId of result.failedGates) {
      const failedResult = result.gateResults.find(r => r.gateId === failedId);
      console.error(`  - ${failedResult?.gateName}: ${failedResult?.message}`);
    }
    process.exit(1);
  }
  
  console.log('✓ All CI gates passed');
}

runCI([]).catch(console.error);
```

## Sandbox + Gates Integration

```typescript
// Use sandbox to safely execute untrusted code, with gates to verify quality
const sandbox = createSandbox({
  type: 'vm',
  limits: {
    maxMemoryMB: 256,
    maxExecutionTimeMs: 5000,
  },
  permissions: {
    allowNetwork: false,
    allowWrite: false,
  },
});

await sandbox.start();

const result = await sandbox.execute({
  code: userProvidedCode,
  timeout: 5000,
});

// Gate: Verify output
if (result.success && result.stdout.includes('expected_output')) {
  console.log('Sandbox execution meets quality gate');
}
```

## Implementation Status

| Component | Status | File |
|----------|--------|------|
| Sandbox Types | ✅ Complete | `src/sandbox/sandbox-types.ts` |
| Sandbox Base | ✅ Complete | `src/sandbox/sandbox.ts` |
| VM Sandbox | ✅ Complete | `src/sandbox/sandbox.ts` |
| Process Sandbox | ✅ Complete | `src/sandbox/sandbox.ts` |
| Docker Sandbox | ✅ Complete (Stub) | `src/sandbox/sandbox.ts` |
| WebContainer Sandbox | ✅ Complete (Stub) | `src/sandbox/sandbox.ts` |
| Sandbox Manager | ✅ Complete | `src/sandbox/sandbox-manager.ts` |
| Gate Types | ✅ Complete | `src/gates/gate-types.ts` |
| Built-in Gates | ✅ Complete | `src/gates/built-in-gates.ts` |
| Gate Manager | ✅ Complete | `src/gates/gate-manager.ts` |
| Tests | ✅ Complete | `*.test.ts` |

## Next Steps

**Phase 9**: Cursor SDK Integration
- IDE-resident workflow

**Phase 10**: End-to-End Testing
- Full system integration