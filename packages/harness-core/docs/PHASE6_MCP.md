# Phase 6: MCP Server Integration

This document describes Phase 6 of the AgentX Harness upgrade.

## Overview

Phase 6 adds Model Context Protocol (MCP) integration:

1. **MCP Types** - Full type definitions for MCP protocol
2. **MCP Transport** - Multiple transport types (stdio, HTTP, WebSocket, in-process)
3. **MCP Client** - Connect to MCP servers, call tools, read resources
4. **MCP Server** - Implement MCP server to expose tools
5. **MCP Bridge** - Bridge MCP tools to Harness tools

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MCP Integration Architecture                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                       MCP Client                                      │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────┐   │    │
│  │  │   Stdio     │  │    HTTP     │  │  WebSocket  │  │ In-Proc  │   │    │
│  │  │  Transport  │  │  Transport  │  │  Transport  │  │Transport │   │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └──────────┘   │    │
│  │                                                                       │    │
│  │   Tools  Resources  Prompts                                          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                       MCP Bridge                                      │    │
│  │                                                                       │    │
│  │   - mcpToolToHarnessTool()                                           │    │
│  │   - harnessToolToMcpTool()                                           │    │
│  │   - registerHarnessToolsToMcpServer()                                │    │
│  │                                                                       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                       Harness Core                                    │    │
│  │  (Tool Registry, Plugin System, etc.)                                 │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Supported Transports

| Transport | Description |
|-----------|-------------|
| **stdio** | Subprocess communication (most common for MCP servers) |
| **http** | HTTP-based with SSE |
| **websocket** | Full-duplex WebSocket |
| **in-process** | Direct in-memory communication (for testing/embedded) |

## Basic Usage

### MCP Server

```typescript
import { createMcpServer, textResult } from '@agentx/harness-core';

const server = createMcpServer({
  name: 'my-mcp-server',
  version: '1.0.0',
  transport: { type: 'in-process', server: {} as any },
});

// Register a tool
server.registerTool(
  'calculate',
  'Performs a calculation',
  {
    type: 'object',
    properties: {
      expression: { type: 'string' },
    },
    required: ['expression'],
  },
  async (params) => {
    const { expression } = params as { expression: string };
    const result = eval(expression); // Simplistic - use proper parser
    return textResult(`Result: ${result}`);
  },
);

// Register a resource
server.registerResource(
  'file:///config.json',
  'App Config',
  'Application configuration',
  'application/json',
  async () => ({
    contents: [
      {
        uri: 'file:///config.json',
        mimeType: 'application/json',
        text: JSON.stringify({ name: 'My App', version: '1.0' }),
      },
    ],
  }),
);

// Register a prompt
server.registerPrompt(
  'code-review',
  'Review code for issues',
  [
    { name: 'code', description: 'Code to review', required: true },
  ],
  async (args) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Please review this code:\n\n${args?.code}`,
        },
      },
    ],
  }),
);

await server.start();
```

### MCP Client

```typescript
import { createMcpClient } from '@agentx/harness-core';

// Connect to stdio MCP server
const client = createMcpClient({
  name: 'my-client',
  version: '1.0.0',
  timeout: 30000,
  servers: [
    {
      name: 'filesystem',
      transport: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      },
    },
  ],
});

// Connect
await client.connect('filesystem');

// List tools
const tools = await client.listTools('filesystem');
console.log('Tools:', tools);

// Call a tool
const result = await client.callTool('filesystem', {
  name: 'read_file',
  arguments: { path: '/tmp/test.txt' },
});

// Auto-find tool across servers
const found = await client.findTool('read_file');
if (found) {
  const result = await client.callTool(found.serverName, {
    name: found.tool.name,
    arguments: { path: '/tmp/test.txt' },
  });
}

// Read resource
const resource = await client.readResource('filesystem', {
  uri: 'file:///tmp/test.txt',
});

// Get prompt
const prompt = await client.getPrompt('filesystem', {
  name: 'summarize',
  arguments: { text: 'Some text to summarize' },
});
```

### MCP Bridge

Bridge MCP tools to Harness tools for unified access.

```typescript
import { createMcpClient, createMcpBridge } from '@agentx/harness-core';

const client = createMcpClient({ /* ... */ });
await client.connect('filesystem');

const bridge = createMcpBridge({
  client,
  enabled: true,
  namespace: 'mcp',
});

// Bridge all MCP tools
const bridgedTools = await bridge.bridgeAllTools();

// Register with Harness tool registry
const toolRegistry = /* your tool registry */;
for (const tool of bridgedTools) {
  toolRegistry.register(tool);
}

// Or use directly
const tool = bridge.getTool('mcp.read_file');
if (tool) {
  const result = await tool.execute(
    { path: '/tmp/test.txt' },
    context,
  );
}
```

### Convert Harness Tools to MCP

```typescript
import { createMcpServer, registerHarnessToolsToMcpServer } from '@agentx/harness-core';

const server = createMcpServer({ /* ... */ });

// Get Harness tools
const harnessTools = toolRegistry.list();

// Register them as MCP tools
registerHarnessToolsToMcpServer(server, harnessTools);
```

## Transport Examples

### Stdio (Subprocess)

```typescript
const transport = {
  type: 'stdio',
  command: 'mcp-server',
  args: ['--port', '3000'],
  env: { DEBUG: '1' },
  cwd: '/path/to/working/dir',
};
```

### HTTP

```typescript
const transport = {
  type: 'http',
  endpoint: 'https://api.example.com/mcp',
  headers: {
    'X-Custom': 'value',
  },
  apiKey: 'your-api-key',
};
```

### WebSocket

```typescript
const transport = {
  type: 'websocket',
  endpoint: 'wss://api.example.com/mcp',
  protocols: ['mcp-v1'],
  headers: {
    'X-Custom': 'value',
  },
};
```

### In-Process

```typescript
const transport = {
  type: 'in-process',
  server: serverInstance, // McpServer instance
};
```

## MCP Protocol Support

### Methods Implemented

| Method | Direction | Description |
|--------|-----------|-------------|
| `initialize` | Client → Server | Initialize connection |
| `tools/list` | Client → Server | List available tools |
| `tools/call` | Client → Server | Call a tool |
| `resources/list` | Client → Server | List resources |
| `resources/read` | Client → Server | Read a resource |
| `prompts/list` | Client → Server | List prompts |
| `prompts/get` | Client → Server | Get a prompt |
| `notifications/initialized` | Client → Server | Notification |
| `notifications/tools/list_changed` | Server → Client | Tool list changed |
| `ping` | Client → Server | Heartbeat |

### Tool Annotations

```typescript
import type { ToolAnnotations } from '@agentx/harness-core';

const annotations: ToolAnnotations = {
  title: 'Read File',
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
```

### Content Types

```typescript
// Text content
const textContent = { type: 'text', text: 'Hello' };

// Image content (base64)
const imageContent = {
  type: 'image',
  data: 'base64-encoded-data',
  mimeType: 'image/png',
};

// Audio content
const audioContent = {
  type: 'audio',
  data: 'base64-encoded-data',
  mimeType: 'audio/mpeg',
};

// Embedded resource
const resourceContent = {
  type: 'resource',
  resource: {
    uri: 'file:///test.txt',
    text: 'content',
  },
};
```

## Complete Example: Full MCP Integration

```typescript
import {
  createMcpClient,
  createMcpServer,
  createMcpBridge,
  textResult,
} from '@agentx/harness-core';

async function main() {
  // 1. Create MCP server
  const server = createMcpServer({
    name: 'data-server',
    version: '1.0.0',
    transport: { type: 'in-process', server: {} as any },
  });
  
  // Register tools
  server.registerTool(
    'query_database',
    'Query a database',
    {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    },
    async (params) => {
      const { query } = params as { query: string };
      // Mock implementation
      return textResult(`Executed: ${query}\nResults: [...]`);
    },
  );
  
  await server.start();
  
  // 2. Create client
  const client = createMcpClient({
    name: 'data-client',
    version: '1.0.0',
    servers: [
      {
        name: 'data-server',
        transport: { type: 'in-process', server },
      },
    ],
  });
  
  await client.connect('data-server');
  
  // 3. Create bridge
  const bridge = createMcpBridge({
    client,
    enabled: true,
    namespace: 'mcp',
  });
  
  // 4. Bridge tools
  const tools = await bridge.bridgeAllTools();
  console.log(`Bridged ${tools.length} tools`);
  
  // 5. Use bridged tool
  const queryTool = bridge.getTool('mcp.query_database');
  if (queryTool) {
    const result = await queryTool.execute(
      { query: 'SELECT * FROM users' },
      {
        sessionId: 'session-1',
        runId: 'run-1',
        toolName: 'mcp.query_database',
        userServices: {},
      },
    );
    console.log(result);
  }
  
  // 6. Cleanup
  await client.dispose();
  await server.stop();
}

main().catch(console.error);
```

## Implementation Status

| Component | Status | File |
|----------|--------|------|
| MCP Types | ✅ Complete | `src/mcp/mcp-types.ts` |
| MCP Transport | ✅ Complete | `src/mcp/mcp-transport.ts` |
| MCP Client | ✅ Complete | `src/mcp/mcp-client.ts` |
| MCP Server | ✅ Complete | `src/mcp/mcp-server.ts` |
| MCP Bridge | ✅ Complete | `src/mcp/mcp-bridge.ts` |
| Tests | ✅ Complete | `src/mcp/mcp.test.ts` |

## Next Steps

**Phase 7**: Sandbox Isolation
- Enhanced code sandboxing
- Process isolation

**Phase 8**: Deterministic Gates
- Lint gates
- Test gates
- Retry limits