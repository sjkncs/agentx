/**
 * wo-subagent.ts — A27.3 喜茶食安工单子 Agent
 *
 * 职责：
 *   1. 创建食安工单（rpc_work_order_create）
 *   2. 查询工单列表 / 详情
 *   3. 升级工单（rpc_work_order_escalate）
 *   4. 推进 Stage（rpc_work_order_stage_advance）
 *   5. 补偿审批（rpc_compensation_approve）
 *
 * 工具集：
 *   - food_safety_create_work_order
 *   - food_safety_query_work_orders
 *   - food_safety_get_compensation
 *   - food_safety_get_sla
 *
 * 集成 harness-core：
 *   - role = "executor"（执行操作型）
 *   - isolation = "isolated"（独立执行，不共享父上下文）
 */

import type { SubagentConfig, SubagentResult, SubagentStatus } from "@datafoundry/harness-core/subagent";
import type { MastraTool } from "@mastra/core/tools";

export type {
  SubagentConfig,
  SubagentResult,
  SubagentStatus,
} from "@datafoundry/harness-core/subagent";

// ============================================================================
// Work Order Types
// ============================================================================

export interface WorkOrderCreateInput {
  conversation_id?: string;
  user_id: number;
  category: string;
  sub_category?: string;
  description: string;
  risk_level?: string;
  evidence_urls?: string[];
  store_info?: {
    store_id?: string;
    store_name?: string;
    address?: string;
  };
  order_info?: {
    order_no?: string;
    items?: string[];
    amount?: number;
  };
}

export interface WorkOrderCreateOutput {
  id: string;
  case_no: string;
  category: string;
  sub_category: string | null;
  description: string;
  risk_level: string;
  status: string;
  stage: string;
  sla_deadline: string;
  sla_status: string;
  escalation_required: boolean;
}

export interface WorkOrderEscalateInput {
  case_no: string;
  reason: string;
  escalate_to: string;
}

export interface WorkOrderStageAdvanceInput {
  case_no: string;
  stage: string;
  notes?: string;
  resolution?: string;
  handler_id?: number;
}

export interface CompensationApproveInput {
  case_no: string;
  compensation_type: string;
  compensation_amount?: number;
  resolution?: string;
  handler_id?: number;
}

// ============================================================================
// WorkOrderSubagent
// ============================================================================

export class WorkOrderSubagent {
  readonly id: string;
  readonly role: "executor" = "executor";
  readonly sessionId: string;
  readonly tools: MastraTool[];

  private _status: SubagentStatus = "initializing";
  private _config: SubagentConfig;

  constructor(config: { sessionId: string; tools: MastraTool[]; id?: string }) {
    this.sessionId = config.sessionId;
    this.tools     = config.tools;
    this.id        = config.id ?? `wo-subagent-${Date.now()}`;
    this._config   = {
      id: this.id,
      role: "executor",
      name: "WorkOrderSubagent",
      prompt: "喜茶食安工单子 Agent：工单创建 + 升级 + Stage 推进 + 补偿审批",
      timeout: 60_000,
      isolation: "isolated",
      context: {},
    };
  }

  getStatus(): SubagentStatus {
    return this._status;
  }

  /**
   * Create a new food safety work order
   */
  async createWorkOrder(input: WorkOrderCreateInput): Promise<WorkOrderCreateOutput> {
    this._status = "running";
    try {
      const tool = this.tools.find((t) => t.id === "food_safety_create_work_order");
      if (!tool) throw new Error("food_safety_create_work_order tool not found");

      const result = await tool.execute(input);
      this._status = "completed";
      return result as WorkOrderCreateOutput;
    } catch (err) {
      this._status = "failed";
      throw err;
    }
  }

  /**
   * Query work orders
   */
  async queryWorkOrders(params: {
    user_id?: number;
    status?: string;
    category?: string;
    risk_level?: string;
    limit?: number;
  }): Promise<{ filters: Record<string, unknown>; results: unknown[]; count: number }> {
    this._status = "running";
    try {
      const tool = this.tools.find((t) => t.id === "food_safety_query_work_orders");
      if (!tool) throw new Error("food_safety_query_work_orders tool not found");

      const result = await tool.execute(params);
      this._status = "completed";
      return result as { filters: Record<string, unknown>; results: unknown[]; count: number };
    } catch (err) {
      this._status = "failed";
      throw err;
    }
  }

  /**
   * Get SLA configuration for a category + risk level
   */
  async getSla(category: string, risk_level: string): Promise<{
    response_hours: number;
    resolution_hours: number;
    escalate_flag: boolean;
    description: string;
  }> {
    this._status = "running";
    try {
      const tool = this.tools.find((t) => t.id === "food_safety_get_sla");
      if (!tool) throw new Error("food_safety_get_sla tool not found");

      const result = await tool.execute({ category, risk_level });
      this._status = "completed";
      return result as { response_hours: number; resolution_hours: number; escalate_flag: boolean; description: string };
    } catch (err) {
      this._status = "failed";
      throw err;
    }
  }

  /**
   * Get compensation recommendation
   */
  async getCompensation(params: {
    category: string;
    sub_category?: string;
    risk_level: string;
  }): Promise<{
    min_amount: number;
    max_amount: number;
    recommended_type: string;
    description: string;
  }> {
    this._status = "running";
    try {
      const tool = this.tools.find((t) => t.id === "food_safety_get_compensation");
      if (!tool) throw new Error("food_safety_get_compensation tool not found");

      const result = await tool.execute(params);
      this._status = "completed";
      return result as { min_amount: number; max_amount: number; recommended_type: string; description: string };
    } catch (err) {
      this._status = "failed";
      throw err;
    }
  }

  /**
   * Get subagent info
   */
  getInfo(): SubagentConfig {
    return { ...this._config, id: this.id, role: this.role };
  }
}
