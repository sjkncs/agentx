/**
 * food-safety-subagent.ts — A27.2 喜茶食安专业化子 Agent
 *
 * 职责：
 *   1. 意图分类（L1 正则 + L1b LLM 增强）
 *   2. 动态话术生成（4步：empathy → collect → promise → compensate）
 *   3. L4 输出合规审计（blocklist + 食安红线 + 幻觉检测）
 *
 * 工具集：
 *   - food_safety_intent_classify
 *   - food_safety_generate_reply
 *   - food_safety_audit_output
 *
 * 集成 harness-core：
 *   - 继承 Subagent 基类（事件驱动、step 记录、token 统计）
 *   - role = "researcher"（调研分析型）
 *   - isolation = "shared"（共享父 agent 上下文）
 */

import type { SubagentConfig, SubagentResult, SubagentStatus } from "@datafoundry/harness-core/subagent";

// MastraTool type was moved out of @mastra/core/tools; use a permissive local shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MastraTool = any;

// Re-export the types for convenience
export type {
  SubagentConfig,
  SubagentResult,
  SubagentStatus,
} from "@datafoundry/harness-core/subagent";

/**
 * Intent Classification Output
 */
export interface IntentClassifyOutput {
  intent: string;
  sub_intent: string | null;
  risk_level: string | null;
  confidence: number;
  method: string;
  should_escalate: boolean;
}

/**
 * Reply Generation Output
 */
export interface ReplyGenerateOutput {
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

/**
 * Output Audit Output
 */
export interface AuditOutput {
  status: "pass" | "warn" | "block";
  audited_text: string;
  violations: string[];
  warnings: string[];
  meta: Record<string, unknown>;
}

// ============================================================================
// FoodSafetySubagent
// ============================================================================

export class FoodSafetySubagent {
  readonly id: string;
  readonly role: "researcher" = "researcher";
  readonly sessionId: string;
  readonly tools: MastraTool[];

  private _status: SubagentStatus = "initializing";
  private _config: SubagentConfig;

  constructor(
    config: {
      sessionId: string;
      tools: MastraTool[];
      id?: string;
    },
  ) {
    this.sessionId = config.sessionId;
    this.tools     = config.tools;
    this.id        = config.id ?? `food-safety-${Date.now()}`;
    this._config   = {
      id: this.id,
      role: "researcher",
      name: "FoodSafetySubagent",
      prompt: "喜茶食安专业化子 Agent：意图分类 + 话术生成 + 输出审计",
      timeout: 30_000,
      isolation: "shared",
      context: {},
    };
  }

  getStatus(): SubagentStatus {
    return this._status;
  }

  /**
   * Step 1: Classify user intent
   */
  async classify(message: string): Promise<IntentClassifyOutput> {
    this._status = "running";

    try {
      // Find the classify tool
      const tool = this.tools.find((t) => t.id === "food_safety_intent_classify");
      if (!tool) throw new Error("food_safety_intent_classify tool not found");

      const result = await tool.execute({ message });
      this._status = "completed";

      const output = result as IntentClassifyOutput;
      return output;
    } catch (err) {
      this._status = "failed";
      throw err;
    }
  }

  /**
   * Step 2: Generate 4-step response script
   */
  async generateReply(params: {
    intent: string;
    sub_intent?: string;
    risk_level?: string;
    user_message?: string;
    stage?: string;
  }): Promise<ReplyGenerateOutput> {
    this._status = "running";

    try {
      const tool = this.tools.find((t) => t.id === "food_safety_generate_reply");
      if (!tool) throw new Error("food_safety_generate_reply tool not found");

      const result = await tool.execute(params);
      this._status = "completed";

      return result as ReplyGenerateOutput;
    } catch (err) {
      this._status = "failed";
      throw err;
    }
  }

  /**
   * Step 3: L4 output compliance audit
   */
  async audit(reply: string, intent: string): Promise<AuditOutput> {
    this._status = "running";

    try {
      const tool = this.tools.find((t) => t.id === "food_safety_audit_output");
      if (!tool) throw new Error("food_safety_audit_output tool not found");

      const result = await tool.execute({ reply, intent });
      this._status = "completed";

      return result as AuditOutput;
    } catch (err) {
      this._status = "failed";
      throw err;
    }
  }

  /**
   * Run full pipeline: classify → reply → audit
   */
  async runPipeline(
    message: string,
    context?: Record<string, unknown>,
  ): Promise<{
    classify: IntentClassifyOutput;
    reply: ReplyGenerateOutput;
    audit: AuditOutput;
  }> {
    const start = Date.now();

    // 1. Classify
    const classifyResult = await this.classify(message);
    if (classifyResult.intent !== "food_safety") {
      return {
        classify: classifyResult,
        reply: { intent: "general", sub_intent: null, risk_level: null,
          four_step_script: { empathy: "", collect: "", promise: "", compensate: "" },
          recommended_compensation_type: "apology", escalation_required: false },
        audit: { status: "pass", audited_text: "", violations: [], warnings: [], meta: {} },
      };
    }

    // 2. Generate Reply
    const replyResult = await this.generateReply({
      intent: classifyResult.intent,
      user_message: message,
      ...(classifyResult.sub_intent ? { sub_intent: classifyResult.sub_intent } : {}),
      ...(classifyResult.risk_level ? { risk_level: classifyResult.risk_level } : {}),
    });

    // 3. Audit
    const auditResult = await this.audit(replyResult.four_step_script.compensate, classifyResult.intent);

    return { classify: classifyResult, reply: replyResult, audit: auditResult };
  }

  getInfo(): SubagentConfig {
    return { ...this._config, id: this.id, role: this.role };
  }
}
