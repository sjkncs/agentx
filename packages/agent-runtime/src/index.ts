import { Agent } from "@mastra/core/agent";
import {
  askUserTool,
  submitPlanTool,
  taskCheckTool,
  taskCompleteTool,
  taskUpdateTool,
  taskWriteTool
} from "@mastra/core/harness";
import { Mastra } from "@mastra/core/mastra";
import { WorkingMemory } from "@mastra/core/processors";
import { createSkillTools, createWorkspaceTools } from "@mastra/core/workspace";
import type { Message } from "@ag-ui/core";
import type { ArtifactService, SessionOutputService } from "@datafoundry/artifacts";
import type { DataGateway } from "@datafoundry/data-gateway";
import type { KnowledgeService } from "@datafoundry/knowledge";
import { type FileAssetService, fileAssetRefDto, mimeTypeForFilename } from "@datafoundry/files";
import {
  materializeSkillPackages,
  type SkillRecord,
  type SkillSelectionResult
} from "@datafoundry/skills";
import { copyFileSync, linkSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createModelProvider,
  createModelProviderFromConfig,
  type ChatProviderConfig,
  type ModelProvider
} from "@datafoundry/providers";

import { AGENT_MAX_STEPS } from "./runtime-limits.js";
import { buildAgentInstructions, type MaterializedWorkspaceAttachment } from "./agent-instructions.js";
import { AGENT_RUNTIME_LIMITS } from "./config/agent-runtime-limits.js";
import { createToolObservationBoundary } from "./context/tool-observation/tool-observation-boundary.js";
import {
  createMastraContextProcessorBoundary
} from "./context/protocol/mastra/mastra-context-processor-boundary.js";
import type { ContextPackageRecorder } from "./context/protocol/mastra/mastra-context-budget-processor.js";
import type { ContextPackage } from "./context/inventory/context-package.js";
import { ToolObservationDispatcher } from "./context/tool-observation/tool-observation-dispatcher.js";
import { toolObservationModelFromPackage } from "./context/tool-observation/tool-observation-projection-items.js";
import { createAgUiContextEventSink } from "./context/protocol/ag-ui/ag-ui-context-event-sink.js";
import {
  NonEmptyMessageContentCompatProcessor,
  shouldApplyNonEmptyMessageContentCompat,
} from "./provider-compat/non-empty-message-content-compat.js";
import {
  type TaskStateRuntime
} from "./memory/task-state-runtime.js";
import { CONVERSATION_WORKING_MEMORY_CONFIG } from "./memory/conversation-memory-bridge.js";
import type { RuntimeContextSource } from "./context/source/runtime-context-source.js";
import {
  createContextItem,
  type ContextItem,
  type CreateContextItemInput
} from "./context/inventory/context-item.js";
import {
  createContextSourceMetadata,
  type ContextSourceMetadata
} from "./context/inventory/context-source-metadata.js";
import { GoalRuntimeAdapter, type GoalRequest } from "./memory/goal-runtime-adapter.js";
import { createDataFoundryToolRegistry } from "./tools/data-tools.js";
import { GovernedToolFactory, type GovernedToolErrorHandler } from "./tools/governed-tool-factory.js";
import { createWebSearchTool } from "./tools/web-search.js";
import { LatsRuntime } from "./lats/lats-runtime.js";
import type { LLMAPI } from "./lats/multi-path-trajectory.js";
import {
  maybeIngestSessionFileOutput,
  maybeIngestSessionFileToolResult
} from "./tools/session-output-ingest.js";
import {
  createRunWorkspace,
  resolveSkillCacheDir,
  resolveWorkspaceDir
} from "./tools/workspace-factory.js";
import { createMastraStreamNormalizerHooks } from "./stream/mastra-stream-hooks.js";
import { createTokenUsageCorrelationStore } from "./stream/token-usage-correlation.js";
import { wrapAgentForAgUi } from "./stream/mastra-stream-normalizer.js";
import type { AgentRunContext, AgentRunContextInput, AgUiEventEmitter } from "./types.js";
import { createCustomEvent } from "./events.js";
import { createTool, type ToolAction } from "@mastra/core/tools";
import { z } from "zod";
import {
  createRunProtocolBoundary,
  type RunProtocolBoundary
} from "./protocol/run-protocol-boundary.js";
import type { ProtocolClassifier, ProtocolIdentity } from "./protocol/protocol-router.js";
import { createModelProtocolClassifier } from "./protocol/model-protocol-classifier.js";
import {
  createModelAnalysisRequirementExtractor,
  type AnalysisRequirementExtractor
} from "./protocol/model-analysis-requirement-extractor.js";
import {
  createModelAnalysisContractGrounder,
  type AnalysisContractGrounder
} from "./protocol/model-analysis-contract-grounder.js";
import type { AnalysisRequirement } from "./protocol/analysis-requirements.js";
import type { DataAnalysisState } from "./protocol/protocols/data-analysis.js";
import { createDefaultSemanticProvider } from "./semantic/default-semantic-provider.js";
import type { ProtocolEvent } from "./protocol/types.js";
import type { ContextPackageRef, ProtocolStateStore } from "./protocol/types.js";
import { toolErrorObservation as createToolErrorObservation } from "./errors/tool-execution-error.js";

export type { AgentRunContext, AgentRunContextInput, AgUiEventEmitter } from "./types.js";
export type { ContextPackage } from "./context/inventory/context-package.js";
export type { ContextPlan } from "./context/inventory/context-plan.js";
export type { ContextPackageRecorder } from "./context/protocol/mastra/mastra-context-budget-processor.js";
export type AgentContextItem = ContextItem;
export type AgentContextSourceMetadata = ContextSourceMetadata;
export type CreateAgentContextItemInput = CreateContextItemInput;
export type AgentModelContextProfile = {
  id: string;
  contextWindow: number;
  outputReserve: number;
  safetyMargin: number;
  messageOverhead: number;
  modelPattern: string;
  toolSchemaOverhead: number;
};
export const createAgentContextItem = createContextItem;
export const createAgentContextSourceMetadata = createContextSourceMetadata;

export {
  foodSafetyAuditOutputTool,
  FOOD_SAFETY_TOOLS,
  foodSafetyCreateWorkOrderTool,
  foodSafetyGenerateReplyTool,
  foodSafetyGetCompensationTool,
  foodSafetyGetSlaTool,
  foodSafetyIntentClassifyTool,
  foodSafetyQueryWorkOrdersTool,
} from "./tools/food-safety-tools.js";

export {
  XichaFSDAgent,
  type XichaFSDConfig,
  type XichaFSDAgentInput,
  type XichaFSDAgentResult,
} from "./tools/xicha/index.js";
export {
  XichaFSDOrchestrator,
  type NotifyEvent,
  type OrchestratedResult,
  type XichaOrchestratorConfig,
} from "./tools/xicha/xicha-orchestrator.js";
export { FoodSafetySubagent, type IntentClassifyOutput, type ReplyGenerateOutput, type AuditOutput } from "./tools/xicha/food-safety-subagent.js";
export {
  WorkOrderSubagent,
  type WorkOrderCreateInput,
  type WorkOrderCreateOutput,
  type WorkOrderEscalateInput,
  type WorkOrderStageAdvanceInput,
  type CompensationApproveInput,
} from "./tools/xicha/wo-subagent.js";

export const DATA_AGENT_TOOL_NAMES = [
  "inspect_schema",
  "list_data_sources",
  "preview_table",
  "run_sql_readonly"
] as const;
/** HITL tools that suspend the run; their TOOL_CALL_RESULT is emitted on interaction resume. */
const HITL_TOOL_NAMES = ["ask_user", "submit_plan"] as const;
export const STATIC_AGENT_TOOL_NAMES = [
  "ask_user",
  "edit_file",
  "execute_command",
  "file_stat",
  "grep",
  "inspect_schema",
  "list_data_sources",
  "list_files",
  "mkdir",
  "preview_table",
  "promote_workspace_file",
  "list_workspace_files",
  "read_workspace_file",
  "read_file",
  "retrieve_knowledge",
  "run_sql_readonly",
  "skill",
  "skill_read",
  "skill_search",
  "submit_plan",
  "task_check",
  "task_complete",
  "task_update",
  "task_write",
  "write_file"
] as const;
export {
  ContextTokenCounter,
  type ContextTokenCounterOptions
} from "./context/policy/context-token-counter.js";
export { createActivityDelta, createActivitySnapshot, createCustomEvent } from "./events.js";
export {
  AGENT_MEMORY_MODES,
  createAgentMemoryRuntime,
  createTaskStateRuntime,
  parseAgentMemoryMode,
  type AgentMemoryMode,
  type AgentMemoryRuntime,
  type AgentMemoryRuntimeOptions,
  type TaskStateRuntime
} from "./memory/task-state-runtime.js";
export {
  normalizeMastraFullStream,
  wrapAgentForAgUi,
  type MastraAgentForAgUiOptions,
  type MastraStreamChunk,
  type MastraStreamNormalizerHooks
} from "./stream/mastra-stream-normalizer.js";
export { createMastraStreamNormalizerHooks, tokenUsageEventFromChunk } from "./stream/mastra-stream-hooks.js";
export {
  createTokenUsageCorrelationStore,
  type TokenUsageCorrelationPayload,
} from "./stream/token-usage-correlation.js";
export {
  resolveRunWorkspaceDir,
  resolveSkillCacheDir,
  resolveSkillCacheRoot,
  resolveSessionWorkspaceDir,
  resolveWorkspaceDir,
  resolveWorkspaceRoot
} from "./tools/workspace-factory.js";
export { resolvePythonRuntime } from "./tools/python-runtime.js";
export { createDataFoundryToolRegistry, type ToolRegistry } from "./tools/data-tools.js";
export {
  GoalRuntimeAdapter,
  type GoalRequest,
  type GoalSnapshot
} from "./memory/goal-runtime-adapter.js";
export {
  CONVERSATION_WORKING_MEMORY_CONFIG,
  CONVERSATION_WORKING_MEMORY_TEMPLATE,
  MastraConversationMemoryBridge,
  createMastraConversationMemoryBridge,
  formatConversationProjection,
  type ConversationMemoryBridge,
  type ConversationMemoryProjection
} from "./memory/conversation-memory-bridge.js";

export type AgentLongTermMemoryRecord = {
  confidence: number;
  content_text: string;
  datasource_id?: string;
  id: string;
  kind: string;
  scope: "datasource" | "session" | "user";
  session_id?: string;
  source?: string;
  source_run_id?: string;
};

export type CreateDataFoundryInput = {
  abortSignal?: AbortSignal | undefined;
  artifactService?: ArtifactService;
  contextPackageRecorder?: ContextPackageRecorder;
  contextPackageExists?(reference: ContextPackageRef): boolean;
  dataGateway: DataGateway;
  emitter: AgUiEventEmitter;
  fileAssetService?: FileAssetService;
  initialContextPackage?: ContextPackage;
  knowledgeService?: KnowledgeService;
  modelProvider: Exclude<ModelProvider, { kind: "mock" }>;
  runContext: AgentRunContext;
  mcpTools?: Record<string, ToolAction<any, any, any, any, any>>;
  sessionOutputService?: SessionOutputService;
  mcpToolNames?: string[];
  selectedSkills?: SkillRecord[];
  skillSelection?: SkillSelectionResult;
  taskStateRuntime?: TaskStateRuntime;
  longTermMemory?: {
    records: AgentLongTermMemoryRecord[];
    maxChars?: number;
  };
  evidenceContextItems?: AgentContextItem[];
  messages: Message[];
  modelSettings?: {
    frequencyPenalty?: number;
    maxOutputTokens?: number;
    presencePenalty?: number;
    temperature?: number;
    topP?: number;
  };
  modelContextProfile?: AgentModelContextProfile;
  explicitProtocol?: ProtocolIdentity;
  protocolClassifier?: ProtocolClassifier;
  analysisRequirementExtractor?: AnalysisRequirementExtractor;
  analysisContractGrounder?: AnalysisContractGrounder;
  onProtocolEvent?(event: ProtocolEvent): void;
  protocolStateStore?: ProtocolStateStore;
  resourceRevisions?: Record<string, number>;
  workspaceAttachments?: WorkspaceAttachment[];
  goal?: GoalRequest;
  /**
   * Optional LATS (Language Agent Tree Search) configuration. When enabled, the
   * runtime records a multi-path trajectory of tool executions, generates Reflexion
   * on failures, and emits `tree.*` AG-UI custom events for frontend DAG rendering.
   * Disabled by default so ReAct-style runs are unaffected.
   */
  lats?: LatsConfig | undefined;
  /**
   * 工作区根目录（调用方注入）。未提供时回落到 WORKSPACE_ROOT，再回落到系统 temp。
   * 每个 session 在该目录下按 {user_id}/{session_id} 建立隔离子目录，跨 run 保留文件。
   * 留空即按默认策略隔离，不影响 workspace 工具的可用性。
   */
  workspaceRoot?: string | undefined;
};

/** Configuration for optional LATS tree-search tracking. */
export type LatsConfig = {
  /** Master switch. Defaults to false (ReAct mode). */
  enabled?: boolean | undefined;
  /** Max branches per decision point. Defaults to 3. */
  maxBranchingFactor?: number | undefined;
  /** UCB exploration coefficient. Defaults to 1.4. */
  ucbCoefficient?: number | undefined;
  /** Optional LLM adapter for Reflexion generation + self-evaluation. */
  llm?: LLMAPI | undefined;
};

export type { LLMAPI } from "./lats/multi-path-trajectory.js";

export type WorkspaceAttachment = {
  file_id: string;
  filename: string;
  mime_type?: string;
  size_bytes: number;
  source_path: string;
};

export const createDataFoundry = async (
  input: CreateDataFoundryInput
): Promise<{
  agent: Agent;
  governedMessages: Message[];
  goalRuntime?: GoalRuntimeAdapter;
  commandExecutionEnabled: boolean;
  isolation: "bwrap" | "none" | "seatbelt";
  workspaceDir: string;
  sessionDir: string;
  protocol: RunProtocolBoundary;
  flushProtocolEvents(): void;
  destroyWorkspace(): Promise<void>;
}> => {
  const toolObservationBoundary = createToolObservationBoundary({
    identity: {
      resourceId: input.runContext.user_id,
      sessionId: input.runContext.session_id,
      runId: input.runContext.run_id
    },
    includeKnowledge: Boolean(input.knowledgeService),
    ...(input.mcpToolNames?.length ? { mcpToolNames: input.mcpToolNames } : {})
  });
  const contextRunState = toolObservationBoundary.contextRunState;
  if (input.initialContextPackage) {
    contextRunState.merge(input.initialContextPackage);
  }
  input.contextPackageRecorder?.record({ contextPackage: contextRunState.package });

  const runDir = resolveWorkspaceDir({
    runContext: input.runContext,
    workspaceRoot: input.workspaceRoot
  });
  const skillCacheDir = resolveSkillCacheDir({
    runContext: input.runContext,
    workspaceRoot: input.workspaceRoot
  });
  if (input.selectedSkills?.length) {
    await materializeSkillPackages({
      fileAssetService: requireFileAssetService(input.fileAssetService),
      runDir: skillCacheDir,
      skills: input.selectedSkills,
      userId: input.runContext.user_id,
      workspaceId: input.runContext.workspace_id ?? "default"
    });
  }
  mkdirSync(join(skillCacheDir, "skills"), { recursive: true });
  // 绑定到本次 session 的工作区：LocalFilesystem + LocalSandbox。
  // createDataFoundry 每次 run 都调用，直接闭包捕获 runContext，不依赖下游 requestContext 注入。
  const runWorkspace = createRunWorkspace({
    runContext: input.runContext,
    skillPaths: ["skills"],
    workspaceRoot: input.workspaceRoot
  });
  const workspaceAttachments = materializeWorkspaceAttachments(runWorkspace.runDir, input.workspaceAttachments ?? []);
  const evidenceRuntimeSource = createEvidenceFocusRuntimeSource(input.evidenceContextItems ?? []);

  const governedMessages = normalizeIngressMessages(input.messages);

  const tokenUsageCorrelation = createTokenUsageCorrelationStore();
  const registry = createDataFoundryToolRegistry({
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    dataGateway: input.dataGateway,
    emitter: input.emitter,
    runContext: input.runContext,
    tokenUsageCorrelation,
  });
  const dispatcher = new ToolObservationDispatcher(toolObservationBoundary.packager, {
    modelName: input.runContext.model_name,
    resourceId: input.runContext.user_id,
    runId: input.runContext.run_id,
    sessionId: input.runContext.session_id
  });
  const lats = new LatsRuntime({
    enabled: input.lats?.enabled ?? false,
    emitter: input.emitter,
    ...(input.lats?.llm ? { llm: input.lats.llm } : {}),
    ...(input.lats?.maxBranchingFactor !== undefined
      ? { maxBranchingFactor: input.lats.maxBranchingFactor }
      : {}),
    ...(input.lats?.ucbCoefficient !== undefined
      ? { ucbCoefficient: input.lats.ucbCoefficient }
      : {}),
  });
  const onGovernedResultWithSessionOutput: typeof registry.onGovernedResult = async (governed) => {
    await registry.onGovernedResult?.(governed);
    lats.recordStep({
      toolName: governed.toolName,
      ...(governed.toolInput !== undefined ? { toolInput: governed.toolInput } : {}),
      ...(governed.rawResult !== undefined ? { rawResult: governed.rawResult } : {}),
    });
    if (!input.sessionOutputService) {
      return;
    }
    await maybeIngestSessionFileToolResult({
      toolName: governed.toolName,
      ...(governed.toolCallId ? { toolCallId: governed.toolCallId } : {}),
      ...(governed.toolInput !== undefined ? { toolInput: governed.toolInput } : {}),
      ...(governed.rawResult !== undefined ? { rawResult: governed.rawResult } : {}),
      sessionDir: runWorkspace.sessionDir,
      sessionOutputService: input.sessionOutputService,
      runContext: input.runContext,
      emitter: input.emitter
    });
  };
  const onGovernedErrorWithLats: GovernedToolErrorHandler = async (governed) => {
    await lats.recordFailure({
      toolName: governed.toolName,
      error: governed.error,
      ...(governed.toolInput !== undefined ? { toolInput: governed.toolInput } : {}),
    });
    registry.onGovernanceError?.({
      error: governed.error,
      rawResult: governed.rawResult,
      toolName: governed.toolName,
    });
  };
  const contextEventSink = createAgUiContextEventSink(input.emitter);
  const mastraContextProcessors = createMastraContextProcessorBoundary({
    dispatcher,
    eventSink: contextEventSink,
    ...(input.contextPackageRecorder ? { contextPackageRecorder: input.contextPackageRecorder } : {}),
    ...(evidenceRuntimeSource ? { additionalRuntimeSources: [evidenceRuntimeSource] } : {}),
    ...(input.longTermMemory ? { longTermMemory: input.longTermMemory } : {}),
    ...(input.modelContextProfile ? { modelContextProfile: input.modelContextProfile } : {}),
    modelName: input.runContext.model_name,
    runScope: {
      runId: input.runContext.run_id,
      sessionId: input.runContext.session_id,
      userId: input.runContext.user_id
    },
    runState: contextRunState,
    ...(input.taskStateRuntime ? { taskStateRuntime: input.taskStateRuntime } : {})
  });
  const readOnlyWorkingMemoryProcessor = input.taskStateRuntime
    ? await createReadOnlyWorkingMemoryProcessor(input.taskStateRuntime)
    : undefined;
  const nonEmptyMessageContentCompat = new NonEmptyMessageContentCompatProcessor(
    shouldApplyNonEmptyMessageContentCompat(input.modelProvider),
  );
  const taskTools = input.taskStateRuntime
    ? {
        task_check: taskCheckTool,
        task_complete: taskCompleteTool,
        task_update: taskUpdateTool,
        task_write: taskWriteTool
      }
    : {};
  const collaborationTools = input.taskStateRuntime
    ? {
        ask_user: askUserTool,
        submit_plan: submitPlanTool
      }
    : {};
  const knowledgeTools = input.knowledgeService
    ? {
        retrieve_knowledge: createTool({
          id: "retrieve_knowledge",
          description: "Retrieve relevant chunks from a knowledge base enabled for this run.",
          inputSchema: z.object({
            collection_id: z.string().min(1),
            query: z.string().min(1),
            top_k: z.number().int().min(1).max(AGENT_RUNTIME_LIMITS.knowledgeMaxTopK).optional()
          }),
          execute: async (toolInput) => {
            if (!input.runContext.enabled_knowledge_ids?.includes(toolInput.collection_id)) {
              throw new Error(`KNOWLEDGE_BASE_NOT_ENABLED:${toolInput.collection_id}`);
            }
            return {
              collection_id: toolInput.collection_id,
              chunks: await input.knowledgeService?.retrieve({
                user_id: input.runContext.user_id,
                workspace_id: input.runContext.workspace_id ?? "default",
                collection_id: toolInput.collection_id,
                query: toolInput.query,
                ...(toolInput.top_k ? { top_k: toolInput.top_k } : {})
              }) ?? []
            };
          }
        })
      }
    : {};
  const fileAssetTools = input.fileAssetService
    ? createFileAssetTools({
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        fileAssetService: input.fileAssetService,
        runContext: input.runContext,
        sessionDir: runWorkspace.sessionDir,
        workspaceDir: runWorkspace.runDir
      })
    : {};
  // Workspace file tools (write_file / edit_file / execute_command, etc.) produce
  // session-scoped files. Eligible write/edit outputs are auto-ingested into Session
  // Outputs from governed tool results (and workspace.metadata when Mastra emits it);
  // drafts/scripts remain workspace-only.
  const workspaceTools = await createWorkspaceTools(runWorkspace.workspace, {
    requestContext: {},
    workspace: runWorkspace.workspace
  });
  const skillTools = runWorkspace.workspace.skills ? createSkillTools(runWorkspace.workspace.skills) : {};
  runWorkspace.workspace.setToolsConfig({ enabled: false });
  const dataToolsEnabled = (input.runContext.enabled_datasource_ids?.length ?? 0) > 0;
  const availableTools = {
    ...(dataToolsEnabled ? registry.mastraTools : {}),
    ...fileAssetTools,
    ...knowledgeTools,
    ...taskTools,
    ...collaborationTools,
    ...workspaceTools,
    ...skillTools,
    web_search: createWebSearchTool({ emitter: input.emitter }),
    ...(
      input.selectedSkills?.some((s) => s.name === "food-safety")
        ? {
            food_safety_intent_classify: createTool({
              id: "food_safety_intent_classify",
              description: "喜茶食安 L1 意图分类。Phase 1 正则快通道（~25条规则，毫秒级），Phase 2 边界规则。输入用户消息，输出：intent（food_safety/ordering/general_knowledge）、sub_intent（6类食安场景）、risk_level（high/medium/low）、confidence、method。",
              inputSchema: z.object({ message: z.string().describe("用户投诉/咨询原文") }),
              execute: async ({ message }) => {
                const result = classifyIntent(message);
                return {
                  intent: result.intent,
                  sub_intent: result.sub_intent ?? null,
                  risk_level: result.risk_level ?? null,
                  confidence: result.confidence,
                  method: result.method,
                  should_escalate: result.risk_level === "high" || (result.intent === "food_safety" && result.risk_level === "medium"),
                };
              },
            }),
            food_safety_generate_reply: createTool({
              id: "food_safety_generate_reply",
              description: "喜茶食安 L3 动态话术生成。输入意图分类结果，输出4步话术（empathy → collect → promise → compensate）。",
              inputSchema: z.object({
                intent: z.string(),
                sub_intent: z.string().optional(),
                risk_level: z.string().optional(),
                user_message: z.string().optional(),
                stage: z.string().optional(),
              }),
              execute: async ({ intent, sub_intent, risk_level, user_message, stage }) => {
                const category = sub_intent ?? "general";
                if (stage) {
                  return { stage, script: pickScript(category, stage) };
                }
                return {
                  intent,
                  sub_intent: sub_intent ?? null,
                  risk_level: risk_level ?? null,
                  four_step_script: {
                    empathy: pickScript(category, "empathy"),
                    collect: pickScript(category, "collect"),
                    promise: pickScript(category, "promise"),
                    compensate: pickScript(category, "compensate"),
                  },
                  recommended_compensation_type: getCompensationType(sub_intent ?? "", risk_level ?? "low"),
                  escalation_required: risk_level === "high",
                };
              },
            }),
            food_safety_audit_output: createTool({
              id: "food_safety_audit_output",
              description: "喜茶食安 L4 三层输出合规审计。Layer 1 违禁词黑名单，Layer 2 食安话术红线，Layer 3 幻觉检测。返回 pass/warn/block。",
              inputSchema: z.object({
                reply: z.string(),
                intent: z.string(),
                user_message: z.string().optional(),
              }),
              execute: async ({ reply, intent, user_message }) => {
                return auditOutput(reply, intent);
              },
            }),
            food_safety_create_work_order: createTool({
              id: "food_safety_create_work_order",
              description: "喜茶食安工单创建。输入投诉信息，生成工单号（FSW-YYYYMMDD-NNN），自动计算 SLA 时限。",
              inputSchema: z.object({
                conversation_id: z.string().optional(),
                user_id: z.number(),
                category: z.string(),
                sub_category: z.string().optional(),
                description: z.string(),
                risk_level: z.string().optional(),
                evidence_urls: z.array(z.string()).optional(),
                store_info: z.object({
                  store_id: z.string().optional(),
                  store_name: z.string().optional(),
                  address: z.string().optional(),
                }).optional(),
                order_info: z.object({
                  order_no: z.string().optional(),
                  items: z.array(z.string()).optional(),
                  amount: z.number().optional(),
                }).optional(),
              }),
              execute: async (input) => {
                const now = new Date();
                const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
                const seq = String(Math.floor(Math.random() * 999) + 1).padStart(3, "0");
                const case_no = `FSW-${dateStr}-${seq}`;
                const riskLevel = input.risk_level ?? "medium";
                const slaHours = getSlaHours(input.category, riskLevel);
                const slaDeadline = new Date(now.getTime() + slaHours * 60 * 60 * 1000);
                return {
                  id: randomUUID(),
                  case_no,
                  category: input.category,
                  sub_category: input.sub_category ?? null,
                  description: input.description,
                  risk_level: riskLevel,
                  status: "open",
                  stage: "reported",
                  sla_deadline: slaDeadline.toISOString(),
                  sla_status: "normal",
                  escalation_required: riskLevel === "high" || input.category === "body_discomfort",
                  store_info: input.store_info ?? null,
                  order_info: input.order_info ?? null,
                };
              },
            }),
            food_safety_query_work_orders: createTool({
              id: "food_safety_query_work_orders",
              description: "查询食安工单列表。按 user_id / status / category / risk_level 过滤。",
              inputSchema: z.object({
                user_id: z.number().optional(),
                status: z.string().optional(),
                category: z.string().optional(),
                risk_level: z.string().optional(),
                limit: z.number().optional(),
              }),
              execute: async ({ user_id, status, category, risk_level, limit = 20 }) => ({
                filters: { user_id, status, category, risk_level },
                query_template: "SELECT * FROM datafoundry.fsf_work_orders WHERE ... -- 通过 run_sql_readonly 工具执行",
                limit,
                count: 0,
                results: [],
              }),
            }),
            food_safety_get_compensation: createTool({
              id: "food_safety_get_compensation",
              description: "查询5级补偿矩阵。输入 category + risk_level，返回 min_amount、max_amount、recommended_type。",
              inputSchema: z.object({
                category: z.string(),
                sub_category: z.string().optional(),
                risk_level: z.string(),
              }),
              execute: async ({ category, sub_category, risk_level }) =>
                getCompensation(category, risk_level),
            }),
            food_safety_get_sla: createTool({
              id: "food_safety_get_sla",
              description: "查询 SLA 配置。输入 category + risk_level，返回 response_hours、resolution_hours、escalate_flag。",
              inputSchema: z.object({
                category: z.string(),
                risk_level: z.string(),
              }),
              execute: async ({ category, risk_level }) => getSla(category, risk_level),
            }),
          }
        : {}
    )
  };
  // Platform tools for enabled KB / datasources must survive skill allowed-tools
  // unions: maxSkills truncation often leaves import-oriented skills that never
  // declare retrieve_knowledge or SQL tools.
  const alwaysAllowTools = new Set<string>();
  alwaysAllowTools.add("web_search");
  if ((input.runContext.enabled_knowledge_ids?.length ?? 0) > 0) {
    alwaysAllowTools.add("retrieve_knowledge");
  }
  if (dataToolsEnabled) {
    for (const name of DATA_AGENT_TOOL_NAMES) {
      alwaysAllowTools.add(name);
    }
  }
  const selectedPolicyTools = selectToolsByPolicy(
    availableTools,
    input.skillSelection,
    alwaysAllowTools
  );
  const selectedTools = {
    ...selectedPolicyTools,
    ...(input.mcpTools ?? {})
  };
  const selectedDatasourceId = input.runContext.selected_datasource_id;
  const deferredProtocolEvents: ProtocolEvent[] = [];
  let protocolEventsReady = false;
  const protocol = await createRunProtocolBoundary({
    runId: input.runContext.run_id,
    userInput: input.runContext.user_input,
    authorizedProtocolIds: ["general-task", "data-analysis"],
    initialContextPackageRef: {
      packageId: contextRunState.package.packageId,
      revision: contextRunState.package.revision
    },
    tools: selectedTools,
    ...(selectedDatasourceId
      ? {
          semanticProvider: createDefaultSemanticProvider({ tools: selectedTools }),
          semanticRequest: {
            userId: input.runContext.user_id,
            workspaceId: input.runContext.workspace_id ?? "default",
            datasourceId: selectedDatasourceId,
            datasourceRevision: String(
              input.resourceRevisions?.[`datasource:${selectedDatasourceId}`] ?? "unknown"
            )
          }
        }
      : {}),
    ...(input.explicitProtocol ? { explicitProtocol: input.explicitProtocol } : {}),
    classifier: input.protocolClassifier ?? createModelProtocolClassifier(input.modelProvider),
    requirementExtractor: input.analysisRequirementExtractor
      ?? createModelAnalysisRequirementExtractor(input.modelProvider),
    analysisContractGrounder: input.analysisContractGrounder
      ?? createModelAnalysisContractGrounder(input.modelProvider),
    ...(input.protocolStateStore ? { stateStore: input.protocolStateStore } : {}),
    projectContext: ({ actionName, rawResult }) => {
      if (isProtocolRuntimeAction(actionName)) {
        const currentPackage = contextRunState.package;
        return {
          contextPackageRef: {
            packageId: currentPackage.packageId,
            revision: currentPackage.revision
          },
          contextPackage: currentPackage,
          observation: rawResult
        };
      }
      const contextPackage = dispatcher.dispatch(actionName, rawResult);
      const currentPackage = contextRunState.package;
      input.contextPackageRecorder?.record({ contextPackage: currentPackage });
      return {
        contextPackageRef: {
          packageId: currentPackage.packageId,
          revision: currentPackage.revision
        },
        contextPackage,
        observation: toolObservationModelFromPackage(contextPackage)
      };
    },
    runtimeOptions: {
      ...(input.contextPackageExists ? { contextPackageExists: input.contextPackageExists } : {}),
      onEvent: (event) => {
        if (!protocolEventsReady) {
          deferredProtocolEvents.push(event);
          return false;
        }
        input.onProtocolEvent?.(event);
        input.emitter.emit(createCustomEvent(event.type, event));
        return true;
      }
    }
  });
  const governedToolFactory = new GovernedToolFactory(
    dispatcher,
    onGovernedResultWithSessionOutput,
    onGovernedErrorWithLats,
    {
      actionRouter: protocol.actionRouter,
      emitter: input.emitter,
      externallyResolvedToolNames: new Set(HITL_TOOL_NAMES),
      runId: input.runContext.run_id,
      getSegmentId: () => protocol.segmentId
    }
  );
  const protocolState = protocol.protocolRuntime.getState(input.runContext.run_id, protocol.segmentId);
  const analysisRequirements = protocolState.protocolId === "data-analysis"
    ? ((protocolState.domain as DataAnalysisState).requirements ?? []).filter((requirement) =>
        requirement.source === "user")
    : [];
  const requirementsCommitTools = analysisRequirements.length > 0
    ? {
        analysis_requirements_commit: createTool({
          id: "analysis_requirements_commit",
          description: "Commit final claims for analysis requirements using artifact evidence from successful SQL results.",
          inputSchema: z.object({
            claims: z.array(z.object({
              requirement_id: z.string().min(1),
              claim: z.string().min(1),
              values: z.array(z.object({
                name: z.string().min(1),
                value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
                unit: z.string().optional()
              })).max(AGENT_RUNTIME_LIMITS.requirementCommitMaxOutputFields).optional(),
              evidence_refs: z.array(z.string().min(1)).optional(),
              evidence_requirement_ids: z.array(z.string().min(1)).optional()
            })).min(1).max(AGENT_RUNTIME_LIMITS.requirementCommitMaxClaims)
          }),
          execute: async (toolInput, options) => {
            const toolCallId = protocolToolCallId(options);
            try {
              const result = await protocol.actionRouter.execute({
                runId: input.runContext.run_id,
                segmentId: protocol.segmentId,
                actionId: toolCallId ?? `analysis-requirements-commit:${Date.now()}`,
                actionName: "analysis.requirements.commit",
                input: toolInput,
                idempotencyKey: toolCallId ?? JSON.stringify(toolInput)
              });
              return result.observation;
            } catch (error) {
              return createToolErrorObservation(error, { toolName: "analysis_requirements_commit" });
            }
          }
        })
      }
    : {};
  const tools = {
    ...governedToolFactory.governTools(selectedTools),
    ...requirementsCommitTools,
    protocol_handoff: createTool({
      id: "protocol_handoff",
      description: "Propose switching this run to another authorized protocol when the current protocol is unsuitable.",
      inputSchema: z.object({
        targetProtocolId: z.string().min(1),
        targetProtocolVersion: z.string().min(1),
        reasonCodes: z.array(z.string().min(1)).min(1),
        unresolvedGoals: z.array(z.string())
      }),
      execute: async (toolInput, options) => {
        const toolCallId = protocolToolCallId(options);
        try {
          const result = await protocol.actionRouter.execute({
            runId: input.runContext.run_id,
            segmentId: protocol.segmentId,
            actionId: toolCallId ?? `protocol-handoff:${Date.now()}`,
            actionName: "protocol.handoff.propose",
            input: toolInput,
            idempotencyKey: toolCallId ?? JSON.stringify(toolInput)
          });
          return result.observation;
        } catch (error) {
          return createToolErrorObservation(error, { toolName: "protocol_handoff" });
        }
      }
    })
  };
  const agent = new Agent({
    id: "data-foundry",
    name: "DataFoundry",
    instructions: buildAgentInstructions({
      runContext: input.runContext,
      commandExecutionEnabled: runWorkspace.commandExecutionEnabled,
      collaborationToolsEnabled: Boolean(input.taskStateRuntime),
      pythonRuntimeAvailable: Boolean(runWorkspace.pythonRuntime),
      selectedSkills: input.selectedSkills ?? [],
      taskToolsEnabled: Boolean(input.taskStateRuntime),
      toolNames: [...Object.keys(selectedTools), ...Object.keys(requirementsCommitTools), "protocol_handoff"],
      mcpToolNames: input.mcpToolNames ?? [],
      protocolId: protocolState.protocolId,
      protocolVersion: protocolState.protocolVersion,
      protocolPhase: protocolState.phase,
      phaseGuidance: protocol.route.definition.phases[protocolState.phase]?.guidance,
      analysisRequirements,
      workspaceAttachments
    }),
    model: input.modelProvider.model as never,
    tools,
    ...(input.taskStateRuntime ? { memory: input.taskStateRuntime.memory } : {}),
    ...(input.goal ? { goal: { judge: input.modelProvider.model as never, maxRuns: input.goal.maxRuns ?? 10 } } : {}),
    // Workspace remains attached for execution context, while auto-injection is disabled above.
    // Explicitly created tools are wrapped by the same governed execution boundary as every other tool.
    workspace: runWorkspace.workspace,
    inputProcessors: [
      ...(readOnlyWorkingMemoryProcessor ? [readOnlyWorkingMemoryProcessor] : []),
      ...mastraContextProcessors.inputProcessors,
      nonEmptyMessageContentCompat
    ],
    outputProcessors: mastraContextProcessors.outputProcessors,
    defaultOptions: {
      maxSteps: AGENT_MAX_STEPS,
      ...(input.modelSettings ? { modelSettings: input.modelSettings } : {}),
      providerOptions: {
        openai: {
          systemMessageMode: "system"
        }
      }
    }
  });
  const agentForAgUi = wrapAgentForAgUi(
    agent,
    createMastraStreamNormalizerHooks(input.emitter, input.sessionOutputService
      ? {
          onWorkspaceMetadata: (metadata) =>
            maybeIngestSessionFileOutput({
              metadata,
              emitter: input.emitter,
              runContext: input.runContext,
              sessionDir: runWorkspace.sessionDir,
              sessionOutputService: input.sessionOutputService as SessionOutputService
            })
        }
      : {}),
    { ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}) },
  );
  const mastra = input.taskStateRuntime
    ? new Mastra({
        agents: { dataFoundry: agentForAgUi },
        storage: input.taskStateRuntime.storage
      })
    : undefined;
  let goalRuntime: GoalRuntimeAdapter | undefined;
  if (input.goal && mastra) {
    goalRuntime = new GoalRuntimeAdapter(agentForAgUi, input.runContext.user_id, input.runContext.session_id);
    const snapshot = await goalRuntime.setObjective(input.goal);
    // R-016: stable goal.updated contract. `objective` is the spec key; `goal` is kept
    // as a backward-compatible alias. Mastra's "active"/"paused"/"done" maps to the
    // spec's "running"/"paused"/"done".
    const goalStatus = snapshot?.status === "active" ? "running" : snapshot?.status ?? "running";
    input.emitter.emit(createCustomEvent("goal.updated", {
      objective: snapshot?.objective ?? input.goal.objective,
      goal: snapshot?.objective ?? input.goal.objective,
      status: goalStatus,
      source: "mastra-native-goal"
    }));
  }

  return {
    agent: agentForAgUi,
    commandExecutionEnabled: runWorkspace.commandExecutionEnabled,
    destroyWorkspace: async () => {
      try {
        await protocol.dispose();
      } finally {
        await runWorkspace.destroy();
      }
    },
    governedMessages,
    ...(goalRuntime ? { goalRuntime } : {}),
    isolation: runWorkspace.isolation,
    protocol,
    flushProtocolEvents: () => {
      protocolEventsReady = true;
      while (deferredProtocolEvents.length > 0) {
        const event = deferredProtocolEvents.shift();
        if (!event) {
          continue;
        }
        input.onProtocolEvent?.(event);
        input.emitter.emit(createCustomEvent(event.type, event));
        protocol.acknowledgeEvent(event);
      }
    },
    workspaceDir: runWorkspace.runDir,
    sessionDir: runWorkspace.sessionDir
  };
};

const createEvidenceFocusRuntimeSource = (items: AgentContextItem[]): RuntimeContextSource | undefined => {
  if (items.length === 0) {
    return undefined;
  }
  return {
    sourceType: "evidence-focus",
    collect: () => items
  };
};

export const createDataFoundryRunContext = (input: AgentRunContextInput): AgentRunContext => {
  if ((input.enabled_datasource_ids?.length ?? 0) === 0) {
    return input;
  }
  if (!input.selected_datasource_id) {
    throw new Error("DATASOURCE_REQUIRED");
  }
  if (!(input.enabled_datasource_ids ?? []).includes(input.selected_datasource_id)) {
    throw new Error("ACTIVE_DATASOURCE_NOT_ENABLED");
  }

  return input;
};

export const createModelProviderFromEnv = (env: Record<string, string | undefined>): ModelProvider =>
  createModelProvider(env);

/** Create a model provider from a resolved persisted profile. */
export const createModelProviderFromProfile = (config: ChatProviderConfig): ModelProvider =>
  createModelProviderFromConfig(config);

/** Execute a minimal real model call through the same Mastra model boundary used by production runs. */
export const probeModelProvider = async (
  provider: Exclude<ModelProvider, { kind: "mock" }>,
  timeoutMs = 30000
): Promise<{ model: string; text: string }> => {
  const agent = new Agent({
    id: "model-profile-probe",
    name: "Model Profile Probe",
    instructions: "Reply with OK only.",
    model: provider.model as never
  });
  const output = await agent.generate("Reply with OK only.", {
    abortSignal: AbortSignal.timeout(timeoutMs),
    maxSteps: 1,
    modelSettings: { maxOutputTokens: 16, temperature: 0 }
  });
  return { model: provider.model_name, text: output.text.trim() };
};


const selectToolsByPolicy = <TTool>(
  availableTools: Record<string, TTool>,
  skillSelection: SkillSelectionResult | undefined,
  alwaysAllowTools: ReadonlySet<string> = new Set()
): Record<string, TTool> => {
  const policy = skillSelection?.effectiveToolPolicy;
  const deniedTools = new Set(policy?.deniedTools ?? []);
  const allowedTools = policy?.allowedTools ? new Set(policy.allowedTools) : undefined;
  const skillMetaTools = new Set(["skill", "skill_search", "skill_read"]);
  return Object.fromEntries(Object.entries(availableTools).filter(([name]) =>
    !deniedTools.has(name)
    && (
      alwaysAllowTools.has(name)
      || !allowedTools
      || allowedTools.has(name)
      || skillMetaTools.has(name)
    )
  ));
};

const createReadOnlyWorkingMemoryProcessor = async (
  runtime: TaskStateRuntime
): Promise<WorkingMemory | undefined> => {
  const memoryStore = await runtime.storage.getStore("memory");
  if (!memoryStore) {
    return undefined;
  }
  return new WorkingMemory({
    storage: memoryStore,
    readOnly: true,
    scope: CONVERSATION_WORKING_MEMORY_CONFIG.workingMemory.scope,
    template: {
      format: "markdown",
      content: CONVERSATION_WORKING_MEMORY_CONFIG.workingMemory.template
    },
    templateProvider: runtime.memory
  });
};

const requireFileAssetService = (service: FileAssetService | undefined): FileAssetService => {
  if (!service) {
    throw new Error("SKILL_FILE_ASSET_SERVICE_REQUIRED");
  }
  return service;
};

const materializeWorkspaceAttachments = (
  runDir: string,
  attachments: WorkspaceAttachment[]
): MaterializedWorkspaceAttachment[] => {
  const inputDir = join(runDir, "input");
  mkdirSync(inputDir, { recursive: true });
  const usedNames = new Set<string>();
  return attachments.map((attachment) => {
    const filename = uniqueWorkspaceInputFilename(attachment.filename, usedNames);
    const targetPath = resolve(inputDir, filename);
    if (!targetPath.startsWith(`${inputDir}${sep}`)) {
      throw new Error("WORKSPACE_ATTACHMENT_PATH_ESCAPE");
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    try {
      linkSync(attachment.source_path, targetPath);
    } catch {
      copyFileSync(attachment.source_path, targetPath);
    }
    return {
      file_id: attachment.file_id,
      filename,
      ...(attachment.mime_type ? { mime_type: attachment.mime_type } : {}),
      path: `input/${filename}`,
      size_bytes: attachment.size_bytes
    };
  });
};

const createFileAssetTools = (input: {
  abortSignal?: AbortSignal | undefined;
  fileAssetService: FileAssetService;
  runContext: AgentRunContext;
  /** Per-session directory — the agent's writable basePath (where new files live). */
  sessionDir: string;
  /** Persistent workspace root — cross-session asset area (read-only to the agent). */
  workspaceDir: string;
}): Record<string, ReturnType<typeof createTool>> => ({
  promote_workspace_file: createTool({
    id: "promote_workspace_file",
    description: "Promote a session file into the cross-session workspace root so other sessions can read it. "
      + "The file currently lives in this session's scope (only this session sees it); after promote it is "
      + "copied/hardlinked into the persistent workspace root and registered as a cross-session asset. "
      + "Use this only to share a file across sessions, not to reuse within the current session.",
    inputSchema: z.object({
      path: z.string().min(1),
      filename: z.string().min(1).optional(),
      description: z.string().optional()
    }),
    execute: async (toolInput) => {
      throwIfAborted(input.abortSignal);
      // Source is a session-scoped file; target is the persistent workspace root.
      const sourcePath = resolveWorkspaceRelativePath(input.sessionDir, toolInput.path);
      const filename = toolInput.filename ?? basename(sourcePath);
      const targetPath = resolveWorkspaceRelativePath(input.workspaceDir, filename);
      const sourceRef = input.fileAssetService.createRefFromPath({
        user_id: input.runContext.user_id,
        workspace_id: input.runContext.workspace_id ?? "default",
        session_id: input.runContext.session_id,
        run_id: input.runContext.run_id,
        filename,
        declared_mime_type: mimeTypeForFilename(filename),
        source: "workspace",
        path: sourcePath,
        ...(toolInput.description ? { metadata: { description: toolInput.description } } : {})
      }).ref;
      // Materialize into the workspace root (hardlink, fall back to copy).
      input.fileAssetService.materializeRefToPath({
        ref: sourceRef,
        targetPath,
        linkStrategy: "hardlink"
      });
      // Register as a cross-session workspace ref (session_id IS NULL).
      const resolved = input.fileAssetService.promoteFileToWorkspace({
        user_id: input.runContext.user_id,
        workspace_id: input.runContext.workspace_id ?? "default",
        file_asset_ref_id: sourceRef.id,
        filename,
        declared_mime_type: mimeTypeForFilename(filename)
      });
      return {
        ...fileAssetRefDto(resolved),
        download_url: `/api/v1/files/${resolved.ref.id}/download`
      };
    }
  }),
  list_workspace_files: createTool({
    id: "list_workspace_files",
    description: "List files in the cross-session workspace root (read-only). These are assets shared across "
      + "all of the user's sessions — uploads and promoted files. To read one, use read_workspace_file with the "
      + "returned path. New files you write go to the session scope (list_files), not here.",
    inputSchema: z.object({
      path: z.string().optional()
    }),
    execute: async (toolInput) => {
      throwIfAborted(input.abortSignal);
      const listPath = toolInput.path
        ? resolveWorkspaceRelativePath(input.workspaceDir, toolInput.path)
        : input.workspaceDir;
      const entries = listWorkspaceFiles(listPath);
      return { path: toolInput.path ?? ".", files: entries };
    }
  }),
  read_workspace_file: createTool({
    id: "read_workspace_file",
    description: "Read a file from the cross-session workspace root (read-only). Use the path from "
      + "list_workspace_files. These files are shared across sessions; do not attempt to write or edit them "
      + "(use write_file for new session-scoped files, promote_workspace_file to add one here).",
    inputSchema: z.object({
      path: z.string().min(1)
    }),
    execute: async (toolInput) => {
      throwIfAborted(input.abortSignal);
      const filePath = resolveWorkspaceRelativePath(input.workspaceDir, toolInput.path);
      const body = readFileSync(filePath);
      return {
        path: toolInput.path,
        content: body.toString("utf8"),
        size_bytes: body.length,
        mime_type: mimeTypeForFilename(toolInput.path)
      };
    }
  })
});

const resolveWorkspaceRelativePath = (workspaceDir: string, relativePath: string): string => {
  if (relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error("WORKSPACE_PATH_INVALID");
  }
  const path = resolve(workspaceDir, relativePath);
  if (path !== workspaceDir && !path.startsWith(`${workspaceDir}${sep}`)) {
    throw new Error("WORKSPACE_PATH_ESCAPE");
  }
  return path;
};

const throwIfAborted = (signal?: AbortSignal | undefined): void => {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("RUN_CANCELLED");
  }
};

/** List files under a directory (one level) relative to the workspace root, read-only. */
type WorkspaceFileEntry = {
  is_directory: boolean;
  name: string;
  path: string;
  size_bytes: number;
};

const listWorkspaceFiles = (dirPath: string): WorkspaceFileEntry[] => {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.name !== ".DS_Store")
    .map((entry) => {
      const full = join(dirPath, entry.name);
      let size = 0;
      try {
        size = statSync(full).size;
      } catch {
        // unreadable entry — keep size 0
      }
      return {
        path: entry.name,
        name: entry.name,
        size_bytes: size,
        is_directory: entry.isDirectory()
      };
    });
};

const uniqueWorkspaceInputFilename = (filename: string, usedNames: Set<string>): string => {
  const safe = basename(filename).replace(/[^a-zA-Z0-9._ -]+/gu, "-").trim() || "file";
  if (!usedNames.has(safe)) {
    usedNames.add(safe);
    return safe;
  }
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const extension = dot > 0 ? safe.slice(dot) : "";
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem}-${index}${extension}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }
  throw new Error("WORKSPACE_ATTACHMENT_NAME_EXHAUSTED");
};

export const normalizeIngressMessages = (messages: Message[]): Message[] =>
  messages
    .filter((message) => message.role !== "activity" && message.role !== "reasoning")
    .map(normalizeWorkspaceUploadMessage);

const normalizeWorkspaceUploadMessage = (message: Message): Message => {
  if (message.role !== "user" || !Array.isArray(message.content)) {
    return message;
  }
  const existingText = message.content
    .filter((part): part is { text: string; type: "text" } =>
      isRecord(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  const content: unknown[] = [];
  let changed = false;

  for (const part of message.content) {
    content.push(part);
    const uploadText = workspaceUploadPartText(part, existingText);
    if (uploadText) {
      content.push({ type: "text", text: uploadText });
      changed = true;
    }
  }

  return changed ? { ...message, content } as Message : message;
};

const workspaceUploadPartText = (part: unknown, existingText: string): string | undefined => {
  if (!isRecord(part)) {
    return undefined;
  }
  const source = isRecord(part.source) ? part.source : undefined;
  const rawPath = source?.type === "url" && typeof source.value === "string" ? source.value.trim() : undefined;
  if (
    !rawPath
    || !isWorkspaceUploadPath(rawPath)
    || (existingText.includes("Uploaded workspace file:") && existingText.includes(rawPath))
  ) {
    return undefined;
  }
  const metadata = isRecord(part.metadata) ? part.metadata : {};
  const filename = typeof metadata.filename === "string" && metadata.filename.trim()
    ? metadata.filename.trim()
    : basename(rawPath);
  const mimeType = typeof source?.mimeType === "string" && source.mimeType.trim()
    ? source.mimeType.trim()
    : "unknown";
  return [
    "Uploaded workspace file:",
    `- path: ${rawPath}`,
    `- filename: ${filename}`,
    `- mime_type: ${mimeType}`,
    "Use the workspace read_file tool with this path when you need the file contents."
  ].join("\n");
};

const isWorkspaceUploadPath = (value: string): boolean =>
  value.startsWith("uploads/")
  && !value.startsWith("/")
  && !value.includes("\0")
  && value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isProtocolRuntimeAction = (actionName: string): boolean =>
  actionName === "general.answer.commit"
  || actionName === "protocol.handoff.propose"
  || actionName.startsWith("analysis.")
  || actionName.startsWith("data.query.")
  || actionName === "semantic.context.resolve";

const protocolToolCallId = (options: unknown): string | undefined => {
  if (!isRecord(options) || !isRecord(options.agent)) {
    return undefined;
  }
  return typeof options.agent.toolCallId === "string" && options.agent.toolCallId.length > 0
    ? options.agent.toolCallId
    : undefined;
};

export { validateProtocolDefinition } from "./protocol/definition-validator.js";
export { ActionRouter } from "./capabilities/action-router.js";
export { CapabilityRegistry } from "./capabilities/capability-registry.js";
export { createToolCapabilityPlugin } from "./capabilities/tool-capability-plugin.js";
export type * from "./capabilities/types.js";
export { ToolExecutionError, toToolExecutionError, toolErrorObservation } from "./errors/tool-execution-error.js";
export type * from "./errors/tool-execution-error.js";
export { evaluateProtocolHandoff } from "./protocol/protocol-handoff.js";
export {
  createCoreAnalysisRequirements,
  createUserAnalysisRequirements
} from "./protocol/analysis-requirements.js";
export type * from "./protocol/analysis-requirements.js";
export {
  createAnalysisRequirementExtractionPrompt,
  createModelAnalysisRequirementExtractor,
  parseAnalysisRequirementExtractionText
} from "./protocol/model-analysis-requirement-extractor.js";
export type { AnalysisRequirementExtractor } from "./protocol/model-analysis-requirement-extractor.js";
export {
  createAnalysisContractGroundingPrompt,
  createModelAnalysisContractGrounder,
  parseAnalysisContractGroundingText
} from "./protocol/model-analysis-contract-grounder.js";
export type * from "./protocol/model-analysis-contract-grounder.js";
export { ProtocolHandoffCoordinator } from "./protocol/protocol-handoff-coordinator.js";
export { InMemoryProtocolStateStore } from "./protocol/in-memory-protocol-state-store.js";
export { ProtocolRegistry } from "./protocol/protocol-registry.js";
export { ProtocolRouter } from "./protocol/protocol-router.js";
export { ProtocolRuntime } from "./protocol/protocol-runtime.js";
export { createModelProtocolClassifier } from "./protocol/model-protocol-classifier.js";
export { createRunProtocolBoundary } from "./protocol/run-protocol-boundary.js";
export type * from "./protocol/run-protocol-boundary.js";
export { createGeneralTaskProtocol } from "./protocol/protocols/general-task.js";
export { createDataAnalysisProtocol } from "./protocol/protocols/data-analysis.js";
export type * from "./protocol/protocol-handoff.js";
export type * from "./protocol/protocol-handoff-coordinator.js";
export type * from "./protocol/protocol-router.js";
export type * from "./protocol/protocol-runtime.js";
export type * from "./protocol/types.js";
export { DataLinkSemanticProvider } from "./semantic/datalink-semantic-provider.js";
export { LocalSemanticProvider } from "./semantic/local-semantic-provider.js";
export { SemanticProviderChain } from "./semantic/semantic-provider-chain.js";
export { createDefaultSemanticProvider } from "./semantic/default-semantic-provider.js";
export type * from "./semantic/types.js";

// ─────────────────────────────────────────────────────────────
// 喜茶食安 Skill — 内联辅助函数
// ─────────────────────────────────────────────────────────────

const FOOD_SAFETY_PATTERNS: Array<{ pattern: RegExp; sub_intent: string; risk: string }> = [
  { pattern: /塑料[异机物块屑片]|吃到了塑料|塑料异物|塑料渣/i, sub_intent: "foreign_object_external", risk: "high" },
  { pattern: /虫蛹|发现有虫|虫子在|有虫|虫子|蟑螂|苍蝇|飞虫/i, sub_intent: "foreign_object_external", risk: "high" },
  { pattern: /头发[丝毛屑]|发丝/i, sub_intent: "foreign_object_external", risk: "medium" },
  { pattern: /金属[屑丝片块]|铁丝|钢丝|金属异物/i, sub_intent: "foreign_object_external", risk: "high" },
  { pattern: /玻璃[屑片碎]|玻璃渣/i, sub_intent: "foreign_object_external", risk: "high" },
  { pattern: /棉絮|线头|纸片|纸屑/i, sub_intent: "foreign_object_external", risk: "medium" },
  { pattern: /拉肚子|腹泻|拉稀/i, sub_intent: "body_discomfort", risk: "high" },
  { pattern: /呕吐|想吐|恶心/i, sub_intent: "body_discomfort", risk: "high" },
  { pattern: /过敏|起疹|发痒|红肿/i, sub_intent: "body_discomfort", risk: "high" },
  { pattern: /发烧|发热|食物中毒/i, sub_intent: "body_discomfort", risk: "high" },
  { pattern: /肚子疼|胃疼|不舒服/i, sub_intent: "body_discomfort", risk: "medium" },
  { pattern: /变质|发霉|霉变/i, sub_intent: "spoilage", risk: "high" },
  { pattern: /过期|过保质期/i, sub_intent: "spoilage", risk: "high" },
  { pattern: /酸味|酸了|有酸味/i, sub_intent: "spoilage", risk: "medium" },
  { pattern: /异味|有怪味|味道不对/i, sub_intent: "spoilage", risk: "medium" },
  { pattern: /消毒水|消毒水味|化学味|药剂味/i, sub_intent: "spoilage", risk: "high" },
  { pattern: /发苦|苦味重/i, sub_intent: "taste_issue", risk: "low" },
  { pattern: /不新鲜|原料不新鲜/i, sub_intent: "spoilage", risk: "medium" },
  { pattern: /foreign object|foreign body|metal|fiber|insect/i, sub_intent: "foreign_object_external", risk: "high" },
  { pattern: /allergic|allergy|rash|hives/i, sub_intent: "body_discomfort", risk: "high" },
  { pattern: /mold|mould|expired|stale/i, sub_intent: "spoilage", risk: "high" },
  { pattern: /sick|vomit|nausea|diarrhea/i, sub_intent: "body_discomfort", risk: "high" },
];

const ORDERING_PATTERNS = /点单|下单|门店|营业时间|地址|推荐|菜单|新品|热量|糖|配料|过敏原|小程序|外卖|配送|自取|排队/i;
const COMPLAINT_PATTERNS = /退款|退单|取消|投诉|差评|举报|12315|退款|赔偿|赔钱|客服差|服务差/i;

function classifyIntent(message: string) {
  const text = message.trim();
  for (const { pattern, sub_intent, risk } of FOOD_SAFETY_PATTERNS) {
    if (pattern.test(text)) {
      return { intent: "food_safety", sub_intent, risk_level: risk, confidence: 0.95, method: "regex_fast_path" };
    }
  }
  if (ORDERING_PATTERNS.test(text) && !COMPLAINT_PATTERNS.test(text)) {
    return { intent: "ordering", confidence: 0.85, method: "regex" };
  }
  if (COMPLAINT_PATTERNS.test(text)) {
    const tasteKeywords = /太甜|太淡|不够甜|不够浓|太稀|太稠|味道不好|口感差/i;
    if (tasteKeywords.test(text)) {
      return { intent: "food_safety", sub_intent: "taste_issue", risk_level: "low", confidence: 0.7, method: "regex_boundary" };
    }
    return { intent: "general_knowledge", confidence: 0.8, method: "regex" };
  }
  const abnormalTaste = /消毒水味|消毒味|化学味|酸味|异味|苦味|涩味|怪味|味道不对/i;
  if (abnormalTaste.test(text)) {
    return { intent: "food_safety", sub_intent: "spoilage", risk_level: "medium", confidence: 0.8, method: "boundary_rule" };
  }
  const environmentIssue = /门店脏|环境差|有苍蝇|有蚊子|桌子脏|不干净/i;
  if (environmentIssue.test(text)) {
    return { intent: "general_knowledge", confidence: 0.75, method: "boundary_rule" };
  }
  return { intent: "general_knowledge", confidence: 0.5, method: "default" };
}

const SCRIPTS: Record<string, Record<string, string[]>> = {
  foreign_object_external: {
    empathy: ["非常抱歉给您带来了不好的体验，您的反馈我们非常重视。", "听到您在饮品中发现异物，我们深感歉意。"],
    collect: ["能否提供一下订单号和购买门店信息？以便我们快速定位处理。", "请问能告知购买时间和门店名称吗？"],
    promise: ["我已经将您的问题详细记录，会立即反馈给门店进行核查。", "我们会安排专人跟进，确保问题得到妥善处理。"],
    compensate: ["根据您反馈的情况，我会帮您申请相应的补偿，感谢您的理解。", "针对本次体验，我们准备了补偿方案，稍后与您联系。"],
  },
  body_discomfort: {
    empathy: ["听到您身体不适，我们深感抱歉，这是我们最不愿意看到的情况。", "非常抱歉您遇到了这样的问题。"],
    collect: ["请问您方便提供订单号、门店名称和具体的不适情况吗？我们需要详细记录。", "您的健康和安全是最重要的，请告知更多细节以便我们跟进。"],
    promise: ["您的反馈已升级处理，我们会立即联系门店并安排专人跟进。", "我们已经启动紧急处理流程，感谢您的耐心。"],
    compensate: ["针对您目前的情况，我们会提供必要的补偿，并持续跟进您的状况。"],
  },
  spoilage: {
    empathy: ["非常抱歉出现这种情况，我们会认真对待每一起食安反馈。"],
    collect: ["请问您是在哪家门店购买的？大概是什么时间？如果有图片凭证会更好。"],
    promise: ["我们会立即启动调查程序，门店会在24小时内给您回复。"],
    compensate: ["根据您的情况，我们会提供相应的补偿方案。"],
  },
  taste_issue: {
    empathy: ["非常抱歉您对口感和味道不满意，我们会认真对待。"],
    collect: ["请问能告知是哪款饮品吗？我们会反馈给门店改进。"],
    promise: ["您的反馈已记录，我们会持续提升品质。"],
    compensate: ["感谢您的反馈，我们准备了补偿方案以表歉意。"],
  },
  general: {
    empathy: ["非常抱歉给您带来不好的体验，我们会认真对待。"],
    collect: ["请问方便提供更多细节吗？这样我们可以更好地帮您处理。"],
    promise: ["我会帮您记录并反馈给相关部门。"],
    compensate: ["感谢您的反馈，我们会不断改进。"],
  },
};

function pickScript(category: string, stage: string): string {
  const scripts = SCRIPTS[category]?.[stage] ?? SCRIPTS["general"]?.[stage] ?? [];
  if (scripts.length === 0) return "";
  return scripts[Math.floor(Math.random() * scripts.length)] ?? "";
}

const BLOCKLIST = ["去死", "杀人", "毒品", "奈雪", "茶颜悦色", "其他奶茶品牌"];
const WARN_REPLACEMENTS: Record<string, string> = {
  "退款": "申请退款", "退全款": "根据评估结果退款", "全额退款": "根据评估结果退款",
  "保证": "我们会尽力", "100%满意": "最大程度让您满意", "一定退": "会尽量帮您申请",
  "赔偿": "补偿", "赔付": "补偿",
};
const FOOD_SAFETY_BLOCK_PATTERNS: RegExp[] = [
  /确认是(我方|喜茶|我们的)(问题|责任|失误)/,
  /退款[0-9]+元/, /[0-9]+元(一定|保证|绝对)/, /保证(退款|退|赔|补偿|负责)/,
  /100%/, /这是正常的/, /不影响(健康|安全|食用)/,
  /以后(一定|保证).*不再/,
];
const HALLUCINATION_PATTERNS: RegExp[] = [
  /根据我们的调查/, /门店反馈/, /已经核实/,
  /多菌灵超标|农药超标|添加剂超标/, /大肠杆菌超标/, /门店.*已被.*处罚/,
];

function auditOutput(reply: string, intent: string) {
  if (!reply?.trim()) {
    return { status: "block", audited_text: "非常抱歉，当前处理量较大，请稍后再试。", violations: ["空回复"], warnings: [], meta: { originalNull: true } };
  }
  let text = reply.trim();
  const violations: string[] = [];
  const warnings: string[] = [];
  const meta: Record<string, unknown> = {};
  for (const word of BLOCKLIST) {
    if (text.includes(word)) violations.push(`违禁词: ${word}`);
  }
  const isFoodSafety = intent === "food_safety" || intent === "ordering";
  if (isFoodSafety) {
    for (const pattern of FOOD_SAFETY_BLOCK_PATTERNS) {
      const match = text.match(pattern);
      if (match) violations.push(`食安红线: ${match[0]}`);
    }
  }
  for (const pattern of HALLUCINATION_PATTERNS) {
    const match = text.match(pattern);
    if (match) warnings.push(`疑似幻觉: ${match[0]}`);
  }
  let hasWarnWord = false;
  for (const [word, replacement] of Object.entries(WARN_REPLACEMENTS)) {
    if (text.includes(word)) {
      hasWarnWord = true;
      text = text.replace(new RegExp(word, "g"), replacement);
      warnings.push(`措辞调整: ${word} → ${replacement}`);
    }
  }
  if (hasWarnWord) meta["warn_word_replacements"] = true;
  const status = violations.length > 0 ? "block" : warnings.length > 0 ? "warn" : "pass";
  return { status, audited_text: text, violations, warnings, meta };
}

const COMPENSATION_MATRIX: Record<string, { min: number; max: number; type: string; desc: string }> = {
  "foreign_object_external_high":   { min: 50,  max: 500, type: "voucher",  desc: "外源异物-高" },
  "foreign_object_external_medium": { min: 20,  max: 200, type: "voucher",  desc: "外源异物-中" },
  "foreign_object_external_low":    { min: 10,  max: 100, type: "voucher",  desc: "外源异物-低" },
  "body_discomfort_high":          { min: 100, max: 500, type: "voucher",  desc: "身体不适-高" },
  "body_discomfort_medium":        { min: 50,  max: 200, type: "voucher",  desc: "身体不适-中" },
  "spoilage_high":                 { min: 50,  max: 200, type: "voucher",  desc: "变质-高" },
  "spoilage_medium":               { min: 20,  max: 100, type: "voucher",  desc: "变质-中" },
  "taste_issue_low":               { min: 0,   max: 50,  type: "apology",  desc: "口感问题" },
  "foreign_object_internal":       { min: 0,   max: 20,  type: "apology",  desc: "内源异物" },
  "general_low":                   { min: 0,   max: 30,  type: "apology",  desc: "通用投诉" },
};

function getCompensationType(category: string, risk: string): string {
  return COMPENSATION_MATRIX[`${category}_${risk}`]?.type ?? "apology";
}

function getCompensation(category: string, risk: string) {
  const entry = COMPENSATION_MATRIX[`${category}_${risk}`] ?? COMPENSATION_MATRIX["general_low"];
  if (!entry) return { min_amount: 0, max_amount: 30, recommended_type: "apology", description: "通用投诉" };
  return { min_amount: entry.min, max_amount: entry.max, recommended_type: entry.type, description: entry.desc };
}

const SLA_MATRIX: Record<string, { response_hours: number; resolution_hours: number; escalate: boolean; desc: string }> = {
  "foreign_object_external_high":   { response_hours: 1,  resolution_hours: 4,   escalate: true,  desc: "外源异物-高：1h响应，4h解决" },
  "foreign_object_external_medium":{ response_hours: 4,  resolution_hours: 24,  escalate: false, desc: "外源异物-中：4h响应，24h解决" },
  "foreign_object_external_low":   { response_hours: 24, resolution_hours: 72,  escalate: false, desc: "外源异物-低：24h响应，72h解决" },
  "body_discomfort_high":          { response_hours: 1,  resolution_hours: 2,   escalate: true,  desc: "身体不适-高：1h响应，2h解决" },
  "body_discomfort_medium":        { response_hours: 2,  resolution_hours: 12,  escalate: true,  desc: "身体不适-中：2h响应，12h解决" },
  "spoilage_high":                { response_hours: 2,  resolution_hours: 8,   escalate: true,  desc: "变质-高：2h响应，8h解决" },
  "spoilage_medium":              { response_hours: 8,  resolution_hours: 24,  escalate: false, desc: "变质-中：8h响应，24h解决" },
  "taste_issue_low":             { response_hours: 24, resolution_hours: 72,  escalate: false, desc: "口感：24h响应，72h解决" },
  "general_low":                  { response_hours: 48, resolution_hours: 168, escalate: false, desc: "通用：48h响应，168h解决" },
};

function getSla(category: string, risk: string) {
  const entry = SLA_MATRIX[`${category}_${risk}`] ?? SLA_MATRIX["general_low"];
  if (!entry) return { response_hours: 48, resolution_hours: 168, escalate_flag: false, description: "通用：48h响应，168h解决" };
  return { response_hours: entry.response_hours, resolution_hours: entry.resolution_hours, escalate_flag: entry.escalate, description: entry.desc };
}

function getSlaHours(category: string, risk: string): number {
  return SLA_MATRIX[`${category}_${risk}`]?.resolution_hours ?? 72;
}
