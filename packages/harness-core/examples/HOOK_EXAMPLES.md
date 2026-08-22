# Hook System Usage Examples

This directory contains examples of using the `@datafoundry/harness-core` Hook system.

## Example 1: Basic Hook Registration

```typescript
import { HookRegistry, loadHookConfig } from "@datafoundry/harness-core";

// Create registry
const registry = new HookRegistry({ enabled: true });

// Load configuration
const config = loadHookConfig("./hooks.json");
await registry.loadFromConfig(config);

// Initialize
await registry.initialize();

// Emit events
await registry.emit("tool.post-execute", {
  event: "tool.post-execute",
  sessionId: "my-session",
  runId: "my-run",
  toolName: "write_file",
  toolOutput: { success: true },
  metadata: {},
});
```

## Example 2: Programmatic Hook Definition

```typescript
import { HookRegistry, HookDefinition } from "@datafoundry/harness-core";

const registry = new HookRegistry({ enabled: true });

// Register a hook programmatically
const lintHook: HookDefinition = {
  name: "lint-on-save",
  description: "Run ESLint after writing files",
  events: ["tool.post-execute"],
  filter: {
    toolName: "write_file",
  },
  action: {
    type: "shell",
    command: "npx eslint --fix",
    args: ["{{filePath}}"],
    timeout: 30000,
  },
  enabled: true,
};

registry.register(lintHook);
await registry.initialize();
```

## Example 3: HTTP Hook

```typescript
const webhookHook: HookDefinition = {
  name: "notify-on-error",
  description: "Send notification when tool fails",
  events: ["tool.error"],
  action: {
    type: "http",
    url: "https://hooks.example.com/notify",
    method: "POST",
    body: {
      tool: "{{toolName}}",
      error: "{{error}}",
      sessionId: "{{sessionId}}",
    },
    timeout: 5000,
  },
  enabled: true,
};
```

## Example 4: Prompt Hook

```typescript
const logHook: HookDefinition = {
  name: "debug-log",
  description: "Log events to console",
  events: ["turn.start", "turn.end", "step.start", "step.end"],
  action: {
    type: "prompt",
    template: "[{{event}}] Session: {{sessionId}}, Run: {{runId}}",
  },
  enabled: false, // Disabled by default
};
```

## Example 5: Using with createEnhancedDataFoundry

```typescript
import { createEnhancedDataFoundry } from "@datafoundry/harness-core";

const result = await createEnhancedDataFoundry({
  dataFoundryInput: {
    modelProvider: myModelProvider,
    runContext: myRunContext,
    dataGateway: myDataGateway,
    emitter: myEmitter,
    messages: [],
  },
  enableHooks: true,
  hooksConfigPath: "./hooks.json",
});

// Use original DataFoundry features
const { agent, protocol } = result.dataFoundry;

// Use enhanced Hook features (optional)
if (result.hookRegistry) {
  const stats = result.hookRegistry.getStats();
  console.log(`Active hooks: ${stats.enabled}`);
}

// Cleanup
result.dispose();
```

## Example 6: MCP Hook

```typescript
const mcpHook: HookDefinition = {
  name: "slack-notify",
  description: "Send Slack notification via MCP",
  events: ["session.end"],
  action: {
    type: "mcp",
    server: "slack",
    tool: "send_message",
    args: {
      channel: "#agent-alerts",
      text: "Session {{sessionId}} completed",
    },
  },
  enabled: false,
};
```

## Hook Variable Interpolation

Hook actions support the following variables that are automatically replaced:

| Variable | Description |
|----------|-------------|
| `{{sessionId}}` | Current session ID |
| `{{runId}}` | Current run ID |
| `{{turnId}}` | Current turn ID |
| `{{stepId}}` | Current step ID |
| `{{toolName}}` | Tool being called |
| `{{toolInput}}` | Tool input (JSON) |
| `{{toolOutput}}` | Tool output (JSON) |
| `{{error}}` | Error message |
| `{{stepIndex}}` | Current step index |
| `{{agentName}}` | Agent name |

## Event Types

### Agent Lifecycle
- `agent.start` - Agent started
- `agent.end` - Agent stopped

### Turn Lifecycle
- `turn.start` - New turn started
- `turn.end` - Turn completed
- `turn/stopping` - Turn is being stopped

### Step Lifecycle
- `step.start` - New step started
- `step.end` - Step completed

### Tool Lifecycle
- `tool.pre-execute` - Before tool execution
- `tool.post-execute` - After tool execution
- `tool.error` - Tool execution failed

### LLM Lifecycle
- `llm.request` - Before LLM call
- `llm.response` - After LLM response
- `llm.error` - LLM call failed

### Context Lifecycle
- `context.compact` - Context was compacted
- `context.inject` - Context was injected

### Session Lifecycle
- `session.start` - Session started
- `session.end` - Session ended
- `session.resume` - Session resumed
- `session.fork` - Session forked
