# Phase 2: Session Event Log & Analytics

This document describes Phase 2 of the AgentX Harness upgrade.

## Overview

Phase 2 adds comprehensive session event logging and analytics capabilities:

1. **EventLog Adapter** - Bridges Mastra events to Session Event Log
2. **Timeline Recorder** - Fine-grained timeline recording for agent operations
3. **Event Analytics** - Advanced analytics and reporting

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AgentX Agent                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐         │
│  │   Mastra     │───►│  EventLog   │───►│   Session    │         │
│  │   Events     │    │  Adapter    │    │  Event Log   │         │
│  └──────────────┘    └──────────────┘    └──────────────┘         │
│                                                  │                   │
│                                                  ▼                   │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐         │
│  │   Hook Bus   │◄───│    Hook     │◄───│  Timeline    │         │
│  │              │    │   Adapter    │    │  Recorder    │         │
│  └──────────────┘    └──────────────┘    └──────────────┘         │
│                                                  │                   │
│                                                  ▼                   │
│                                          ┌──────────────┐          │
│                                          │   Event      │          │
│                                          │  Analytics   │          │
│                                          └──────────────┘          │
└─────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. EventLog Adapter

Bridges Mastra/Agent events to Session Event Log:

```typescript
// packages/harness-core/src/adapters/event-log-adapter.ts

import { EventLogAdapter, createEventLogAdapter } from "@agentx/harness-core";

const adapter = createEventLogAdapter(emitter, eventLog, {
  sessionId: "my-session",
  runId: "my-run",
});

adapter.attach();

// Events are automatically logged:
emitter.emit("turnStart", { turnId: "t1" });
emitter.emit("stepStart", { stepId: "s1" });
emitter.emit("beforeToolUse", { toolName: "write_file" });
// → Events logged to SessionEventLog

adapter.detach();
```

### 2. Timeline Recorder

Fine-grained timeline for agent operations:

```typescript
import { TimelineRecorder, recordToolCall } from "@agentx/harness-core";

// Start a step
const stepId = recorder.startEntry("step", { input: userMessage });

// Record LLM call
const llmId = recorder.startEntry("llm_call", { model: "claude-3-5" });
const response = await llm.complete(prompt);
recorder.endEntry(llmId, { tokens: response.usage });

// Record tool call with helper
await recordToolCall(recorder, "write_file", async () => {
  return writeFile(path, content);
}, { path, content });

// End step
recorder.endEntry(stepId);
```

### 3. Event Analytics

Advanced analytics on session events:

```typescript
import { EventAnalytics, generateAnalyticsReport } from "@agentx/harness-core";

// Analyze events
const analytics = EventAnalytics.analyze(eventLog.getEvents());

console.log(`Total turns: ${analytics.turnStats.totalTurns}`);
console.log(`Success rate: ${analytics.turnStats.successfulTurns / analytics.turnStats.totalTurns * 100}%`);

// Top tools used
analytics.toolUsage.slice(0, 5).forEach(tool => {
  console.log(`${tool.toolName}: ${tool.totalCalls} calls`);
});

// Generate report
console.log(generateAnalyticsReport(analytics));
```

## Usage with createEnhancedAgentX

```typescript
import { createEnhancedAgentX } from "@agentx/harness-core";

const result = await createEnhancedAgentX({
  agentXInput: {
    modelProvider: myProvider,
    runContext: myContext,
    // ...
  },
  enableEventLog: true,
  eventLogPath: "./session-events.log",
  enableTimeline: true,
  enableHooks: true,
});

// Use Event Log
const events = result.eventLog?.getEvents();
console.log(`Logged ${events?.length} events`);

// Use Timeline
const tree = result.timeline?.getTree();
console.log(JSON.stringify(tree, null, 2));

// Use Analytics
const report = result.analytics.generateReport();
console.log(report);

// Cleanup
result.dispose();
```

## Event Types

### Turn Events
- `turn/start` - Turn started
- `turn/end` - Turn completed (with outcome: success/failure/partial)

### Step Events
- `step/start` - Step started
- `step/end` - Step completed (with stats)

### Tool Events
- `tool/call` - Tool called
- `tool/result` - Tool returned result
- `tool/error` - Tool execution failed

### Message Events
- `user/message` - User input
- `assistant/message` - Model response

### Protocol Events
- `protocol/phase` - Protocol phase change

### Context Events
- `context/inject` - Context item injected
- `context/compact` - Context compacted

### Human-in-the-Loop Events
- `human/ask` - Human asked for input
- `human/answer` - Human provided answer
- `human/timeout` - Human input timeout

## Analytics Report Example

```
============================================================
Session Analytics Report
============================================================

Session ID: abc-123
Duration: 45.23s

----------------------------------------
Turn Statistics
----------------------------------------
Total Turns: 5
Successful: 5 (100.0%)
Failed: 0
Partial: 0
Average Duration: 9.05s

----------------------------------------
Step Statistics
----------------------------------------
Total Steps: 12
Average Tool Calls per Step: 2.3
Average Errors per Step: 0.0
Average Duration: 3.77s

----------------------------------------
Tool Usage (Top 10)
----------------------------------------
read_file: 8 calls, 100.0% success, avg 0.12s
write_file: 5 calls, 100.0% success, avg 0.08s
execute_command: 3 calls, 100.0% success, avg 1.23s
inspect_schema: 2 calls, 100.0% success, avg 0.45s
run_sql_readonly: 1 calls, 100.0% success, avg 2.10s

----------------------------------------
Human Interaction
----------------------------------------
Total Asks: 1
Total Answers: 1
Total Timeouts: 0

============================================================
```

## Timeline Tree Structure

```json
{
  "id": "tl-1234567890-abc",
  "type": "session",
  "status": "completed",
  "duration": 45230,
  "children": [
    {
      "id": "tl-1234567891-def",
      "type": "turn",
      "status": "completed",
      "duration": 9046,
      "children": [
        {
          "id": "tl-1234567892-ghi",
          "type": "step",
          "status": "completed",
          "duration": 3770,
          "children": [
            {
              "id": "tl-1234567893-jkl",
              "type": "llm_call",
              "status": "completed",
              "duration": 1500
            },
            {
              "id": "tl-1234567894-mno",
              "type": "tool_call",
              "status": "completed",
              "duration": 120,
              "data": { "toolName": "read_file" }
            }
          ]
        }
      ]
    }
  ]
}
```

## Implementation Status

| Component | Status | File |
|----------|--------|------|
| EventLog Adapter | ✅ Complete | `src/adapters/event-log-adapter.ts` |
| Timeline Recorder | ✅ Complete | `src/session/timeline-recorder.ts` |
| Event Analytics | ✅ Complete | `src/session/event-analytics.ts` |
| Integration | ✅ Complete | `src/index.ts` |

## Next Steps

**Phase 3**: Plugin System (optional)
- Profile/Bundle mechanism
- Cordis-style plugin architecture
- Service registry

**Phase 4**: Multi-Runtime Support
- Local runtime with Bubblewrap
- Cloud runtime with VM isolation
- Enterprise runtime with custom backends
