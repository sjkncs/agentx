/**
 * 喜茶食安编排器
 * Food Safety Orchestrator
 *
 * 消费 inbox 中的待处理事件，调度各个 Agent 完成完整处理流程
 */

import type {
  FoodSafetyInboxEvent,
  CreateInboxEventInput,
  EventStatus,
} from "./food-safety-types.js";
import { classifyIntent } from "./food-safety-intent-assembly.js";
import { diagnose } from "./food-safety-diagnosis-assembly.js";
import { generateReply } from "./food-safety-reply-assembly.js";

export interface OrchestratorConfig {
  /** 是否启用自动处理 */
  autoProcess: boolean;
  /** 自动升级阈值（风险等级） */
  escalationThreshold: number;
  /** 批处理大小 */
  batchSize: number;
  /** 处理间隔（毫秒） */
  processInterval: number;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  autoProcess: true,
  escalationThreshold: 7, // 风险等级 >= 7 自动升级
  batchSize: 10,
  processInterval: 5000, // 5 秒
};

export type ProcessingStage =
  | "received"
  | "classifying"
  | "diagnosed"
  | "replying"
  | "escalating"
  | "completed"
  | "failed";

export interface ProcessingResult {
  event_id: string;
  stage: ProcessingStage;
  success: boolean;
  error?: string;
  result?: {
    intent?: ReturnType<typeof classifyIntent>;
    diagnosis?: ReturnType<typeof diagnose>;
    reply?: ReturnType<typeof generateReply>;
    work_order_id?: string;
  };
}

// ============================================================================
// 编排器
// ============================================================================

export class FoodSafetyOrchestrator {
  private readonly config: OrchestratorConfig;
  private isRunning = false;
  private processingQueue: string[] = [];
  private processedCount = 0;

  constructor(config: Partial<OrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
  }

  /**
   * 启动编排器
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log("[Orchestrator] Already running");
      return;
    }

    this.isRunning = true;
    console.log("[Orchestrator] Started with config:", this.config);

    // 启动处理循环
    this.startProcessingLoop();
  }

  /**
   * 停止编排器
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    this.processingQueue = [];
    console.log("[Orchestrator] Stopped");
  }

  /**
   * 添加事件到处理队列
   */
  enqueue(eventId: string): void {
    if (!this.processingQueue.includes(eventId)) {
      this.processingQueue.push(eventId);
      console.log(`[Orchestrator] Event ${eventId} enqueued (queue size: ${this.processingQueue.length})`);
    }
  }

  /**
   * 获取处理状态
   */
  getStatus(): { isRunning: boolean; queueSize: number; processedCount: number } {
    return {
      isRunning: this.isRunning,
      queueSize: this.processingQueue.length,
      processedCount: this.processedCount,
    };
  }

  /**
   * 处理单个事件
   */
  async processEvent(input: CreateInboxEventInput): Promise<ProcessingResult> {
    const eventId = input.metadata?.event_id as string ||
      `fsf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

    console.log(`[Orchestrator] Processing event ${eventId}`);

    try {
      // 阶段1: 意图分类
      const intent = classifyIntent({
        id: eventId,
        content: input.raw_content,
        source: input.source,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      });

      console.log(`[Orchestrator] Intent classified: ${intent.intent} (${intent.confidence})`);

      // 如果是无关内容，直接完成
      if (intent.intent === "irrelevant") {
        return {
          event_id: eventId,
          stage: "completed",
          success: true,
          result: { intent },
        };
      }

      // 阶段2: 诊断分析
      const diagnosis = diagnose({
        event_id: eventId,
        content: input.raw_content,
        source: input.source,
        keywords: intent.keywords,
      });

      console.log(`[Orchestrator] Diagnosis: severity=${diagnosis.severity}, risk=${diagnosis.risk_level}`);

      // 阶段3: 生成回复
      const reply = generateReply({
        type: intent.intent === "food_safety_risk" ? "food_safety_risk" : "consultation_complaint",
        severity: diagnosis.severity,
        content: input.raw_content,
      });

      console.log(`[Orchestrator] Reply type: ${reply.reply_type}`);

      // 阶段4: 判断是否升级
      const shouldEscalate =
        reply.reply_type === "escalate" ||
        diagnosis.risk_level >= this.config.escalationThreshold ||
        diagnosis.severity === "high";

      if (shouldEscalate) {
        console.log(`[Orchestrator] Event ${eventId} escalated`);
        // TODO: 调用工单系统创建工单
        return {
          event_id: eventId,
          stage: "escalating",
          success: true,
          result: { intent, diagnosis, reply },
        };
      }

      return {
        event_id: eventId,
        stage: "completed",
        success: true,
        result: { intent, diagnosis, reply },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Orchestrator] Event ${eventId} failed:`, message);

      return {
        event_id: eventId,
        stage: "failed",
        success: false,
        error: message,
      };
    }
  }

  /**
   * 批量处理事件
   */
  async processBatch(inputs: CreateInboxEventInput[]): Promise<ProcessingResult[]> {
    const results: ProcessingResult[] = [];

    for (const input of inputs) {
      const result = await this.processEvent(input);
      results.push(result);
      this.processedCount++;
    }

    return results;
  }

  /**
   * 启动处理循环
   */
  private startProcessingLoop(): void {
    const loop = async () => {
      if (!this.isRunning) return;

      try {
        // TODO: 从数据库获取待处理事件
        // const pendingEvents = await db.getPendingEvents(this.config.batchSize);

        // for (const event of pendingEvents) {
        //   await this.processEvent(event);
        // }

        // 模拟处理
        if (this.processingQueue.length > 0) {
          const eventId = this.processingQueue.shift();
          console.log(`[Orchestrator] Processing queued event: ${eventId}`);
        }
      } catch (error) {
        console.error("[Orchestrator] Processing loop error:", error);
      }

      // 继续循环
      if (this.isRunning) {
        setTimeout(loop, this.config.processInterval);
      }
    };

    loop();
  }
}

// ============================================================================
// 单例导出
// ============================================================================

let orchestratorInstance: FoodSafetyOrchestrator | null = null;

export function getOrchestrator(
  config?: Partial<OrchestratorConfig>
): FoodSafetyOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new FoodSafetyOrchestrator(config);
  }
  return orchestratorInstance;
}

export function createOrchestrator(
  config?: Partial<OrchestratorConfig>
): FoodSafetyOrchestrator {
  if (orchestratorInstance) {
    orchestratorInstance.stop();
  }
  orchestratorInstance = new FoodSafetyOrchestrator(config);
  return orchestratorInstance;
}
