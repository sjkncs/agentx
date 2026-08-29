# @agentx/harness-core

AgentX Agent Harness Core - 增量式增强包

## 特性

### Hook 系统 (Phase 1)
- **生命周期 Hook**: 在 Agent 的各个生命周期阶段注入自定义逻辑
- **事件驱动**: 支持 20+ 种事件类型 (agent.*, turn.*, step.*, tool.*, llm.*)
- **多种执行方式**: Shell 命令、HTTP 请求、MCP 工具、Prompt 模板
- **向后兼容**: 完全不影响现有 `createAgentX()` 的行为

### Session Event Log (Phase 2)
- **Append-only**: 追加写入的事件流，支持持久化
- **Fork/Resume**: 支持会话分叉和恢复
- **Timeline Recorder**: 细粒度时间线记录
- **Event Analytics**: 高级分析和报告生成

### Plugin 系统 (Phase 3)
- **Cordis 风格**: 可插拔的插件架构
- **Service Registry**: 服务注册和发现
- **Tool Registry**: 工具注册和管理
- **Profile/Bundle**: 插件组织和管理

### 多运行时支持 (Phase 4)
- **Local Runtime**: Node.js 沙箱执行
- **Remote Runtime**: 云 API 执行
- **Runtime Manager**: 运行时管理和路由

### Subagent Orchestration (Phase 5)
- **单子代理**: 完整的状态管理和事件
- **Fork/Resume**: 会话分叉和恢复
- **并行编排**: Sequential/Parallel/Pipeline/Fan-out 模式

### 向后兼容
- 100% 兼容现有 `@agentx/agent-runtime`
- 新功能完全可选启用
- 不修改任何现有代码

## 安装

```bash
npm install @agentx/harness-core
```

## 快速开始

### 方式 1: 使用增强工厂函数

```typescript
import { createEnhancedAgentX } from "@agentx/harness-core";

// 创建增强的 AgentX 实例
const result = await createEnhancedAgentX({
  agentXInput: {
    // ... 原有配置
    modelProvider: myModelProvider,
    runContext: myRunContext,
    // ...
  },
  enableHooks: true,
  hooksConfigPath: "./hooks.json",
});

// 使用原有功能
const { agent, protocol } = result.agentX;

// 使用 Hook 系统 (可选)
result.hookRegistry?.emit("custom", context);
```

### 方式 2: 直接使用 Hook 系统

```typescript
import { HookRegistry, loadHookConfig } from "@agentx/harness-core";

// 创建 Hook Registry
const registry = new HookRegistry({ enabled: true });

// 从配置文件加载
const config = loadHookConfig("./hooks.json");
await registry.loadFromConfig(config);

// 初始化
await registry.initialize();

// 在 Agent 事件中触发
await registry.emit("tool.post-execute", {
  event: "tool.post-execute",
  sessionId: "my-session",
  runId: "my-run",
  toolName: "write_file",
  toolOutput: { success: true },
  metadata: {},
});
```

### 方式 3: Session Event Log

```typescript
import { SessionEventLog, deriveMessages, deriveToolTrajectory } from "@agentx/harness-core";

// 创建 Event Log
const eventLog = new SessionEventLog({
  sessionId: "my-session",
  runId: "my-run",
  persist: true,
  logPath: "./session.log",
});

// 记录事件
eventLog.append({ type: "turn/start", turnId: "t1", timestamp: Date.now() });
eventLog.append({ type: "step/start", stepId: "s1", turnId: "t1", stepIndex: 0 });
eventLog.append({ type: "tool/call", toolName: "write_file", input: {...}, stepId: "s1", turnId: "t1" });

// 派生消息历史 (兼容 Mastra)
const messages = deriveMessages(eventLog.getEvents());

// 派生工具轨迹
const trajectory = deriveToolTrajectory(eventLog.getEvents());

// Fork 会话
const childSessionId = eventLog.fork("parent-session", "boundary-turn-id");
```

## Hook 配置示例

```json
{
  "hooks": [
    {
      "name": "lint-on-write",
      "description": "Run ESLint after writing files",
      "events": ["tool.post-execute"],
      "filter": {
        "toolName": "write_file"
      },
      "action": {
        "type": "shell",
        "command": "npx eslint --fix",
        "args": ["{{filePath}}"],
        "timeout": 30000
      },
      "enabled": true
    },
    {
      "name": "security-check",
      "description": "Check for security issues before shell commands",
      "events": ["tool.pre-execute"],
      "filter": {
        "toolName": ["execute_command", "shell", "exec"]
      },
      "action": {
        "type": "shell",
        "command": "python scripts/security_scan.py",
        "args": ["{{toolInput}}"],
        "timeout": 10000
      },
      "enabled": false
    }
  ],
  "defaults": {
    "timeout": 60000,
    "enabled": true
  }
}
```

## 支持的事件类型

| 事件类别 | 事件名称 | 触发时机 |
|---------|---------|---------|
| Agent | `agent.start`, `agent.end` | Agent 启动/停止 |
| Turn | `turn.start`, `turn.end`, `turn/stopping` | Turn 开始/结束/停止 |
| Step | `step.start`, `step.end` | Step 开始/结束 |
| Tool | `tool.pre-execute`, `tool.post-execute`, `tool.error` | 工具执行前/后/错误 |
| LLM | `llm.request`, `llm.response`, `llm.error` | LLM 调用前/后/错误 |
| Context | `context.compact`, `context.inject` | 上下文压缩/注入 |
| Session | `session.start`, `session.end`, `session.resume`, `session.fork` | 会话开始/结束/恢复/分叉 |

## API 参考

### HookRegistry

```typescript
class HookRegistry {
  constructor(config?: HookRegistryConfig);
  register(hook: HookDefinition): void;
  registerMany(hooks: HookDefinition[]): void;
  loadFromConfig(config: HookConfig): Promise<void>;
  enable(hookName: string): boolean;
  disable(hookName: string): boolean;
  get(hookName: string): HookDefinition | undefined;
  getAll(): HookDefinition[];
  getEnabled(): HookDefinition[];
  emit(event: HookEvent, context: HookContext): Promise<HookResult[]>;
  getBus(): HookBus;
  dispose(): void;
}
```

### HookBus

```typescript
class HookBus extends EventEmitter {
  register(hook: HookDefinition, handler: HookHandler): string;
  unregister(listenerId: string): boolean;
  clear(): void;
  emit(event: HookEvent, context: HookContext): Promise<HookResult[]>;
  getRegisteredHooks(): { event: HookEvent; listeners: HookListener[] }[];
  getStats(): HookStats;
}
```

### SessionEventLog

```typescript
class SessionEventLog {
  constructor(config: SessionEventLogConfig);
  append(event: SessionEvent): void;
  appendMany(events: SessionEvent[]): void;
  getEvents(): ReadonlyArray<SessionEvent & Metadata>;
  getEventCount(): number;
  replay(): AsyncIterableIterator<SessionEvent>;
  fork(parentSessionId: string, boundaryTurnId?: string): string;
  flush(): void;
  getStats(): EventLogStats;
  dispose(): void;
}
```

## License

Private - All rights reserved
