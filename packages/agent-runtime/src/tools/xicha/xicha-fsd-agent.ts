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

import { createOrchestrator, SessionEventLog, TimelineRecorder, buildHarnessSystemPrompt } from "@datafoundry/harness-core";
import type { SubagentManagerConfig } from "@datafoundry/harness-core";
import { SubagentManager } from "@datafoundry/harness-core";
import {
  FOOD_SAFETY_TOOLS,
  foodSafetyIntentClassifyTool,
  foodSafetyGenerateReplyTool,
  foodSafetyAuditOutputTool,
  foodSafetyCreateWorkOrderTool,
  foodSafetyQueryWorkOrdersTool,
  foodSafetyGetCompensationTool,
  foodSafetyGetSlaTool,
} from "../food-safety-tools.js";

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
  runId?: string;
  mcpRuntime?: unknown;
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
  subIntent?: string | undefined;
  riskLevel?: string | undefined;
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
  readonly runId: string;

  private manager: SubagentManager;
  private orchestrator: XichaFSDOrchestrator;
  private sessionLog?: SessionEventLog;
  private timeline?: TimelineRecorder;
  private enableAudit: boolean;
  // Track child subagent IDs so we can register them with the manager properly
  private readonly foodSafetyAgent: FoodSafetySubagent;
  private readonly workOrderAgent: WorkOrderSubagent;

  constructor(config: XichaFSDConfig) {
    this.sessionId   = config.sessionId;
    this.workspaceId = config.workspaceId;
    this.userId      = config.userId;
    this.runId       = config.runId ?? `run-${config.sessionId}`;
    this.enableAudit = config.enableAudit ?? true;

    // Subagent Manager (constructs children lazily)
    this.manager = new SubagentManager(config.subagentConfig);

    // Food Safety + Work Order Subagents
    this.foodSafetyAgent = new FoodSafetySubagent({
      sessionId: this.sessionId,
      tools: [foodSafetyIntentClassifyTool, foodSafetyGenerateReplyTool, foodSafetyAuditOutputTool],
    });

    this.workOrderAgent = new WorkOrderSubagent({
      sessionId: this.sessionId,
      tools: [foodSafetyCreateWorkOrderTool, foodSafetyQueryWorkOrdersTool,
               foodSafetyGetCompensationTool, foodSafetyGetSlaTool],
    });

    // Register as managed subagents so the manager tracks lifecycle & emits events.
    this.manager.spawn(this.sessionId, this.foodSafetyAgent.getInfo());
    this.manager.spawn(this.sessionId, this.workOrderAgent.getInfo());

    // Orchestrator with routing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.orchestrator = new XichaFSDOrchestrator(this.manager as any, {
      foodSafetyAgent: this.foodSafetyAgent,
      workOrderAgent: this.workOrderAgent,
    });

    // Session logging
    if (config.enableSessionLog) {
      this.sessionLog = new SessionEventLog({ sessionId: this.sessionId, runId: this.runId });
      this.timeline = new TimelineRecorder(this.sessionLog, {
        sessionId: this.sessionId,
        runId: this.runId,
      });
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

    this.recordTimeline({
      type: "session/tag",
      tag: `agent:start:${messageId}`,
    });

    try {
      // Step 1: Intent Classification
      const classifyResult = await this.orchestrator.classifyIntent(input.message);

      this.recordTimeline({
        type: "session/tag",
        tag: `intent:${classifyResult.intent}`,
      });

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
        user_message: input.message,
        ...(classifyResult.sub_intent ? { sub_intent: classifyResult.sub_intent } : {}),
        ...(classifyResult.risk_level ? { risk_level: classifyResult.risk_level } : {}),
      });

      this.recordTimeline({
        type: "session/tag",
        tag: `reply:${replyResult.four_step_script ? "generated" : "none"}`,
      });

      // Step 3: Audit Output (L4 compliance check)
      let auditedReply = replyResult.four_step_script.compensate;
      if (this.enableAudit) {
        const auditResult = await this.orchestrator.auditOutput(
          replyResult.four_step_script.compensate,
          classifyResult.intent,
        );
        auditedReply = auditResult.audited_text;
        this.recordTimeline({
          type: "session/tag",
          tag: `audit:${auditResult.status}`,
        });
      }

      // Step 4: Auto-escalate for high risk
      let woResult: { caseNo?: string; workOrderId?: string } = {};
      if (classifyResult.should_escalate && input.context?.store_info) {
        const storeInfo = input.context.store_info as { store_id?: string; store_name?: string; address?: string };
        woResult = await this.orchestrator.createWorkOrder({
          user_id: parseInt(String(this.userId), 10),
          category: classifyResult.sub_intent ?? "other",
          description: input.message,
          risk_level: classifyResult.risk_level ?? "medium",
          store_info: storeInfo,
          ...(input.conversationId ? { conversation_id: input.conversationId } : {}),
        });

        this.recordTimeline({
          type: "session/tag",
          tag: `work_order:${woResult.caseNo ?? "none"}`,
        });
      }

      this.sessionLog?.append({
        type: "assistant/message",
        content: auditedReply,
        turnId: messageId,
        timestamp: Date.now(),
      });

      const result: XichaFSDAgentResult = {
        sessionId: this.sessionId,
        messageId,
        intent: classifyResult.intent,
        success: true,
        reply: replyResult.four_step_script.compensate,
        auditedReply,
        durationMs: Date.now() - start,
        subagentResults: { classify: classifyResult, reply: replyResult },
      };
      if (classifyResult.sub_intent) result.subIntent = classifyResult.sub_intent;
      if (classifyResult.risk_level) result.riskLevel = classifyResult.risk_level;
      if (woResult.caseNo) result.caseNo = woResult.caseNo;
      if (woResult.workOrderId) result.workOrderId = woResult.workOrderId;
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.recordTimeline({
        type: "session/tag",
        tag: `agent:error:${messageId}`,
      });
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
   * Helper: safely record to timeline if enabled.
   */
  private recordTimeline(event: Parameters<SessionEventLog["append"]>[0]): void {
    if (this.sessionLog) {
      this.sessionLog.append(event);
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
    const xichaBrief = [
      "你是喜茶食品安全智能助手，专门处理食品安全投诉和咨询。",
      "所有回复必须通过 L4 输出审计（禁止承诺全额退款/100%满意/确认责任方）。",
      "高风险（high）投诉必须自动升级并创建工单。",
      "使用 4 步话术：共情(empathy) → 收集(collect) → 承诺(promise) → 补偿(compensate)。",
      "补偿类型：代金券(voucher) > 重新配送(redelivery) > 退款(refund) > 道歉(apology)。",
    ].join("\n- ");
    return buildHarnessSystemPrompt(`# Xicha FSD Agent\n- ${xichaBrief}`);
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
    this.sessionLog?.dispose?.();
  }
}
