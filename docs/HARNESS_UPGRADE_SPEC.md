# AgentX Agent Harness 增量升级技术规格
**版本**: v1.1 | **日期**: 2026-08-14 | **状态**: 设计阶段

> **核心原则**: 不破坏现有 `@agentx/agent-runtime` 工程结构，通过独立新包+适配器实现渐进增强

---

## 一、升级策略

### 1.1 增量升级原则

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     增量升级架构 (不破坏现有结构)                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  现有系统 (保持不变)                    新增系统 (独立演进)                  │
│  ┌─────────────────────────┐        ┌─────────────────────────┐       │
│  │ @agentx/           │        │ @agentx/           │       │
│  │   agent-runtime         │◄───────►│   harness-core          │       │
│  │                         │ 适配器  │                         │       │
│  │ - Mastra Agent          │        │ - Plugin System         │       │
│  │ - Protocol FSM         │        │ - Event Log             │       │
│  │ - LATS Runtime         │        │ - Hook System           │       │
│  │ - GovernedToolFactory  │        │ - Tool Registry v2       │       │
│  └─────────────────────────┘        └─────────────────────────┘       │
│                                          │                            │
│                                          ▼                            │
│                              ┌─────────────────────────┐              │
│                              │ @agentx/           │              │
│                              │   harness-extensions     │              │
│                              │                         │              │
│                              │ - Subagent System       │              │
│                              │ - Curator (自学习)       │              │
│                              │ - Multi-Runtime         │              │
│                              └─────────────────────────┘              │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 新包结构

```
agentx-enhanced/packages/
├── agent-runtime/              # 现有包 (不变)
│   └── src/
│
├── harness-core/               # 新增: 核心增强包
│   └── src/
│       ├── plugins/            # 插件系统 (可选启用)
│       ├── hooks/             # Hook生命周期系统
│       ├── session/           # Session Event Log
│       ├── tools-v2/          # 工具注册表v2 (可选)
│       └── adapters/          # 与现有系统的适配器
│
└── harness-extensions/         # 新增: 高级功能包 (可选依赖)
    └── src/
        ├── subagent/          # Subagent系统
        ├── curator/           # 自学习系统
        └── runtime/           # 多运行时支持
```

### 1.3 兼容性矩阵

| 功能 | 当前 | 升级后 | 兼容模式 |
|------|------|--------|----------|
| createAgentX() | ✅ | ✅ | 完全兼容 |
| Protocol FSM | ✅ | ✅ | 完全兼容 |
| LATS | ✅ | ✅ | 完全兼容 |
| Hook系统 | ❌ | ✅ 可选 | 新增API |
| Event Log | ❌ | ✅ 可选 | 新增API |
| Plugin系统 | ❌ | ✅ 可选 | 新增API |

---

## 二、Phase 1: Hook系统 (最小侵入)

### 2.1 设计原则
- **零破坏**: 不修改任何现有代码
- **事件桥接**: 监听 Mastra/Agent 事件转发到 Hook系统
- **向后兼容**: 现有代码无需任何修改

### 2.2 实现位置
```
packages/harness-core/src/hooks/
├── hook-types.ts           # 类型定义
├── hook-bus.ts             # Hook总线
├── hook-registry.ts        # Hook注册表
├── hook-executor.ts        # Hook执行器
├── hook-config.ts          # 配置加载
└── index.ts               # 导出
```

### 2.3 Hook事件映射

```typescript
// packages/harness-core/src/hooks/hook-events.ts

// 事件来源映射到Mastra/Agent事件
export const EVENT_SOURCE_MAP = {
  // Agent Lifecycle
  'agent.start': 'agentStart',
  'agent.end': 'agentEnd',
  
  // Turn Lifecycle  
  'turn.start': 'turnStart',
  'turn.end': 'turnEnd',
  
  // Step Lifecycle
  'step.start': 'stepStart',
  'step.end': 'stepEnd',
  
  // Tool Lifecycle
  'tool.pre-execute': 'beforeToolUse',
  'tool.post-execute': 'afterToolUse',
  'tool.error': 'toolError',
  
  // LLM Lifecycle
  'llm.request': 'beforeModelCall',
  'llm.response': 'afterModelCall',
  
  // Context Lifecycle
  'context.compact': 'contextCompact',
  'context.inject': 'contextInject',
} as const;
```

### 2.4 使用示例

```typescript
// 用户配置文件: .agentx/hooks.json
{
  "hooks": [
    {
      "name": "lint-on-write",
      "events": ["tool.post-execute"],
      "filter": { "toolName": "write_file" },
      "action": {
        "type": "shell",
        "command": "npx eslint --fix {filePath}"
      }
    },
    {
      "name": "test-after-edit",
      "events": ["tool.post-execute"],
      "filter": { "toolName": "edit_file" },
      "action": {
        "type": "shell",
        "command": "npm test -- --changed={filePath}"
      }
    }
  ]
}
```

### 2.5 集成到现有createAgentX

```typescript
// packages/harness-core/src/adapters/hook-adapter.ts
import { createCustomEvent } from "@agentx/agent-runtime";

export interface HookAdapter {
  attach(emitter: AgUiEventEmitter): void;
  detach(): void;
}

export function createHookAdapter(
  config: HookConfig,
  hookBus: HookBus
): HookAdapter {
  return {
    attach(emitter) {
      // 监听Agent事件
      emitter.on('customEvent', (event) => {
        const hookEvent = mapToHookEvent(event);
        if (hookEvent) {
          hookBus.emit(hookEvent.type, hookEvent.payload);
        }
      });
    },
    detach() {
      // 清理
    }
  };
}
```

---

## 三、Phase 2: Session Event Log

### 3.1 设计原则
- **追加写入**: Append-only事件流
- **向后兼容**: 作为现有memory系统的补充
- **可插拔**: 可选择启用/禁用

### 3.2 实现位置
```
packages/harness-core/src/session/
├── event-types.ts          # SessionEvent类型
├── event-log.ts            # Event Log实现
├── event-projections.ts    # 投影函数 (deriveMessages等)
├── fork-resume.ts          # Fork/Resume支持
└── index.ts
```

### 3.3 事件流设计

```typescript
// packages/harness-core/src/session/event-types.ts
export type SessionEvent =
  // Turn事件
  | { type: 'turn/start'; turnId: string; timestamp: number }
  | { type: 'turn/end'; turnId: string; timestamp: number; outcome: TurnOutcome }
  
  // Step事件
  | { type: 'step/start'; stepId: string; turnId: string }
  | { type: 'step/end'; stepId: string; turnId: string; stats: StepStats }
  
  // 消息事件
  | { type: 'user/message'; content: string; turnId: string }
  | { type: 'assistant/message'; content: string; turnId: string }
  | { type: 'assistant/chunk'; delta: string; messageId: string }
  
  // 工具事件
  | { type: 'tool/call'; toolName: string; input: unknown; stepId: string }
  | { type: 'tool/result'; toolName: string; output: unknown; stepId: string }
  | { type: 'tool/error'; toolName: string; error: string; stepId: string }
  
  // 协议事件
  | { type: 'protocol/phase'; phaseId: string; turnId: string }
  | { type: 'protocol/action'; actionName: string; stepId: string };

export interface StepStats {
  toolCalls: number;
  totalDuration: number;
  tokensUsed: number;
  errors: number;
}
```

### 3.4 投影函数

```typescript
// packages/harness-core/src/session/event-projections.ts

// 从事件流派生消息历史 (兼容Mastra)
export function deriveMessages(events: SessionEvent[]): Message[] {
  return events
    .filter(e => e.type === 'user/message' || e.type === 'assistant/message')
    .map(e => ({
      role: e.type === 'user/message' ? 'user' : 'assistant',
      content: e.content,
    }));
}

// 从事件流派生工具调用轨迹
export function deriveToolTrajectory(events: SessionEvent[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const event of events) {
    if (event.type === 'tool/call') {
      calls.push({
        toolName: event.toolName,
        input: event.input,
        timestamp: event.stepId,
      });
    }
  }
  return calls;
}

// 从事件流派生会话摘要
export function deriveSessionSummary(events: SessionEvent[]): SessionSummary {
  const steps = events.filter(e => e.type === 'step/end');
  const errors = events.filter(e => e.type === 'tool/error');
  
  return {
    totalSteps: steps.length,
    totalErrors: errors.length,
    duration: calculateDuration(events),
    toolUsage: aggregateToolUsage(events),
  };
}
```

---

## 四、Phase 3: 插件系统 (可选)

### 4.1 设计原则
- **完全可选**: 默认不启用
- **向后兼容**: 不影响现有createAgentX行为
- **分层叠加**: 在现有系统上叠加新能力

### 4.2 实现位置
```
packages/harness-core/src/plugins/
├── plugin.ts               # Plugin接口
├── registry.ts             # Plugin注册表
├── context.ts              # Plugin上下文
├── profile.ts              # Profile/Bundle定义
└── index.ts
```

### 4.3 Plugin接口

```typescript
// packages/harness-core/src/plugins/plugin.ts
export interface Plugin {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  
  // 生命周期
  onMount(ctx: PluginContext): Promise<void>;
  onUnmount(ctx: PluginContext): Promise<void>;
  
  // 服务注册
  registerServices(ctx: PluginContext): void;
}

// Plugin上下文
export interface PluginContext {
  // 服务
  services: ServiceRegistry;
  
  // 事件
  events: EventBus;
  
  // Hook
  hooks: HookBus;
  
  // 配置
  config: ConfigStore;
}
```

### 4.4 与现有系统的桥接

```typescript
// packages/harness-core/src/adapters/plugin-bridge.ts

// 将新Plugin系统桥接到现有Mastra Agent
export function createMastraBridge(
  mastraAgent: Agent,
  pluginContext: PluginContext
): void {
  // 1. 将Plugin注册的工具桥接到Mastra
  pluginContext.services.onRegister('tool', (tool) => {
    mastraAgent.registerTool(tool);
  });
  
  // 2. 将Hook事件桥接到Plugin事件
  mastraAgent.on('toolUse', (tool) => {
    pluginContext.events.emit('tool/call', tool);
  });
  
  // 3. 将Plugin配置注入到Agent Instructions
  pluginContext.config.onUpdate((config) => {
    mastraAgent.updateInstructions(buildInstructions(config));
  });
}
```

---

## 五、文件结构 (最终)

```
agentx-enhanced/
├── packages/
│   ├── agent-runtime/              # 现有 (不变)
│   │   └── src/
│   │
│   ├── harness-core/               # 新增: 核心增强
│   │   ├── src/
│   │   │   ├── hooks/             # Hook系统
│   │   │   ├── session/           # Session Event Log
│   │   │   ├── plugins/           # Plugin系统 (可选)
│   │   │   ├── adapters/          # 适配器
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── harness-extensions/         # 新增: 高级功能
│       ├── src/
│       │   ├── subagent/          # Subagent系统
│       │   ├── curator/           # 自学习系统
│       │   ├── runtime/           # 多运行时
│       │   └── index.ts
│       └── package.json
│
└── docs/
    ├── HARNESS_UPGRADE_SPEC.md
    ├── hooks-guide.md             # Hook使用指南
    └── plugin-guide.md            # Plugin开发指南
```

---

## 六、实施计划 (渐进式)

### Month 1-2: Hook系统

| 周次 | 任务 | 交付物 |
|-----|------|--------|
| 1 | Hook类型定义 + HookBus | hook-types.ts, hook-bus.ts |
| 2 | Hook注册表 + 配置加载 | hook-registry.ts, hook-config.ts |
| 3 | Hook执行器 (shell/http/mcp) | hook-executor.ts |
| 4 | 与现有系统适配器 | hook-adapter.ts |
| 5 | 单元测试 + 文档 | hooks-guide.md |

### Month 3-4: Session Event Log

| 周次 | 任务 | 交付物 |
|-----|------|--------|
| 6 | Event类型 + EventLog基础 | event-types.ts, event-log.ts |
| 7 | 投影函数 | event-projections.ts |
| 8 | Fork/Resume支持 | fork-resume.ts |
| 9 | 与现有Memory系统集成 | memory-adapter.ts |

### Month 5-6: Plugin系统 (可选)

| 周次 | 任务 | 交付物 |
|-----|------|--------|
| 10 | Plugin接口 + 注册表 | plugin.ts, registry.ts |
| 11 | Plugin上下文 + Profile | context.ts, profile.ts |
| 12 | Mastra桥接器 | plugin-bridge.ts |

---

## 七、关键设计决策

### 7.1 向后兼容策略
- 所有新API都是可选的
- 现有 `createAgentX()` 完全不变
- 新功能通过 `options` 参数启用

### 7.2 性能考虑
- Hook执行异步化，不阻塞Agent Loop
- Event Log批量持久化
- 插件懒加载

### 7.3 安全考虑
- Hook执行有超时控制
- Shell命令白名单
- Plugin卸载时自动清理副作用

---

## 八、API扩展示例

```typescript
// 扩展后的 createAgentX (向后兼容)
import { createAgentX as originalCreateAgentX } from "@agentx/agent-runtime";
import { createHookAdapter } from "@agentx/harness-core/hooks";

export interface EnhancedCreateAgentXInput extends CreateAgentXInput {
  // 新增选项 (可选)
  enableHooks?: boolean;
  enableEventLog?: boolean;
  enablePlugins?: boolean;
  hooksConfig?: HookConfig;
  pluginProfile?: string;
}

export async function createEnhancedAgentX(
  input: EnhancedCreateAgentXInput
): Promise<EnhancedResult> {
  // 1. 调用原有函数
  const result = await originalCreateAgentX(input);
  
  // 2. 如果启用了Hook，附加Hook适配器
  if (input.enableHooks && input.hooksConfig) {
    const hookBus = createHookBus(input.hooksConfig);
    const hookAdapter = createHookAdapter(result.agent, hookBus);
    hookAdapter.attach();
    
    return {
      ...result,
      hookBus,
      detachHooks: () => hookAdapter.detach(),
    };
  }
  
  return result;
}
```

---

## 九、参考资料

1. [DeepSeek Harness Architecture](https://deepseek-harness.github.io/deepseek-harness/en/reference/)
2. [Cordis Framework](https://github.com/cordiverse/cordis)
3. [Skill Olympus](https://github.com/Dannykkh/skill-olympus)
4. [Harness Study](https://github.com/li2092/harness-study)
5. [Hermes Agent Architecture](https://deepwiki.com/NousResearch/hermes-agent/1.1-architecture-overview)
6. [Claude Code Skills](https://code.claude.com/docs/en/skills)
7. [Manus Context Engineering](https://www.manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)

---

*文档版本: v1.1 | 最后更新: 2026-08-14*
*升级策略: 增量式，不破坏现有结构*

---

## 二、核心架构设计

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           AgentX Agent                             │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      Plugin Container (Cordis-style)               │   │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐             │   │
│  │  │ Profile/Bundle│ │   Services   │ │    Events    │             │   │
│  │  │   System     │ │   Registry   │ │    Bus       │             │   │
│  │  └──────────────┘ └──────────────┘ └──────────────┘             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                  │                                      │
│  ┌──────────────────────────────┴──────────────────────────────────┐   │
│  │                        Core Packages                              │   │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐  │   │
│  │  │  Session   │ │   Tools    │ │   Agent    │ │    LLM     │  │   │
│  │  │   Event    │ │  Registry  │ │    Loop    │ │  Adapter   │  │   │
│  │  │    Log     │ │  (Scoped)  │ │  (Events)  │ │  (Seam)    │  │   │
│  │  └────────────┘ └────────────┘ └────────────┘ └────────────┘  │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                  │                                      │
│  ┌──────────────────────────────┴──────────────────────────────────┐   │
│  │                       Capability Seams                            │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │   │
│  │  │   File   │ │  Shell   │ │  Terminal│ │   MCP   │ │  Sand-│ │   │
│  │  │   System │ │          │ │          │ │  Server  │ │  box  │ │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └────────┘ │   │
│  └────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 插件系统设计 (借鉴 Cordis)

#### 2.2.1 Plugin 接口
```typescript
// packages/harness-core/src/plugins/plugin.ts
export interface Plugin {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  
  // 生命周期
  onMount(ctx: HarnessContext): Promise<void>;
  onUnmount(ctx: HarnessContext): Promise<void>;
  
  // 注册服务
  registerServices(ctx: HarnessContext): void;
}

// 可逆效果 - 卸载时自动清理
export interface ReversibleEffect {
  undo(): void;
}

export class PluginRegistry {
  private plugins = new Map<string, Plugin>();
  private effects: ReversibleEffect[] = [];
  
  async mount(plugin: Plugin, ctx: HarnessContext): Promise<void> {
    await plugin.onMount(ctx);
    plugin.registerServices(ctx);
    this.plugins.set(plugin.id, plugin);
  }
  
  async unmount(pluginId: string, ctx: HarnessContext): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;
    
    // 逆序执行清理
    const pluginEffects = this.effects.filter(e => e.pluginId === pluginId);
    for (const effect of pluginEffects.reverse()) {
      effect.undo();
    }
    
    await plugin.onUnmount(ctx);
    this.plugins.delete(pluginId);
  }
}
```

#### 2.2.2 Profile/Bundle 系统
```typescript
// packages/harness-core/src/config/profile.ts
export interface Profile {
  name: string;
  bundles: string[];
  plugins?: PluginConfig[];
  patch?: CordisPatch;
}

export interface CordisPatch {
  replace?: Record<string, ServiceConfig>;
  insert?: ServiceConfig[];
}

// 默认 Profile
export const PROFILES = {
  'data-task': {
    name: 'data-task',
    bundles: ['base', 'data-tools', 'skill-system'],
    plugins: [],
  },
  'code-task': {
    name: 'code-task', 
    bundles: ['base', 'code-tools', 'skill-system', 'git-integration'],
    plugins: [],
  },
  'research': {
    name: 'research',
    bundles: ['base', 'web-tools', 'knowledge-tools'],
    plugins: [],
  },
};
```

### 2.3 Session Event Log 设计 (借鉴 DeepSeek)

#### 2.3.1 Event 类型定义
```typescript
// packages/harness-core/src/session/event-types.ts
export type SessionEvent =
  // Turn 事件 (持久化)
  | { type: 'turn/start'; turnId: string; timestamp: number }
  | { type: 'turn/end'; turnId: string; timestamp: number }
  
  // Step 事件 (持久化)
  | { type: 'step/start'; stepId: string; turnId: string }
  | { type: 'step/end'; stepId: string; turnId: string; stats: StepStats }
  
  // 消息事件 (持久化)
  | { type: 'user/message'; content: string; turnId: string }
  | { type: 'assistant/message'; content: string; turnId: string }
  | { type: 'assistant/chunk'; delta: string; messageId: string }
  
  // 工具事件 (持久化)
  | { type: 'tool/call'; toolName: string; input: unknown; stepId: string }
  | { type: 'tool/result'; toolName: string; output: unknown; stepId: string; duration: number }
  | { type: 'tool/error'; toolName: string; error: string; stepId: string }
  
  // 能力事件 (持久化)
  | { type: 'capability/start'; name: string; config: unknown }
  | { type: 'capability/end'; name: string; result: unknown }
  
  // 状态事件 (持久化)
  | { type: 'session/title'; title: string }
  | { type: 'session/goal'; goal: string }
  | { type: 'session/compaction'; reason: string; beforeTokens: number; afterTokens: number };

export interface StepStats {
  toolCalls: number;
  totalDuration: number;
  tokensUsed: number;
}
```

#### 2.3.2 Session Event Log 实现
```typescript
// packages/harness-core/src/session/session-event-log.ts
export class SessionEventLog implements AsyncDisposable {
  private events: SessionEvent[] = [];
  private persisted = false;
  private filePath: string;
  
  // 追加事件
  append(event: SessionEvent): void {
    this.events.push({
      ...event,
      _seq: this.events.length,
      _timestamp: Date.now(),
    });
    
    // 持久化 (每10个事件或关键事件后)
    if (this.shouldPersist(event)) {
      this.persistAsync();
    }
  }
  
  // 重放事件流
  async *replay(): AsyncIterable<SessionEvent> {
    for (const event of this.events) {
      yield event;
    }
  }
  
  // Fork 会话
  fork(parentSessionId: string, boundary?: string): string {
    const childId = generateId();
    
    // 复制事件到子会话
    const forkPoint = boundary 
      ? this.events.findIndex(e => e.type === 'turn/start' && e.turnId === boundary)
      : this.events.length;
    
    return childId;
  }
  
  // 从日志派生消息历史
  deriveMessages(): Message[] {
    return this.events
      .filter(e => e.type === 'user/message' || e.type === 'assistant/message')
      .map(e => ({
        role: e.type === 'user/message' ? 'user' : 'assistant',
        content: e.content,
      }));
  }
  
  private shouldPersist(event: SessionEvent): boolean {
    const persistableTypes = [
      'turn/start', 'turn/end', 'step/start', 'step/end',
      'user/message', 'assistant/message', 'tool/call', 'tool/result',
    ];
    return persistableTypes.includes(event.type);
  }
}
```

### 2.4 工具注册表设计 (借鉴 Qwen)

#### 2.4.1 Scoped Tool Registry
```typescript
// packages/harness-core/src/tools/tool-registry.ts
export interface Tool {
  name: string;
  description: string;
  schema: JsonSchema;
  handler: ToolHandler;
  scope: 'session' | 'project' | 'user' | 'builtin';
  sandbox?: SandboxPolicy;
  hooks?: ToolHooks;
}

export interface ToolHooks {
  preExecute?: Hook[];
  postExecute?: Hook[];
  onError?: Hook[];
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private scopes = new Map<string, Set<string>>();
  
  register(tool: Tool): ReversibleEffect {
    this.tools.set(tool.name, tool);
    
    // 按作用域分组
    if (!this.scopes.has(tool.scope)) {
      this.scopes.set(tool.scope, new Set());
    }
    this.scopes.get(tool.scope)!.add(tool.name);
    
    return {
      pluginId: currentPluginId(),
      undo: () => this.unregister(tool.name),
    };
  }
  
  getTools(scope?: Scope): Tool[] {
    if (!scope) return Array.from(this.tools.values());
    
    const toolNames = this.scopes.get(scope) || new Set();
    return Array.from(toolNames).map(name => this.tools.get(name)!).filter(Boolean);
  }
  
  // 获取工具schema (用于prompt组装)
  getToolSchemas(scope?: Scope): ToolSchema[] {
    return this.getTools(scope).map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.schema,
    }));
  }
}
```

#### 2.4.2 工具执行管道
```typescript
// packages/harness-core/src/tools/tool-pipeline.ts
export class ToolExecutionPipeline {
  constructor(
    private registry: ToolRegistry,
    private sandboxManager: SandboxManager,
    private hookBus: EventBus,
  ) {}
  
  async execute(
    toolName: string,
    input: unknown,
    context: ExecutionContext,
  ): Promise<ToolResult> {
    const tool = this.registry.get(toolName);
    if (!tool) throw new ToolNotFoundError(toolName);
    
    // 1. 预执行 Hooks
    await this.hookBus.emit('tools/pre-execute', { tool, input, context });
    
    // 2. 沙箱隔离执行
    let result: ToolResult;
    if (tool.sandbox) {
      const sandbox = await this.sandboxManager.acquire(tool.sandbox);
      try {
        result = await sandbox.execute(tool.handler, input, context);
      } finally {
        await this.sandboxManager.release(sandbox);
      }
    } else {
      result = await tool.handler(input, context);
    }
    
    // 3. 后执行 Hooks
    await this.hookBus.emit('tools/post-execute', { tool, input, result, context });
    
    return result;
  }
}
```

### 2.5 Agent Loop 事件化 (借鉴 Claude/DeepSeek)

#### 2.5.1 Turn 流程
```
turn/start
  ├── claim next-step input + queued message
  ├── assemble prompt sections + tool schemas
  │
  ├──→ agent/pre-step (可拦截)
  │      reject | enter(messages)
  │
  ├── step/start
  │    ├── append user/message to log
  │    ├── derive model history from log
  │    ├── agent/request → llm/stream
  │    │      └── assistant/chunk* → assistant/message
  │    │
  │    ├── tool/call*
  │    │      → tools/pre-execute
  │    │      → tools/execute
  │    │      → tools/post-execute
  │    │      → tool/result*
  │    │
  │    └── step/end
  │
  ├──→ agent/turn-stopping (可停止turn)
  │
turn/end
```

#### 2.5.2 Agent Loop 实现
```typescript
// packages/harness-core/src/agent/agent-loop.ts
export class AgentLoop implements AsyncDisposable {
  private context: HarnessContext;
  private eventLog: SessionEventLog;
  private llm: LLMAdapter;
  private tools: ToolRegistry;
  private hookBus: EventBus;
  
  async runTurn(input: UserInput): Promise<TurnResult> {
    const turnId = generateId();
    
    // Turn Start
    this.eventLog.append({ type: 'turn/start', turnId });
    this.hookBus.emit('turn/start', { turnId, input });
    
    try {
      // Claim input
      const messages = await this.claimInput(input);
      
      // Pre-step (可拦截)
      const preStepResult = await this.hookBus.emit('agent/pre-step', {
        turnId,
        messages,
      });
      
      if (preStepResult.rejected) {
        this.eventLog.append({ type: 'turn/end', turnId });
        return { status: 'rejected', reason: preStepResult.reason };
      }
      
      // Step Loop
      while (this.shouldContinue()) {
        const stepResult = await this.runStep(turnId, messages);
        messages.push(...stepResult.newMessages);
        
        if (stepResult.isFinal) break;
      }
      
      this.eventLog.append({ type: 'turn/end', turnId });
      return { status: 'completed', turnId };
      
    } catch (error) {
      this.eventLog.append({ type: 'turn/error', turnId, error: String(error) });
      throw error;
    }
  }
  
  private async runStep(turnId: string, messages: Message[]): Promise<StepResult> {
    const stepId = generateId();
    this.eventLog.append({ type: 'step/start', stepId, turnId });
    
    try {
      // 组装prompt
      const prompt = await this.assemblePrompt(messages);
      
      // LLM 调用
      const response = await this.llm.complete(prompt);
      
      // 处理工具调用
      const toolResults: ToolResult[] = [];
      for (const toolCall of response.toolCalls || []) {
        this.eventLog.append({
          type: 'tool/call',
          toolName: toolCall.name,
          input: toolCall.input,
          stepId,
        });
        
        const result = await this.tools.execute(toolCall.name, toolCall.input);
        toolResults.push(result);
        
        this.eventLog.append({
          type: 'tool/result',
          toolName: toolCall.name,
          output: result.output,
          stepId,
          duration: result.duration,
        });
        
        messages.push({
          role: 'tool',
          toolCallId: toolCall.id,
          content: JSON.stringify(result.output),
        });
      }
      
      // Step End
      this.eventLog.append({
        type: 'step/end',
        stepId,
        turnId,
        stats: { toolCalls: toolResults.length, totalDuration: 0, tokensUsed: 0 },
      });
      
      return {
        newMessages: toolResults.map(r => ({
          role: 'tool' as const,
          content: JSON.stringify(r.output),
        })),
        isFinal: response.isComplete,
      };
      
    } catch (error) {
      this.eventLog.append({
        type: 'tool/error',
        stepId,
        error: String(error),
      });
      throw error;
    }
  }
}
```

---

## 三、生命周期 Hook 系统

### 3.1 Hook 类型定义
```typescript
// packages/harness-core/src/hooks/hook-types.ts
export type LifecycleEvent =
  // Turn 生命周期
  | 'turn/start'
  | 'turn/end'
  | 'turn/stopping'
  
  // Step 生命周期
  | 'step/start'
  | 'step/end'
  
  // 工具生命周期
  | 'tool/pre-execute'
  | 'tool/post-execute'
  | 'tool/error'
  
  // LLM 生命周期
  | 'llm/request'
  | 'llm/response'
  | 'llm/error'
  
  // 会话生命周期
  | 'session/start'
  | 'session/end'
  | 'session/resume'
  | 'session/fork';

export interface Hook {
  name: string;
  events: LifecycleEvent[];
  action: HookAction;
  filter?: HookFilter;
  order?: number; // 执行顺序
}

export type HookAction =
  | { type: 'shell'; command: string; args?: string[] }
  | { type: 'http'; url: string; method: string; body?: unknown }
  | { type: 'mcp'; server: string; tool: string; args?: unknown }
  | { type: 'prompt'; template: string };

export interface HookContext {
  event: LifecycleEvent;
  sessionId: string;
  turnId?: string;
  stepId?: string;
  payload: unknown;
  metadata: Record<string, unknown>;
}
```

### 3.2 Hook 配置示例
```typescript
// .agentx/hooks.json
{
  "hooks": [
    {
      "name": "lint-on-commit",
      "events": ["tool/post-execute"],
      "filter": { "toolName": "git_commit" },
      "action": {
        "type": "shell",
        "command": "npx eslint --fix {changedFiles}"
      }
    },
    {
      "name": "security-check",
      "events": ["tool/pre-execute"],
      "filter": { "toolName": ["shell", "exec", "bash"] },
      "action": {
        "type": "shell",
        "command": "python scripts/security_scan.py {input}"
      }
    },
    {
      "name": "test-on-save",
      "events": ["tool/post-execute"],
      "filter": { "toolName": "file_write", "filePattern": "\\.test\\.(ts|js)$" },
      "action": {
        "type": "shell", 
        "command": "npm test -- {filePath}"
      }
    }
  ]
}
```

---

## 四、Skill 系统增强

### 4.1 SKILL.md 格式 (兼容 Claude/Codex)
```markdown
---
name: data-analysis
description: Perform comprehensive data analysis. Use when user asks to analyze datasets, generate insights, or create visualizations.
triggers:
  - "analyze the data"
  - "generate insights"
  - "create a report"
allowed_tools:
  - list_data_sources
  - inspect_schema
  - run_sql_readonly
  - preview_table
  - knowledge_retrieve
denied_tools:
  - run_sql_write
  - file_delete
---

# Data Analysis Skill

## Objective
You are a data analysis expert. Your goal is to provide actionable insights from data.

## Workflow

### Phase 1: Discovery
1. List available data sources
2. Inspect schema of target tables
3. Understand data quality

### Phase 2: Analysis
1. Run exploratory queries
2. Generate summary statistics
3. Identify patterns and anomalies

### Phase 3: Synthesis
1. Create visualizations
2. Document findings
3. Store insights in knowledge base

## Output Format
- Executive Summary (2-3 sentences)
- Key Findings (bullet points)
- Supporting Evidence (tables, charts)
- Recommendations (actionable next steps)
```

### 4.2 Skill 目录结构
```
skills/
├── SKILL.md                    # 主技能文件
├── references/                 # 参考文档
│   ├── sql-best-practices.md
│   └── visualization-guide.md
├── scripts/                    # 可执行脚本
│   ├── validate_data.py
│   └── generate_chart.py
├── templates/                  # 模板文件
│   └── report-template.md
└── .assets/                    # 资源文件
    └── logo.png
```

---

## 五、多运行时支持

### 5.1 Runtime 接口
```typescript
// packages/harness-core/src/runtime/runtime.ts
export interface Runtime {
  readonly type: 'local' | 'cloud' | 'vm';
  readonly capabilities: RuntimeCapabilities;
  
  // 文件系统
  fs: FileSystem;
  
  // Shell 执行
  shell: ShellExecutor;
  
  // 网络 (可选)
  network?: NetworkPolicy;
  
  // 沙箱
  sandbox: SandboxManager;
}

export interface RuntimeCapabilities {
  canExecuteCode: boolean;
  canAccessNetwork: boolean;
  canModifyFiles: boolean;
  maxConcurrentProcesses: number;
  isolationLevel: 'none' | 'process' | 'container' | 'vm';
}
```

### 5.2 Local Runtime
```typescript
// packages/runtime-local/src/index.ts
export class LocalRuntime implements Runtime {
  readonly type = 'local';
  readonly capabilities: RuntimeCapabilities = {
    canExecuteCode: true,
    canAccessNetwork: true,
    canModifyFiles: true,
    maxConcurrentProcesses: 10,
    isolationLevel: 'process',
  };
  
  constructor(private config: LocalRuntimeConfig) {
    this.fs = new LocalFileSystem(config.workspaceDir);
    this.shell = new LocalShellExecutor();
    this.sandbox = new BubblewrapSandbox(); // Linux
    // 或 Windows: new WindowsSandbox()
  }
}
```

### 5.3 Cloud Runtime
```typescript
// packages/runtime-cloud/src/index.ts
export class CloudRuntime implements Runtime {
  readonly type = 'cloud';
  readonly capabilities: RuntimeCapabilities = {
    canExecuteCode: true,
    canAccessNetwork: true,
    canModifyFiles: true,
    maxConcurrentProcesses: 20,
    isolationLevel: 'vm',
  };
  
  constructor(private config: CloudRuntimeConfig) {
    this.fs = new RemoteFileSystem(config.vmEndpoint);
    this.shell = new RemoteShellExecutor(config.vmEndpoint);
    this.network = new CloudNetworkPolicy(config.networkPolicy);
    this.sandbox = new VMSandbox(config.vmId);
  }
  
  async provision(): Promise<void> {
    // 启动 VM
    const vm = await this.cloudProvider.createVM({
      image: this.config.image,
      size: this.config.size,
      region: this.config.region,
    });
    this.vmId = vm.id;
  }
  
  async deprovision(): Promise<void> {
    await this.cloudProvider.terminateVM(this.vmId);
  }
}
```

---

## 六、Subagent 系统

### 6.1 Subagent 接口
```typescript
// packages/harness-core/src/subagent/subagent.ts
export interface Subagent {
  readonly id: string;
  readonly name: string;
  readonly config: SubagentConfig;
  
  run(input: SubagentInput): Promise<SubagentOutput>;
  fork(override?: Partial<SubagentConfig>): Subagent;
  terminate(): Promise<void>;
}

export interface SubagentConfig {
  systemPrompt: string;
  tools: string[];           // 允许的工具列表
  model?: ModelConfig;
  maxSteps?: number;
  maxTokens?: number;
  timeout?: number;
  skills?: string[];
}

export interface SubagentScope {
  id: string;
  eventLog: SessionEventLog;
  toolRegistry: ToolRegistry; // 隔离的工具注册表
  memory: Memory;
}
```

### 6.2 Subagent 执行
```typescript
// packages/harness-core/src/subagent/subagent-executor.ts
export class SubagentExecutor {
  async execute(
    config: SubagentConfig,
    input: string,
    parentContext: HarnessContext,
  ): Promise<SubagentOutput> {
    // 1. 创建隔离作用域
    const scope = this.createIsolatedScope(config, parentContext);
    
    // 2. 创建子 Agent Loop
    const agentLoop = new AgentLoop({
      context: parentContext.withScope(scope),
      eventLog: scope.eventLog,
      llm: this.createLLM(config.model),
      tools: scope.toolRegistry,
    });
    
    // 3. Fork 父会话 (保留上下文)
    if (config.inheritContext) {
      const forkId = parentContext.eventLog.fork(parentContext.sessionId);
      scope.eventLog = parentContext.eventLog;
    }
    
    // 4. 执行
    try {
      const result = await agentLoop.runTurn({ type: 'user', content: input });
      return {
        output: result.finalMessage,
        events: Array.from(await scope.eventLog.replay()),
        stats: agentLoop.getStats(),
      };
    } finally {
      await agentLoop.dispose();
    }
  }
}
```

---

## 七、自学习系统 (Curator 风格)

### 7.1 轨迹记录
```typescript
// packages/curator/src/trajectory-recorder.ts
export interface Trajectory {
  id: string;
  sessionId: string;
  task: string;
  events: SessionEvent[];
  outcome: 'success' | 'failure' | 'partial';
  metrics: TrajectoryMetrics;
  skillId?: string;
}

export interface TrajectoryMetrics {
  totalSteps: number;
  totalDuration: number;
  tokensUsed: number;
  toolCalls: Record<string, number>;
  errors: number;
  humanInterruptions: number;
}
```

### 7.2 Skill 自动生成
```typescript
// packages/curator/src/skill-generator.ts
export class CuratorSkillGenerator {
  constructor(
    private trajectoryStore: TrajectoryStore,
    private skillRegistry: SkillRegistry,
  ) {}
  
  async analyzeAndGenerate(): Promise<void> {
    // 1. 分析成功轨迹
    const successfulTrajectories = await this.trajectoryStore.query({
      outcome: 'success',
      minSteps: 5,
      age: { days: 7 },
    });
    
    // 2. 聚类相似任务
    const clusters = await this.clusterTrajectories(successfulTrajectories);
    
    // 3. 生成 Skill
    for (const cluster of clusters) {
      if (cluster.frequency < 3) continue;
      
      const skill = await this.generateSkillFromCluster(cluster);
      
      // 4. 验证 Skill
      const validation = await this.validateSkill(skill);
      if (validation.quality > 0.8) {
        await this.skillRegistry.register(skill);
        console.log(`Generated skill: ${skill.name}`);
      }
    }
  }
  
  private async generateSkillFromCluster(cluster: TrajectoryCluster): Promise<Skill> {
    const prompt = `
      Based on the following ${cluster.count} successful task executions:
      
      Task Pattern: ${cluster.taskPattern}
      
      Common Steps:
      ${cluster.commonSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
      
      Generate a SKILL.md file with:
      1. Clear name and description
      2. Workflow phases
      3. Allowed/denied tools
      4. Output format
    `;
    
    const response = await this.llm.complete(prompt);
    return this.parseSkillFromResponse(response);
  }
}
```

---

## 八、实施计划

### Phase 1: 核心基础设施 (4周)

| 周次 | 任务 | 交付物 |
|-----|------|--------|
| 1 | Plugin 系统基础 | Plugin接口, PluginRegistry, 示例插件 |
| 2 | Session Event Log | Event类型, Log实现, Fork/Resume |
| 3 | Tool Registry 重构 | Scoped Registry, Pipeline, Sandbox集成 |
| 4 | Hook 系统 | Hook类型, HookBus, 配置文件 |

### Phase 2: Agent Loop 事件化 (3周)

| 周次 | 任务 | 交付物 |
|-----|------|--------|
| 5 | Agent Loop 重构 | 事件驱动Loop, Pre/Post Step Hooks |
| 6 | Turn/Step 流程 | Turn管理, 状态转换, 错误恢复 |
| 7 | 集成测试 | 端到端测试, 性能基准 |

### Phase 3: 运行时支持 (4周)

| 周次 | 任务 | 交付物 |
|-----|------|--------|
| 8 | Local Runtime | 文件系统, Shell, 沙箱 |
| 9 | Cloud Runtime | VM管理, 远程执行 |
| 10 | Subagent 系统 | Fork/Resume, 隔离执行 |
| 11 | Skill 系统增强 | SKILL.md兼容, 自动发现 |

### Phase 4: 高级功能 (5周)

| 周次 | 任务 | 交付物 |
|-----|------|--------|
| 12 | MCP 集成 | MCP Server发现, 动态加载 |
| 13 | Curator 自学习 | 轨迹记录, Skill生成 |
| 14 | 跨CLI记忆 | 多会话持久化 |
| 15 | 监控与可观测性 | Telemetry, Dashboard |
| 16 | 性能优化 | 缓存, Compaction |

---

## 九、文件结构

```
agentx-enhanced/
├── packages/
│   ├── harness-core/                    # 核心包
│   │   ├── src/
│   │   │   ├── plugins/                 # 插件系统
│   │   │   ├── session/                # Session Event Log
│   │   │   ├── tools/                  # 工具注册表
│   │   │   ├── agent/                  # Agent Loop
│   │   │   ├── hooks/                  # Hook系统
│   │   │   ├── runtime/                # 运行时抽象
│   │   │   ├── llm/                    # LLM适配器
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── runtime-local/                   # 本地运行时
│   │   └── src/
│   │       ├── local-runtime.ts
│   │       ├── sandbox/
│   │       └── index.ts
│   │
│   ├── runtime-cloud/                   # 云端运行时
│   │   └── src/
│   │       ├── cloud-runtime.ts
│   │       ├── vm-manager.ts
│   │       └── index.ts
│   │
│   ├── subagent/                        # 子Agent系统
│   │   └── src/
│   │       ├── subagent.ts
│   │       ├── executor.ts
│   │       └── index.ts
│   │
│   ├── curator/                          # 自学习系统
│   │   └── src/
│   │       ├── trajectory-recorder.ts
│   │       ├── skill-generator.ts
│   │       └── index.ts
│   │
│   └── agent-runtime/                    # 现有包 (增强)
│       └── src/
│           ├── legacy-bridge.ts         # 兼容层
│           ├── event-adapter.ts         # 事件适配器
│           └── enhanced-index.ts
│
├── docs/
│   ├── architecture/
│   │   ├── plugin-system.md
│   │   ├── event-log.md
│   │   └── agent-loop.md
│   └── guides/
│       ├── creating-plugins.md
│       ├── writing-skills.md
│       └── hooks-configuration.md
│
└── examples/
    ├── plugins/
    │   ├── custom-tool/
    │   └── custom-llm/
    └── skills/
        └── data-analysis/
```

---

## 十、关键设计决策

### 10.1 向后兼容
- 保留现有 `@agentx/agent-runtime` 接口
- 通过 `LegacyBridge` 适配旧版调用
- 渐进式迁移策略

### 10.2 性能考虑
- Event Log 异步持久化
- 工具执行管道并行化
- Compaction 策略 (Token预算)

### 10.3 安全考虑
- 沙箱隔离默认开启
- Hook 执行超时控制
- 敏感操作审批流程

---

## 十一、参考资料

1. [DeepSeek Harness Architecture](https://deepseek-harness.github.io/deepseek-harness/en/reference/)
2. [Cordis Framework](https://github.com/cordiverse/cordis)
3. [Skill Olympus](https://github.com/Dannykkh/skill-olympus)
4. [Harness Study](https://github.com/li2092/harness-study)
5. [Hermes Agent Architecture](https://deepwiki.com/NousResearch/hermes-agent/1.1-architecture-overview)
6. [Claude Code Skills](https://code.claude.com/docs/en/skills)
7. [Qwen Code Architecture](https://qwenlm.github.io/qwen-code-docs/en/developers/architecture/)
8. [Manus Context Engineering](https://www.manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)
9. [Manus - Agent Patterns Catalog](https://www.agentpatternscatalog.org/compositions/manus/)
10. [OpenAI Codex Architecture](https://deepwiki.com/openai/codex/1.3-architecture-overview)

---

*文档版本: v1.0 | 最后更新: 2026-08-14*
