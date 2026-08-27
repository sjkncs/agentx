/**
 * 喜茶食安事件 Webhook 处理器
 * Food Safety Event Webhook Handler
 */

import type {
  CreateInboxEventInput,
  FoodSafetyInboxEvent,
} from "./food-safety-types.js";

export interface WebhookPayload {
  source: string;
  event_type?: string;
  content: string;
  author?: string;
  platform?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface WebhookResult {
  success: boolean;
  event_id?: string;
  error?: string;
}

/**
 * 验证 Webhook 请求签名
 * 实际实现需要根据七鱼或其他平台的签名算法
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  // TODO: 实现实际签名验证
  // 例如：HMAC-SHA256(secret, payload) === signature
  if (!secret) return true; // 开发环境跳过验证

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(payload)
    );

    const expected = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return expected === signature;
  } catch {
    return false;
  }
}

/**
 * 解析不同来源的 Webhook payload
 */
export function parseWebhookPayload(
  source: string,
  body: unknown
): CreateInboxEventInput | null {
  try {
    const data = body as Record<string, unknown>;

    switch (source) {
      case "qiyu":
        return parseQiyuPayload(data);
      case "sentiment":
        return parseSentimentPayload(data);
      case "regulatory":
        return parseRegulatoryPayload(data);
      case "internal":
        return parseInternalPayload(data);
      default:
        return parseGenericPayload(data);
    }
  } catch (error) {
    console.error("[FoodSafety] Failed to parse webhook payload:", error);
    return null;
  }
}

/**
 * 解析网易七鱼 Webhook payload
 * 七鱼文档: https://qiyukf.com/docs
 */
function parseQiyuPayload(data: Record<string, unknown>): CreateInboxEventInput {
  const content =
    typeof data.content === "string"
      ? data.content
      : typeof data.message === "string"
        ? data.message
        : JSON.stringify(data);

  const author =
    typeof data.userName === "string"
      ? data.userName
      : typeof data.nickname === "string"
        ? data.nickname
        : typeof data.user_id === "string"
          ? data.user_id
          : undefined;

  return {
    source: "qiyu",
    raw_content: content,
    ...(author ? { author } : {}),
    platform: "qiyu",
    received_at: data.timestamp
      ? new Date(Number(data.timestamp)).toISOString()
      : new Date().toISOString(),
    metadata: {
      session_id: data.sessionId,
      robot_id: data.robotId,
      skill_id: data.skillId,
      ...data,
    },
  };
}

/**
 * 解析舆情监控 Webhook payload
 */
function parseSentimentPayload(
  data: Record<string, unknown>
): CreateInboxEventInput {
  const content =
    typeof data.content === "string"
      ? data.content
      : typeof data.text === "string"
        ? data.text
        : typeof data.title === "string"
          ? `${data.title}\n${data.body || ""}`
          : JSON.stringify(data);

  const authorName = data.author as string | undefined;

  return {
    source: "sentiment",
    raw_content: content,
    ...(authorName ? { author: authorName } : {}),
    platform: (data.platform as string) || "unknown",
    received_at: data.publish_time
      ? new Date(String(data.publish_time)).toISOString()
      : new Date().toISOString(),
    metadata: {
      post_id: data.postId,
      url: data.url,
      likes: data.likes,
      shares: data.shares,
      comments: data.comments,
      sentiment: data.sentiment,
      ...data,
    },
    tags: extractTags(data),
  };
}

/**
 * 解析监管公告 Webhook payload
 */
function parseRegulatoryPayload(
  data: Record<string, unknown>
): CreateInboxEventInput {
  const content =
    typeof data.content === "string"
      ? data.content
      : typeof data.notice === "string"
        ? data.notice
        : typeof data.title === "string"
          ? `${data.title}\n${data.body || data.content || ""}`
          : JSON.stringify(data);

  return {
    source: "regulatory",
    raw_content: content,
    received_at: data.publish_time
      ? new Date(String(data.publish_time)).toISOString()
      : new Date().toISOString(),
    metadata: {
      department: data.department,
      notice_type: data.noticeType,
      product_name: data.productName,
      brand: data.brand,
      violation: data.violation,
      ...data,
    },
    tags: ["监管公告", "抽检"],
  };
}

/**
 * 解析内部 QMS 系统 Webhook payload
 */
function parseInternalPayload(
  data: Record<string, unknown>
): CreateInboxEventInput {
  const content =
    typeof data.description === "string"
      ? data.description
      : typeof data.content === "string"
        ? data.content
        : JSON.stringify(data);

  const reporter = data.reporter as string | undefined;

  return {
    source: "internal",
    raw_content: content,
    ...(reporter ? { author: reporter } : {}),
    received_at: data.occurred_at
      ? new Date(String(data.occurred_at)).toISOString()
      : new Date().toISOString(),
    metadata: {
      incident_id: data.incidentId,
      department: data.department,
      store_id: data.storeId,
      severity: data.severity,
      ...data,
    },
    tags: ["内部报告"],
  };
}

/**
 * 解析通用 Webhook payload
 */
function parseGenericPayload(
  data: Record<string, unknown>
): CreateInboxEventInput {
  const content =
    typeof data.content === "string"
      ? data.content
      : typeof data.message === "string"
        ? data.message
        : typeof data.text === "string"
          ? data.text
          : JSON.stringify(data);

  const authorName = data.author as string | undefined;

  return {
    source: "webhook",
    raw_content: content,
    ...(authorName ? { author: authorName } : {}),
    received_at: new Date().toISOString(),
    metadata: data,
  };
}

/**
 * 从 payload 中提取标签
 */
function extractTags(data: Record<string, unknown>): string[] {
  const tags: string[] = [];

  // 从 keywords 字段提取
  if (Array.isArray(data.keywords)) {
    tags.push(...data.keywords.slice(0, 5));
  }

  // 从 category 字段提取
  if (typeof data.category === "string") {
    tags.push(data.category);
  }

  // 自动添加来源标签
  if (data.platform) {
    tags.push(String(data.platform));
  }

  return [...new Set(tags)];
}

/**
 * 检查 payload 是否包含食安相关关键词
 */
export function containsFoodSafetyKeywords(
  content: string,
  keywords: string[] = DEFAULT_FOOD_SAFETY_KEYWORDS
): boolean {
  const lowerContent = content.toLowerCase();
  return keywords.some((kw) => lowerContent.includes(kw.toLowerCase()));
}

/**
 * 默认食安关键词列表
 */
export const DEFAULT_FOOD_SAFETY_KEYWORDS = [
  "喜茶",
  "食安",
  "变质",
  "异物",
  "头发",
  "虫子",
  "投诉",
  "赔偿",
  "餐厅",
  "食品",
  "卫生",
  "腹泻",
  "中毒",
];

/**
 * 过滤低优先级事件
 */
export function shouldProcessEvent(
  input: CreateInboxEventInput
): boolean {
  // 如果没有内容，不处理
  if (!input.raw_content || input.raw_content.trim().length === 0) {
    return false;
  }

  // 舆情来源只处理包含食安关键词的事件
  if (input.source === "sentiment") {
    return containsFoodSafetyKeywords(input.raw_content);
  }

  // 其他来源的事件都处理
  return true;
}
