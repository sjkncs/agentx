/**
 * xicha-fsd-agent.ts — A27.1 喜茶食安主 Agent
 *
 * 架构：
 *   XichaFSDAgent
 *     ├─ toolRegistry  ← FOOD_SAFETY_TOOLS (7 tools)
 *     ├─ orchestrator ← XichaFSDOrchestrator
 *     └─ sessionLog   ← SessionEventLog
 *
 * 子 Agent 路由：
 *   classify  → FoodSafetySubagent (意图分类)
 *   reply     → FoodSafetySubagent (话术生成 + 输出审计)
 *   create_wo → WorkOrderSubagent  (工单创建)
 *   escalate  → WorkOrderSubagent  (升级)
 *   approve   → WorkOrderSubagent  (补偿审批)
 */

import type { AgentRunContext, AgUiEventEmitter } from "@datafoundry/agent-runtime";
import type { McpRuntime } from "@datafoundry/harness-core";
import { SubagentManager, createOrchestrator } from "@datafoundry/harness-core/subagent";
import type { SubagentManagerConfig } from "@datafoundry/harness-core/subagent";
import {
  SessionEventLog,
  TimelineRecorder,
  DEFAULT_HARNESS_CAPABILITIES,
  buildHarnessSystemPrompt,
} from "@datafoundry/harness-core";

import {
  FOOD_SAFETY_TOOLS,
  foodSafetyIntentClassifyTool,
  foodSafetyGenerateReplyTool,
  foodSafetyAuditOutputTool,
  foodSafetyCreateWorkOrderTool,
  foodSafetyQueryWorkOrdersTool,
  foodSafetyGetCompensationTool,
  foodSafetyGetSlaTool,
} from "@datafoundry/agent-runtime";

import { XichaFSDOrchestrator } from "./xicha-orchestrator.js";
import { FoodSafetySubagent } from "./food-safety-subagent.js";
import { WorkOrderSubagent } from "./wo-subagent.js";

// ============================================================================
// Types
// ============================================================================

export interface XichaFSDConfig {
  sessionId: string;
  workspaceId: string;
  userId: string;
  mcpRuntime?: McpRuntime;
  subagentConfig?: SubagentManagerConfig;
  enableAudit?: boolean;
  enableSessionLog?: boolean;
}

export interface XichaFSDAgentInput {
  message: string;
  conversationId?: string;
  context?: Record<string, unknown>;
}

export interface XichaFSDAgentResult {
  sessionId: string;
  messageId: string;
  intent?: string;
  subIntent?: string;
  riskLevel?: string;
  reply?: string;
  auditedReply?: string;
  workOrderId?: string;
  caseNo?: string;
  success: boolean;
  error?: string;
  subagentResults?: Record<string, unknown>;
  durationMs: number;
}

export interface IntentClassifyResult {
  intent: string;
  sub_intent: string | null;
  risk_level: string | null;
  confidence: number;
  method: string;
  should_escalate: boolean;
}

export interface ReplyGenerateResult {
  intent: string;
  sub_intent: string | null;
  risk_level: string | null;
  four_step_script: {
    empathy: string;
    collect: string;
    promise: string;
    compensate: string;
  };
  recommended_compensation_type: string;
  escalation_required: boolean;
}

export interface AuditResult {
  status: "pass" | "warn" | "block";
  audited_text: string;
  violations: string[];
  warnings: string[];
}

// ============================================================================
// XichaFSDAgent
// ============================================================================

export class XichaFSDAgent {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly tools = FOOD_SAFETY_TOOLS;

  private manager: SubagentManager;
  private orchestrator: XichaFSDOrchestrator;
  private sessionLog?: SessionEventLog;
  private timeline?: TimelineRecorder;
  private enableAudit: boolean;

  constructor(config: XichaFSDConfig) {
    this.sessionId   = config.sessionId;
    this.workspaceId = config.workspaceId;
    this.userId      = config.userId;
    this.enableAudit = config.enableAudit ?? true;

    // Subagent Manager
    this.manager = new SubagentManager(config.subagentConfig);

    // Food Safety + Work Order Subagents
    const foodSafetyAgent = new FoodSafetySubagent({
      sessionId: this.sessionId,
      tools: [foodSafetyIntentClassifyTool, foodSafetyGenerateReplyTool, foodSafetyAuditOutputTool],
    });

    const workOrderAgent = new WorkOrderSubagent({
      sessionId: this.sessionId,
      tools: [foodSafetyCreateWorkOrderTool, foodSafetyQueryWorkOrdersTool,
               foodSafetyGetCompensationTool, foodSafetyGetSlaTool],
    });

    this.manager.register(foodSafetyAgent);
    this.manager.register(workOrderAgent);

    // Orchestrator with routing
    this.orchestrator = new XichaFSDOrchestrator(this.manager, {
      foodSafetyAgent,
      workOrderAgent,
    });

    // Session logging
    if (config.enableSessionLog) {
      this.sessionLog = new SessionEventLog({ sessionId: this.sessionId });
      this.timeline = new TimelineRecorder({ sessionId: this.sessionId });
    }
  }

  /**
   * Process a user message through the FSD agent pipeline
   *
   * Pipeline:
   *   1. classify intent  → FoodSafetySubagent
   *   2. generate reply  → FoodSafetySubagent
   *   3. audit output    → FoodSafetySubagent
   *   4. [optional] create WO → WorkOrderSubagent
   *   5. [optional] escalate   → WorkOrderSubagent
   */
  async process(input: XichaFSDAgentInput): Promise<XichaFSDAgentResult> {
    const start = Date.now();
    const messageId = `msg-${start}-${Math.random().toString(36).slice(2, 6)}`;

    this.timeline?.record({ type: "agent:start", messageId, input: input.message });

    try {
      // Step 1: Intent Classification
      const classifyResult = await this.orchestrator.classifyIntent(input.message);

      this.timeline?.record({ type: "intent:classified", ...classifyResult });

      if (classifyResult.intent !== "food_safety") {
        return {
          sessionId: this.sessionId,
          messageId,
          intent: classifyResult.intent,
          success: true,
          subagentResults: { classify: classifyResult },
          durationMs: Date.now() - start,
        };
      }

      // Step 2: Generate Reply (4-step script)
      const replyResult = await this.orchestrator.generateReply({
        intent: classifyResult.intent,
        sub_intent: classifyResult.sub_intent ?? undefined,
        risk_level: classifyResult.risk_level ?? undefined,
        user_message: input.message,
      });

      this.timeline?.record({ type: "reply:generated", script: replyResult.four_step_script });

      // Step 3: Audit Output (L4 compliance check)
      let auditedReply = replyResult.four_step_script.compensate;
      if (this.enableAudit) {
        const auditResult = await this.orchestrator.auditOutput(
          replyResult.four_step_script.compensate,
          classifyResult.intent,
        );
        auditedReply = auditResult.audited_text;
        this.timeline?.record({
          type: "output:audited",
          status: auditResult.status,
          violations: auditResult.violations,
        });
      }

      // Step 4: Auto-escalate for high risk
      let woResult: { caseNo?: string; workOrderId?: string } = {};
      if (classifyResult.should_escalate && input.context?.store_info) {
        woResult = await this.orchestrator.createWorkOrder({
          conversation_id: input.conversationId,
          user_id: parseInt(String(this.userId), 10),
          category: classifyResult.sub_intent ?? "other",
          description: input.message,
          risk_level: classifyResult.risk_level ?? "medium",
          store_info: input.context.store_info as { store_id?: string; store_name?: string; address?: string },
        });

        this.timeline?.record({ type: "work_order:created", ...woResult });
      }

      this.sessionLog?.append({
        sessionId: this.sessionId,
        role: "assistant",
        content: auditedReply,
        metadata: {
          messageId,
          intent: classifyResult,
          wo: woResult,
        },
      });

      return {
        sessionId: this.sessionId,
        messageId,
        intent: classifyResult.intent,
        subIntent: classifyResult.sub_intent ?? undefined,
        riskLevel: classifyResult.risk_level ?? undefined,
        reply: replyResult.four_step_script.compensate,
        auditedReply,
        workOrderId: woResult.workOrderId,
        caseNo: woResult.caseNo,
        success: true,
        subagentResults: {
          classify: classifyResult,
          reply: replyResult,
          audit: this.enableAudit
            ? await this.orchestrator.auditOutput(replyResult.four_step_script.compensate, classifyResult.intent)
            : null,
        },
        durationMs: Date.now() - start,
      };

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.timeline?.record({ type: "agent:error", error: errorMsg });
      return {
        sessionId: this.sessionId,
        messageId,
        success: false,
        error: errorMsg,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Execute a specific subagent task
   */
  async executeTask(
    task: "classify" | "reply" | "audit" | "create_wo" | "escalate" | "approve",
    params: Record<string, unknown>,
  ): Promise<unknown> {
    return this.orchestrator.executeTask(task, params);
  }

  /**
   * Get agent system prompt (for LLM context injection)
   */
  getSystemPrompt(): string {
    return buildHarnessSystemPrompt({
      capabilities: DEFAULT_HARNESS_CAPABILITIES,
      agentName: "XichaFSD",
      customInstructions: [
        "你是喜茶食品安全智能助手，专门处理食品安全投诉和咨询。",
        "所有回复必须通过 L4 输出审计（禁止承诺全额退款/100%满意/确认责任方）。",
        "高风险（high）投诉必须自动升级并创建工单。",
        "使用 4 步话术：共情(empathy) → 收集(collect) → 承诺(promise) → 补偿(compensate)。",
        "补偿类型：代金券(voucher) > 重新配送(redelivery) > 退款(refund) > 道歉(apology)。",
      ],
    });
  }

  /**
   * Get session stats
   */
  getStats() {
    return this.manager.getStats();
  }

  /**
   * Destroy the agent and cleanup
   */
  async destroy(): Promise<void> {
    this.manager.removeAllListeners();
    this.sessionLog?.flush();
  }
}
