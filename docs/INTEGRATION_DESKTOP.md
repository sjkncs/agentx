# Integration Guide - Harness Core with AgentX Desktop

This guide explains how the Harness Core package (Phase 1-4) integrates with the AgentX Desktop application.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AgentX Desktop (Electron)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        Main Process (main.mjs)                         │   │
│  │                                                                       │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐    │   │
│  │  │  CDL Module     │  │  Harness Core   │  │  API Server     │    │   │
│  │  │  Loader         │  │  Loader         │  │  (8787)         │    │   │
│  │  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘    │   │
│  │           │                    │                    │               │   │
│  │           └────────────────────┼────────────────────┘               │   │
│  │                                │                                    │   │
│  │                    ┌───────────┴───────────┐                         │   │
│  │                    │    IPC Handlers      │                         │   │
│  │                    │  (cdl:*, harness:*) │                         │   │
│  │                    └───────────┬───────────┘                         │   │
│  └────────────────────────────────┼────────────────────────────────────┘   │
│                                     │                                      │
│  ┌────────────────────────────────┼────────────────────────────────────┐   │
│  │                        Preload (preload.mjs)                        │   │
│  │                                │                                      │   │
│  │                    ┌───────────┴───────────┐                         │   │
│  │                    │  contextBridge       │                         │   │
│  │                    │  window.dfd         │                         │   │
│  │                    └─────────────────────┘                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                     │                                      │
│  ┌────────────────────────────────┼────────────────────────────────────┐   │
│  │                     Renderer Process                                │   │
│  │                                │                                      │   │
│  │                    ┌───────────┴───────────┐                         │   │
│  │                    │  window.dfd.harness  │                         │   │
│  │                    └─────────────────────┘                         │   │
│  │                                │                                      │   │
│  │                    ┌───────────┴───────────┐                         │   │
│  │                    │  React Components     │                         │   │
│  │                    │  (CDL Panel, etc.)   │                         │   │
│  │                    └─────────────────────┘                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## IPC API

The integration exposes Harness Core functionality through IPC channels in the main process:

### Harness Module Loader

Located in `apps/desktop/src/main.mjs`, the loader uses a resilient multi-path resolution strategy:

1. **node_modules** - Installed via npm
2. **Workspace source** - During development with symlinks

### Available IPC Endpoints

| Endpoint | Description | Parameters | Returns |
|----------|-------------|------------|---------|
| `harness:getInfo` | Get module info | - | `{ hasHookBus, hasEventLog, hasPluginManager, hasRuntimeManager }` |
| `harness:createEventLog` | Create Event Log | `{ sessionId, runId }` | `{ sessionId, totalEvents }` |
| `harness:createRuntimeManager` | Create Runtime Manager | `{ defaultType }` | `{ total, byType }` |
| `harness:createHookBus` | Create Hook Bus | - | `{ listenerCount, eventCount }` |
| `harness:createPluginManager` | Create Plugin Manager | - | `{ totalPlugins }` |

## Usage in Renderer

### TypeScript/JavaScript

```typescript
// In a React component
import type { AgentXDesktopAPI } from './types/harness.d';

const dfd = window.dfd as AgentXDesktopAPI;

// Check if harness-core is available
const info = await dfd.harness.getInfo();
console.log('Harness capabilities:', info.result);

// Create an Event Log
const eventLog = await dfd.harness.createEventLog({
  sessionId: 'my-session-123',
  runId: 'run-456',
});

// Create a Runtime Manager
const runtimeManager = await dfd.harness.createRuntimeManager({
  defaultType: 'local',
});

// Create a Hook Bus
const hookBus = await dfd.harness.createHookBus();

// Create a Plugin Manager
const pluginManager = await dfd.harness.createPluginManager();
```

### React Hook Example

```typescript
// hooks/useHarness.ts
import { useState, useEffect } from 'react';

export function useHarnessInfo() {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.dfd?.harness) {
      setError('Harness not available');
      setLoading(false);
      return;
    }

    window.dfd.harness.getInfo()
      .then((result) => {
        if (result.ok) {
          setInfo(result.result);
        } else {
          setError(result.error || 'Unknown error');
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return { info, loading, error };
}
```

## Features Available via Desktop Integration

### 1. Session Event Log

```typescript
// Create and use event log
const eventLog = await dfd.harness.createEventLog({
  sessionId: sessionId,
  runId: runId,
});

// Log events from renderer
// Note: Actual logging happens in main process
```

### 2. Hook Bus

```typescript
// Create hook bus for event handling
const hookBus = await dfd.harness.createHookBus();

// Events are processed in main process
```

### 3. Runtime Manager

```typescript
// Create runtime manager
const manager = await dfd.harness.createRuntimeManager({
  defaultType: 'local', // or 'remote'
});

// Runtime execution happens in main process
```

### 4. Plugin Manager

```typescript
// Create plugin manager
const manager = await dfd.harness.createPluginManager();

// Plugins are loaded in main process
```

## Building and Testing

### Build Harness Core

```bash
cd packages/harness-core
npm run build
```

### Build Desktop App

```bash
cd apps/desktop
npm run dist:dir  # Quick build
npm run dist       # Full installer
```

### Development Mode

```bash
# Terminal 1: Build harness-core in watch mode
cd packages/harness-core
npm run build -- --watch

# Terminal 2: Start desktop
cd apps/desktop
npm run start
```

## Module Resolution in Desktop

The `main.mjs` file uses a resilient loader pattern:

```javascript
async function loadHarnessCore() {
  const candidates = [
    // 1) node_modules (production)
    () => ({
      kind: 'node_modules',
      spec: require.resolve('@agentx/harness-core'),
    }),
    // 2) Workspace source (development)
    () => ({
      kind: 'source',
      spec: path.join(ROOT, 'packages', 'harness-core', 'dist', 'index.js'),
    }),
  ];
  
  for (const resolve of candidates) {
    try {
      const { spec } = resolve();
      const mod = await import(spec);
      if (mod?.HookBus) return mod;
    } catch (err) {
      // Try next candidate
    }
  }
  throw new Error('Failed to load @agentx/harness-core');
}
```

## Dependencies

### Desktop App

```json
{
  "dependencies": {
    "@agentx/harness-core": "*",
    "@agentx/counterfactual": "*"
  }
}
```

### Harness Core

```json
{
  "peerDependencies": {
    "@agentx/agent-runtime": ">=0.2.0"
  }
}
```

## Error Handling

All IPC handlers return a consistent format:

```typescript
{
  ok: boolean;
  result?: T;
  error?: string;
}
```

Example error handling:

```typescript
const result = await dfd.harness.createEventLog({ sessionId });
if (!result.ok) {
  console.error('Failed to create event log:', result.error);
  return;
}
console.log('Event log created:', result.result);
```

## Type Definitions

Type definitions are available at:
- `apps/desktop/src/types/harness.d.ts`

Import in your TypeScript files:

```typescript
import type { AgentXDesktopAPI, HarnessAPI } from './types/harness.d';
```
