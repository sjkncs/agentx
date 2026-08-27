/**
 * 喜茶食安 API 路由
 * Food Safety API Routes
 */

import type { InboxStats, CreateInboxEventInput } from "./food-safety-types.js";
import { classifyIntent } from "./food-safety-intent-assembly.js";
import { diagnose } from "./food-safety-diagnosis-assembly.js";
import { generateReply } from "./food-safety-reply-assembly.js";
import {
  parseWebhookPayload,
  shouldProcessEvent,
  type WebhookPayload,
} from "./webhook-handler.js";

// ============================================================================
// 类型定义
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface CreateEventResponse {
  event_id: string;
  intent?: string;
  confidence?: number;
  action: "process" | "ignore";
}

export interface FoodSafetyStats {
  stats: InboxStats;
  recent_events: number;
  avg_response_time?: string;
}

// ============================================================================
// 事件处理函数
// ============================================================================

/**
 * 创建并处理食安事件
 */
export async function createFoodSafetyEvent(
  input: CreateInboxEventInput
): Promise<CreateEventResponse> {
  // 1. 检查是否需要处理
  if (!shouldProcessEvent(input)) {
    return {
      event_id: "",
      action: "ignore",
    };
  }

  // 2. 生成事件 ID
  const eventId = `fsf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  // 3. 意图分类
  const intentResult = classifyIntent({
    content: input.raw_content,
    source: input.source,
  });

  // 4. 如果是无关内容，跳过处理
  if (intentResult.intent === "irrelevant") {
    return {
      event_id: eventId,
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      action: "ignore",
    };
  }

  // 5. 诊断分析
  const diagnosisResult = diagnose({
    event_id: eventId,
    content: input.raw_content,
    source: input.source,
    keywords: intentResult.keywords,
  });

  // 6. 生成回复
  const replyResult = generateReply({
    type: intentResult.intent === "food_safety_risk" ? "food_safety_risk" : "consultation_complaint",
    severity: diagnosisResult.severity,
    content: input.raw_content,
  });

  // 7. 构建事件数据
  const event = {
    id: eventId,
    source: input.source,
    raw_content: input.raw_content,
    parsed_content: input.parsed_content,
    author: input.author,
    platform: input.platform,
    received_at: input.received_at || new Date().toISOString(),
    status: replyResult.reply_type === "escalate" ? "escalated" : "pending",
    intent: intentResult.intent,
    intent_confidence: intentResult.confidence,
    intent_reason: intentResult.reason,
    severity: diagnosisResult.severity,
    root_cause: diagnosisResult.root_cause,
    risk_level: diagnosisResult.risk_level,
    reply_content: replyResult.reply_content,
    reply_status: replyResult.reply_type === "escalate" ? "pending" : "pending",
    metadata: input.metadata,
    tags: input.tags,
  };

  // 8. TODO: 保存到数据库
  // await saveToDatabase(event);

  console.log(`[FoodSafety] Event created: ${eventId}`, {
    intent: intentResult.intent,
    severity: diagnosisResult.severity,
    action: replyResult.ticket_action,
  });

  return {
    event_id: eventId,
    intent: intentResult.intent,
    confidence: intentResult.confidence,
    action: "process",
  };
}

/**
 * 处理 Webhook 请求
 */
export async function handleWebhook(
  source: string,
  body: unknown
): Promise<ApiResponse<{ event_id: string }>> {
  try {
    // 1. 解析 Webhook payload
    const eventInput = parseWebhookPayload(source, body);

    if (!eventInput) {
      return {
        success: false,
        error: "Failed to parse webhook payload",
      };
    }

    // 2. 创建事件
    const result = await createFoodSafetyEvent(eventInput);

    if (result.action === "ignore") {
      return {
        success: true,
        data: { event_id: result.event_id },
        message: "Event ignored (irrelevant content)",
      };
    }

    return {
      success: true,
      data: { event_id: result.event_id },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[FoodSafety] Webhook error:", message);
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * 查询事件状态
 */
export async function getEventStatus(
  eventId: string
): Promise<ApiResponse<{ status: string; case_no?: string }>> {
  // TODO: 从数据库查询
  // const event = await db.findEvent(eventId);

  return {
    success: true,
    data: {
      status: "pending",
      // case_no: event.case_no,
    },
  };
}

/**
 * 获取统计信息
 */
export async function getFoodSafetyStats(): Promise<ApiResponse<FoodSafetyStats>> {
  // TODO: 从数据库查询统计信息
  // const stats = await db.getStats();

  const stats: InboxStats = {
    total: 0,
    pending: 0,
    processing: 0,
    done: 0,
    escalated: 0,
    ignored: 0,
    by_source: {
      sentiment: 0,
      qiyu: 0,
      regulatory: 0,
      internal: 0,
      manual: 0,
      webhook: 0,
    },
    by_intent: {
      food_safety_risk: 0,
      consultation_complaint: 0,
      irrelevant: 0,
    },
    by_severity: {
      high: 0,
      medium: 0,
      low: 0,
    },
  };

  return {
    success: true,
    data: {
      stats,
      recent_events: 0,
    },
  };
}

/**
 * 手动创建事件
 */
export async function manualCreateEvent(
  content: string,
  metadata?: Record<string, unknown>
): Promise<ApiResponse<CreateEventResponse>> {
  try {
    const result = await createFoodSafetyEvent({
      source: "manual",
      raw_content: content,
      received_at: new Date().toISOString(),
      ...(metadata ? { metadata } : {}),
    });

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * 分类测试接口
 */
export async function classifyEvent(
  content: string
): Promise<ApiResponse<{
  intent: ReturnType<typeof classifyIntent>;
  diagnosis: ReturnType<typeof diagnose>;
  reply: ReturnType<typeof generateReply>;
}>> {
  try {
    const intent = classifyIntent({ content, source: "manual" });
    const diagnosis = diagnose({
      event_id: "test",
      content,
      source: "manual",
      keywords: intent.keywords,
    });
    const reply = generateReply({
      type: intent.intent === "food_safety_risk" ? "food_safety_risk" : "consultation_complaint",
      severity: diagnosis.severity,
      content,
    });

    return {
      success: true,
      data: { intent, diagnosis, reply },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: message,
    };
  }
}
