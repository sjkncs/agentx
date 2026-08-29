/**
 * AgentX Harness Core - 主导出
 * 
 * 提供增强的 Hook 系统、Session Event Log 和 Plugin 系统
 * 保持与现有 @agentx/agent-runtime 的向后兼容
 */

// Re-export from agent-runtime for convenience
export {
  createAgentX,
  type CreateAgentXInput,
  type AgentRunContext,
  type AgentRunContextInput,
} from "@agentx/agent-runtime";

// Hook System
export {
  // Types
  type HookEvent,
  type HookAction,
  type HookContext,
  type HookResult,
  type HookDefinition,
  type HookConfig,
  type HookFilter,
  type HookListener,
  type HookHandler,
  type HookAttachment,
  HOOK_EVENTS,
  EVENT_SOURCE_MAP,
  createHookContext,
  
  // Hook Bus
  HookBus,
  type HookBusConfig,
  
  // Hook Executor
  HookExecutor,
  type HookExecutorConfig,
  
  // Hook Registry
  HookRegistry,
  type HookRegistryConfig,
  BUILTIN_HOOKS,
  
  // Hook Config Loader
  loadHookConfig,
  findHookConfig,
  loadHookConfigFromEnv,
  createDefaultHookConfig,
  HOOK_CONFIG_EXAMPLE,
} from "./hooks/index.js";

// Session Event Log & Analytics
export {
  SessionEventLog,
  type SessionEventLogConfig,
  type SessionEvent,
  type TurnOutcome,
  type StepStats,
  deriveMessages,
  deriveToolTrajectory,
  deriveSessionSummary,
  
  // Analytics
  EventAnalytics,
  generateAnalyticsReport,
  type SessionAnalytics,
  type ToolUsageStats,
  type LLMUsageStats,
  type TurnStats,
  type StepStatsSummary,
  
  // Timeline
  TimelineRecorder,
  createTimelineRecorder,
  recordLLMCall,
  recordToolCall,
  recordStep,
  type TimelineEntry,
  type TimelineEntryType,
} from "./session/index.js";

// Plugin System
export {
  // Types
  type Plugin,
  type PluginMetadata,
  type PluginCategory,
  type PluginContext,
  type PluginLifecycleHook,
  type PluginProfile,
  type PluginBundle,
  type PluginManagerConfig,
  type PluginReference,
  type ServiceDefinition,
  type ServiceRegistry,
  type ToolDefinition,
  type ToolExecuteFunction,
  type PluginToolContext,
  type PluginToolRegistry,
  type EventListener,
  type PluginEventBus,
  type PluginConfigStore,
  type ConfigChangeListener,
  
  // Errors
  PluginError,
  PluginLoadError,
  PluginMountError,
  PluginDependencyError,
  
  // Core Classes
  PluginManager,
  createPluginManager,
  
  // Implementations
  ServiceRegistryImpl,
  ToolRegistryImpl,
  EventBusImpl,
  ConfigStoreImpl,
  createPluginContext,
} from "./plugins/index.js";

// Multi-Runtime System
export {
  // Types
  type RuntimeType,
  type RuntimeCapabilities,
  type RuntimeStatus,
  type ExecutionResult,
  type SessionInfo,
  type LocalRuntimeConfig,
  type LocalExecutionRequest,
  type LocalExecutionResult,
  type RemoteRuntimeConfig,
  type RemoteExecutionRequest,
  type RemoteExecutionResult,
  type EnterpriseRuntimeConfig,
  type AnyRuntimeConfig,
  type RuntimeInstance,
  type ExecutionRequest,
  type RuntimeRegistryConfig,
  type RoutingStrategy,
  type RoutingRule,
  
  // Errors
  RuntimeError,
  RuntimeInitError,
  RuntimeExecutionError,
  RuntimeTimeoutError,
  RuntimeNotAvailableError,
  
  // Runtimes
  LocalRuntime,
  createLocalRuntime,
  createSecureLocalRuntime,
  
  RemoteRuntime,
  createRemoteRuntime,
  createAgentXCloudRuntime,
  
  RuntimeManager,
  createRuntimeManager,
  DefaultRoutingRules,
} from "./runtime/index.js";

// Subagent Orchestration System
export {
  // Classes
  Subagent,
  createSubagent,
  type SubagentEvents,
  
  SubagentManager,
  createSubagentManager,
  type SubagentManagerEvents,
  
  Orchestrator,
  createOrchestrator,
  
  // Types
  type SubagentStatus,
  type SubagentRole,
  type SubagentConfig,
  type SubagentIsolation,
  type SubagentModelConfig,
  type SubagentToolConfig,
  type SubagentRun,
  type SubagentStep,
  type SubagentResult,
  type OrchestrationMode,
  type OrchestrationTask,
  type Orchestration,
  type OrchestrationResult,
  type MessageType,
  type SubagentMessage,
  type SubagentManagerConfig,
  type SubagentStats,
  
  // Errors
  SubagentError,
  SubagentSpawnError,
  SubagentTimeoutError,
  SubagentNotFoundError,
  OrchestrationError,
} from "./subagent/index.js";

// MCP (Model Context Protocol) System
export {
  // Transport
  McpTransport,
  StdioMcpTransport,
  HttpMcpTransport,
  WebSocketMcpTransport,
  InProcessMcpTransport,
  createMcpTransport,
  type TransportEvents,
  
  // Client
  McpClient,
  createMcpClient,
  type McpClientEvents,
  
  // Server
  McpServer,
  createMcpServer,
  textResult,
  errorResult,
  type McpServerEvents,
  
  // Bridge
  McpBridge,
  createMcpBridge,
  mcpToolToHarnessTool,
  harnessToolToMcpTool,
  registerHarnessToolsToMcpServer,
  type McpBridgeOptions,
  
  // Types
  MCP_PROTOCOL_VERSION,
  JSON_RPC_VERSION,
  JsonRpcErrorCode,
  MCPMethods,
  
  // JSON-RPC
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcNotification,
  type JsonRpcError,
  
  // Initialize
  type ClientCapabilities,
  type ServerCapabilities,
  type InitializeParams,
  type InitializeResult,
  type ImplementationInfo,
  
  // Tools
  type McpTool,
  type McpToolInputSchema,
  type McpSchemaProperty,
  type ToolAnnotations,
  type CallToolParams,
  type CallToolResult,
  type ToolContent,
  type TextContent,
  type ImageContent,
  type AudioContent,
  type EmbeddedResource,
  
  // Resources
  type McpResource,
  type ResourceAnnotations,
  type ResourceContents,
  type ReadResourceParams,
  type ReadResourceResult,
  type SubscribeParams,
  type UnsubscribeParams,
  
  // Prompts
  type McpPrompt,
  type PromptArgument,
  type GetPromptParams,
  type GetPromptResult,
  type PromptMessage,
  
  // Transport
  type McpTransportType,
  type McpTransportConfig,
  type StdioTransportConfig,
  type HttpTransportConfig,
  type WebSocketTransportConfig,
  type InProcessTransportConfig,
  
  // Server
  type McpServerLike,
  type McpServerConfig,
  type McpToolDefinition,
  type McpResourceDefinition,
  type McpPromptDefinition,
  
  // Client
  type McpClientConfig,
  
  // Errors
  McpError,
  McpConnectionError,
  McpProtocolError,
  McpToolNotFoundError,
} from "./mcp/index.js";

// Sandbox System
export {
  // Classes
  Sandbox,
  ProcessSandbox,
  VmSandbox,
  DockerSandbox,
  WebContainerSandbox,
  createSandbox,
  type SandboxEvents,
  
  SandboxManager,
  createSandboxManager,
  type SandboxManagerEvents,
  
  // Types
  type SandboxType,
  type FilePermission,
  type NetworkPermission,
  type EnvPermission,
  type SandboxPermissions,
  type SandboxResourceLimits,
  type SandboxConfig,
  type SandboxExecutionRequest,
  type SandboxExecutionResult,
  type SandboxStatus,
  type SandboxInfo,
  type SandboxManagerConfig,
  
  // Errors
  SandboxError,
  SandboxStartError,
  SandboxExecutionError,
  SandboxTimeoutError,
  PermissionDeniedError,
} from "./sandbox/index.js";

// Deterministic Gates System
export {
  GateManager,
  createGateManager,
  type GateManagerEvents,
  
  // Built-in executors
  lintGateExecutor,
  testGateExecutor,
  typeCheckGateExecutor,
  buildGateExecutor,
  formatGateExecutor,
  coverageGateExecutor,
  executeCompositeGate,
  builtInExecutors,
  
  // Types
  type GateType,
  type GateStatus,
  type GateSeverity,
  type GateIssue,
  type GateResult,
  type GateConfig,
  type GateContext,
  type GateExecutor,
  type CompositeMode,
  type CompositeGateConfig,
  type GatePipeline,
  type PipelineResult,
  type GateManagerConfig,
  type GateStatistics,
  
  // Errors
  GateError,
  GateExecutionError,
  GateTimeoutError,
} from "./gates/index.js";

// Cursor SDK Integration System
export {
  CursorSdkAdapter,
  LocalCursorSdkAdapter,
  CloudCursorSdkAdapter,
  createCursorSdkAdapter,
  type CursorSdkEvents,
  
  IdeResidentWorkflow,
  createIdeResidentWorkflow,
  type IdeWorkflowEvents,
  
  // Types
  type CursorFileContext,
  type CursorSelection,
  type CursorPosition,
  type CursorIdeContext,
  type CursorAgentType,
  type CursorAgentStatus,
  type CursorAgentRequest,
  type CursorAgentResponse,
  type CursorFileEdit,
  type CursorToolCall,
  type CursorStreamEventType,
  type CursorStreamEvent,
  type CursorSdkConfig,
  
  // Errors
  CursorSdkError,
  CursorConnectionError,
  CursorAgentError,
} from "./cursor/index.js";

// Adapters
export {
  HookAdapter,
  createHookAdapter,
  type HookAdapterConfig,

  EventLogAdapter,
  createEventLogAdapter,
  type EventLogAdapterConfig,
} from "./adapters/index.js";

// Goal Mode - 目标驱动执行循环 (借鉴 ZCode /goal)
export {
  GoalRunner,
  createGoalRunner,
  type GoalConfig,
  type GoalVerifier,
  type GoalIteration,
  type GoalIterationOutput,
  type GoalRunResult,
  type GoalModeEvents,
} from "./goal/index.js";

// Plugin / MCP Marketplace - 远程 + 本地市场
export {
  Marketplace,
  createMarketplace,
  type PluginManifest,
  type PluginCapability,
  type RegistrySource,
  type MarketplaceConfig,
  type MarketplaceEvents,
  type InstalledPluginEntry,
} from "./marketplace/index.js";

// Worktree Helper - 轻量 git diff/worktree 工具
export {
  WorktreeHelper,
  createWorktreeHelper,
  type WorktreeEntry,
  type DiffRequest,
  type DiffResult,
  type DiffFile,
} from "./worktree/index.js";

// Capability Brief - 默认注入到 agent 的能力清单
export {
  HARNESS_VERSION,
  HARNESS_NAME,
  DEFAULT_HARNESS_CAPABILITIES,
  buildHarnessSystemPrompt,
} from "./capabilities/index.js";

// ============================================================================
// Enhanced Factory Function
// ============================================================================

import { createAgentX } from "@agentx/agent-runtime";
import {
  HookRegistry,
  loadHookConfig,
  findHookConfig,
} from "./hooks/index.js";
import {
  SessionEventLog,
  TimelineRecorder,
  EventAnalytics,
  generateAnalyticsReport,
} from "./session/index.js";
import {
  HookAdapter,
  createHookAdapter,
  EventLogAdapter,
  createEventLogAdapter,
} from "./adapters/index.js";
import type { HookConfig } from "./hooks/hook-types.js";
import type { TimelineRecorderConfig } from "./session/timeline-recorder.js";

/**
 * 增强的 createAgentX 选项
 */
export interface CreateEnhancedAgentXInput {
  /** AgentX 输入 */
  agentXInput: Parameters<typeof createAgentX>[0];
  
  /** 是否启用 Hook 系统 */
  enableHooks?: boolean;
  
  /** Hook 配置文件路径 */
  hooksConfigPath?: string;
  
  /** 直接传入的 Hook 配置 */
  hooksConfig?: HookConfig;
  
  /** 是否启用 Session Event Log */
  enableEventLog?: boolean;
  
  /** Event Log 持久化路径 */
  eventLogPath?: string;
  
  /** 是否启用 Timeline Recorder */
  enableTimeline?: boolean;
}

/**
 * 增强的 createAgentX 结果
 */
export interface CreateEnhancedAgentXResult {
  /** 原始 AgentX 结果 */
  agentX: Awaited<ReturnType<typeof createAgentX>>;
  
  /** Event Log (如果启用) */
  eventLog?: SessionEventLog;
  
  /** Timeline Recorder (如果启用) */
  timeline?: TimelineRecorder;
  
  /** Hook Registry (如果启用) */
  hookRegistry?: HookRegistry;
  
  /** Hook Adapter (如果启用) */
  hookAdapter?: HookAdapter;
  
  /** Event Log Adapter (如果启用) */
  eventLogAdapter?: EventLogAdapter;
  
  /** 分析函数 */
  analytics: {
    getSessionAnalytics(): ReturnType<typeof EventAnalytics.analyze>;
    generateReport(): string;
  };
  
  /** 清理函数 */
  dispose(): void;
}

/**
 * 创建增强的 AgentX 实例
 */
export async function createEnhancedAgentX(
  input: CreateEnhancedAgentXInput
): Promise<CreateEnhancedAgentXResult> {
  const {
    agentXInput,
    enableHooks = false,
    hooksConfigPath,
    hooksConfig,
    enableEventLog = false,
    eventLogPath,
    enableTimeline = false,
  } = input;
  
  // 1. 创建原始 AgentX 实例
  const agentX = await createAgentX(agentXInput);
  
  // 2. 创建 Event Log
  let eventLog: SessionEventLog | undefined;
  let eventLogAdapter: EventLogAdapter | undefined;
  
  if (enableEventLog) {
    eventLog = new SessionEventLog({
      sessionId: agentXInput.runContext.session_id,
      runId: agentXInput.runContext.run_id,
      persist: Boolean(eventLogPath),
      logPath: eventLogPath,
    });
    
    eventLogAdapter = createEventLogAdapter(
      agentXInput.emitter,
      eventLog,
      {
        sessionId: agentXInput.runContext.session_id,
        runId: agentXInput.runContext.run_id,
      }
    );
    eventLogAdapter.attach();
  }
  
  // 3. 创建 Timeline Recorder
  let timeline: TimelineRecorder | undefined;
  
  if (enableTimeline && eventLog) {
    const timelineConfig: TimelineRecorderConfig = {
      sessionId: agentXInput.runContext.session_id,
      runId: agentXInput.runContext.run_id,
      enabled: true,
      syncToEventLog: true,
    };
    
    timeline = new TimelineRecorder(eventLog, timelineConfig);
  }
  
  // 4. 创建 Hook 系统
  let hookRegistry: HookRegistry | undefined;
  let hookAdapter: HookAdapter | undefined;
  
  if (enableHooks) {
    let config: HookConfig | undefined = hooksConfig;
    
    if (!config) {
      const configPath = hooksConfigPath || findHookConfig() || undefined;
      if (configPath) {
        config = loadHookConfig(configPath);
      }
    }
    
    hookRegistry = new HookRegistry({
      enabled: true,
      defaultTimeout: 60000,
    });
    
    if (config) {
      await hookRegistry.loadFromConfig(config);
    }
    
    await hookRegistry.initialize();
    
    hookAdapter = createHookAdapter(
      agentXInput.emitter,
      hookRegistry.getBus(),
      {
        enabled: true,
        sessionId: agentXInput.runContext.session_id,
        runId: agentXInput.runContext.run_id,
      }
    );
    hookAdapter.attach();
  }
  
  // 5. 构建结果
  const result: CreateEnhancedAgentXResult = {
    agentX,
    eventLog,
    timeline,
    hookRegistry,
    hookAdapter,
    eventLogAdapter,
    
    analytics: {
      getSessionAnalytics() {
        if (!eventLog) {
          return EventAnalytics.analyze([]);
        }
        return EventAnalytics.analyze(eventLog.getEvents());
      },
      
      generateReport() {
        if (!eventLog) {
          return "Event Log not enabled";
        }
        const analytics = EventAnalytics.analyze(eventLog.getEvents());
        return generateAnalyticsReport(analytics);
      },
    },
    
    dispose() {
      hookAdapter?.detach();
      hookRegistry?.dispose();
      eventLogAdapter?.detach();
      timeline?.dispose();
      eventLog?.dispose();
      agentX.destroyWorkspace();
    },
  };
  
  return result;
}
