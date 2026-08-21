/**
 * xicha-orchestrator.ts — A27.4 喜茶食安编排器
 *
 * 负责子 Agent 路由和串联：
 *
 *   用户消息
 *       │
 *       ▼
 *   FoodSafetySubagent.classify()
 *       │
 *       ├─ intent ≠ food_safety → 直接返回（general knowledge）
 *       │
 *       ▼
 *   FoodSafetySubagent.generateReply()
 *       │
 *       ▼
 *   FoodSafetySubagent.audit()
 *       │
 *       ├─ status = block → 替换为合规兜底回复
 *       ├─ status = warn  → 返回警告信息
 *       └─ status = pass  → 直接返回
 *       │
 *       ▼
 *   [high risk + has store_info]
 *       │
 *       ▼
 *   WorkOrderSubagent.createWorkOrder()
 *       │
 *       ▼
 *   触发钉钉通知事件（work_order.created）
 *       │
 *       ▼
 *   触发补偿生成事件（compensation.generate）
 */

import type { SubagentManager } from "@datafoundry/harness-core/subagent";
import type { SubagentResult } from "@datafoundry/harness-core/subagent";

import { FoodSafetySubagent } from "./food-safety-subagent.js";
import { WorkOrderSubagent } from "./wo-subagent.js";

// Re-export types for convenience
export type {
  IntentClassifyOutput,
  ReplyGenerateOutput,
  AuditOutput,
} from "./food-safety-subagent.js";

export type {
  WorkOrderCreateInput,
  WorkOrderCreateOutput,
  WorkOrderEscalateInput,
  WorkOrderStageAdvanceInput,
  CompensationApproveInput,
} from "./wo-subagent.js";

export interface XichaOrchestratorConfig {
  foodSafetyAgent: FoodSafetySubagent;
  workOrderAgent: WorkOrderSubagent;
}

export interface NotifyEvent {
  event_name: string;
  payload: Record<string, unknown>;
}

/**
 * 编排结果
 */
export interface OrchestratedResult {
  reply: string;
  intent: string;
  subIntent: string | null;
  riskLevel: string | null;
  auditStatus: "pass" | "warn" | "block";
  workOrder?: {
    caseNo: string;
    workOrderId: string;
  };
  events: NotifyEvent[];
  warnings?: string[];
}

// ============================================================================
// XichaFSDOrchestrator
// ============================================================================

export class XichaFSDOrchestrator {
  private manager: SubagentManager;
  private foodSafetyAgent: FoodSafetySubagent;
  private workOrderAgent: WorkOrderSubagent;

  constructor(_manager: SubagentManager, config: XichaOrchestratorConfig) {
    this.manager         = _manager;
    this.foodSafetyAgent = config.foodSafetyAgent;
    this.workOrderAgent = config.workOrderAgent;
  }

  /**
   * 路由：意图分类
   */
  async classifyIntent(message: string): Promise<{
    intent: string;
    sub_intent: string | null;
    risk_level: string | null;
    confidence: number;
    method: string;
    should_escalate: boolean;
  }> {
    return this.foodSafetyAgent.classify(message);
  }

  /**
   * 路由：话术生成
   */
  async generateReply(params: {
    intent: string;
    sub_intent?: string;
    risk_level?: string;
    user_message?: string;
  }): Promise<{
    intent: string;
    sub_intent: string | null;
    risk_level: string | null;
    four_step_script: { empathy: string; collect: string; promise: string; compensate: string };
    recommended_compensation_type: string;
    escalation_required: boolean;
  }> {
    return this.foodSafetyAgent.generateReply(params);
  }

  /**
   * 路由：输出审计
   */
  async auditOutput(
    reply: string,
    intent: string,
  ): Promise<{
    status: "pass" | "warn" | "block";
    audited_text: string;
    violations: string[];
    warnings: string[];
  }> {
    return this.foodSafetyAgent.audit(reply, intent);
  }

  /**
   * 路由：创建工单
   */
  async createWorkOrder(input: {
    conversation_id?: string;
    user_id: number;
    category: string;
    description: string;
    risk_level?: string;
    store_info?: { store_id?: string; store_name?: string; address?: string };
    order_info?: { order_no?: string; items?: string[]; amount?: number };
  }): Promise<{ caseNo: string; workOrderId: string }> {
    const result = await this.workOrderAgent.createWorkOrder(input as Parameters<typeof this.workOrderAgent.createWorkOrder>[0]);
    return { caseNo: result.case_no, workOrderId: result.id };
  }

  /**
   * 路由：升级工单
   */
  async escalateWorkOrder(input: {
    case_no: string;
    reason: string;
    escalate_to: string;
  }): Promise<{ success: boolean }> {
    // 调用 Inngest gate RPC
    // WorkOrderSubagent 会通过 tool 扩展这里
    console.log("[orchestrator] escalate:", input);
    return { success: true };
  }

  /**
   * 路由：补偿审批
   */
  async approveCompensation(input: {
    case_no: string;
    compensation_type: string;
    compensation_amount?: number;
    resolution?: string;
    handler_id?: number;
  }): Promise<{ success: boolean }> {
    console.log("[orchestrator] approve compensation:", input);
    return { success: true };
  }

  /**
   * 执行指定任务
   */
  async executeTask(
    task: "classify" | "reply" | "audit" | "create_wo" | "escalate" | "approve",
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (task) {
      case "classify":
        return this.classifyIntent(String(params.message ?? ""));

      case "reply":
        return this.generateReply({
          intent: String(params.intent ?? "food_safety"),
          sub_intent: params.sub_intent as string | undefined,
          risk_level: params.risk_level as string | undefined,
          user_message: params.user_message as string | undefined,
        });

      case "audit":
        return this.auditOutput(
          String(params.reply ?? ""),
          String(params.intent ?? "food_safety"),
        );

      case "create_wo":
        return this.createWorkOrder(params as Parameters<typeof this.createWorkOrder>[0]);

      case "escalate":
        return this.escalateWorkOrder(params as Parameters<typeof this.escalateWorkOrder>[0]);

      case "approve":
        return this.approveCompensation(params as Parameters<typeof this.approveCompensation>[0]);

      default:
        throw new Error(`Unknown task: ${task}`);
    }
  }

  /**
   * 完整编排流程
   *
   * 用户消息 → classify → [非食安? 直接返回] → generateReply
   * → audit → [block? 替换] → [high risk? createWorkOrder → 触发事件]
   */
  async orchestrate(input: {
    message: string;
    conversationId?: string;
    userId: number;
    context?: Record<string, unknown>;
  }): Promise<OrchestratedResult> {
    const events: NotifyEvent[] = [];
    const warnings: string[] = [];

    // 1. Intent Classification
    const classifyResult = await this.foodSafetyAgent.classify(input.message);

    if (classifyResult.intent !== "food_safety") {
      return {
        reply: classifyResult.intent === "ordering"
          ? "这是点单相关咨询，建议您通过喜茶小程序或外卖平台下单。"
          : "感谢您的反馈，我会记录并反馈给相关部门。",
        intent: classifyResult.intent,
        subIntent: null,
        riskLevel: null,
        auditStatus: "pass",
        events,
        warnings,
      };
    }

    // 2. Generate Reply
    const replyResult = await this.foodSafetyAgent.generateReply({
      intent: classifyResult.intent,
      sub_intent: classifyResult.sub_intent ?? undefined,
      risk_level: classifyResult.risk_level ?? undefined,
      user_message: input.message,
    });

    // 3. Audit Output
    const auditResult = await this.foodSafetyAgent.audit(
      replyResult.four_step_script.compensate,
      classifyResult.intent,
    );

    let finalReply = auditResult.audited_text;

    if (auditResult.status === "block") {
      finalReply = "非常抱歉给您带来不便，我们会认真对待您的反馈，立即安排专人跟进处理。";
      warnings.push("回复被阻断，已替换为合规兜底话术");
      warnings.push(...auditResult.violations);
    } else if (auditResult.status === "warn") {
      warnings.push(...auditResult.warnings);
    }

    // 4. Create Work Order for high risk
    if (classifyResult.should_escalate && input.context?.store_info) {
      try {
        const woResult = await this.workOrderAgent.createWorkOrder({
          conversation_id: input.conversationId,
          user_id: input.userId,
          category: classifyResult.sub_intent ?? "other",
          description: input.message,
          risk_level: classifyResult.risk_level ?? "medium",
          store_info: input.context.store_info as { store_id?: string; store_name?: string; address?: string },
        });

        // Trigger notification event
        events.push({
          event_name: "work_order.created",
          payload: {
            work_order_id: woResult.id,
            case_no: woResult.case_no,
            category: classifyResult.sub_intent,
            risk_level: classifyResult.risk_level,
            sla_deadline: woResult.sla_deadline,
          },
        });

        // Trigger compensation generate event
        events.push({
          event_name: "compensation.generate",
          payload: {
            work_order_id: woResult.id,
            case_no: woResult.case_no,
            category: classifyResult.sub_intent,
            risk_level: classifyResult.risk_level,
            recommended_type: replyResult.recommended_compensation_type,
          },
        });
      } catch (err) {
        warnings.push(`工单创建失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return {
      reply: finalReply,
      intent: classifyResult.intent,
      subIntent: classifyResult.sub_intent ?? null,
      riskLevel: classifyResult.risk_level ?? null,
      auditStatus: auditResult.status,
      events,
      warnings,
    };
  }
}
