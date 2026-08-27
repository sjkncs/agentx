/**
 * 网易七鱼 Webhook 处理器
 * NetEase Qiyu Webhook Handler
 *
 * 网易七鱼客服系统 Webhook 接入
 * 文档: https://qiyukf.com/docs
 */

export interface QiyuWebhookPayload {
  /** 会话 ID */
  sessionId?: string;
  /** 消息内容 */
  message?: string;
  /** 用户名称 */
  userName?: string;
  /** 用户 ID */
  userId?: string;
  /** 机器人 ID */
  robotId?: string;
  /** 技能组 ID */
  skillId?: string;
  /** 消息类型: text/image/audio/file/custom */
  msgType?: string;
  /** 消息时间戳(毫秒) */
  timestamp?: number;
  /** 消息 ID */
  msgId?: string;
  /** 开发者自定义数据 */
  callbackData?: string;
  /** 满意度评价星级 */
  satisfactionLevel?: number;
}

export interface QiyuMessage {
  type: "text" | "image" | "audio" | "file" | "custom";
  content: string;
  url?: string;
  userName?: string;
  userId?: string;
  timestamp: string;
}

/**
 * 喜茶食安相关关键词
 * 用于在接入时进行初步过滤
 */
const HEYTEA_FOOD_SAFETY_KEYWORDS = [
  "喜茶",
  "食安",
  "变质",
  "异物",
  "头发",
  "虫子",
  "投诉",
  "赔偿",
  "退款",
  "卫生",
  "腹泻",
  "中毒",
  "拉肚子",
  "肚子疼",
  "就医",
  "医院",
  "食品",
  "喝到",
  "吃到",
  "奶茶",
  "波波",
  "芋泥",
];

/**
 * 从七鱼 Webhook 解析事件
 */
export function parseQiyuWebhook(
  body: unknown
): { source: string; raw_content: string; author?: string; platform: string; received_at: string; metadata: Record<string, unknown> } | null {
  try {
    const payload = body as QiyuWebhookPayload;

    if (!payload.message && !payload.callbackData) {
      console.warn("[Qiyu] Empty message, skipping");
      return null;
    }

    const message = payload.message || payload.callbackData || "";

    // 初步检查是否可能与喜茶相关
    if (!containsHeyteaKeywords(message)) {
      console.debug("[Qiyu] Message does not contain Heytea keywords, skipping");
      return null;
    }

    const author = payload.userName || payload.userId;

    return {
      source: "qiyu",
      raw_content: message,
      ...(author ? { author } : {}),
      platform: "qiyu",
      received_at: payload.timestamp
        ? new Date(payload.timestamp).toISOString()
        : new Date().toISOString(),
      metadata: {
        session_id: payload.sessionId,
        user_id: payload.userId,
        robot_id: payload.robotId,
        skill_id: payload.skillId,
        msg_type: payload.msgType,
        msg_id: payload.msgId,
        satisfaction_level: payload.satisfactionLevel,
      },
    };
  } catch (error) {
    console.error("[Qiyu] Failed to parse webhook:", error);
    return null;
  }
}

/**
 * 检查消息是否包含喜茶相关关键词
 */
function containsHeyteaKeywords(content: string): boolean {
  const lowerContent = content.toLowerCase();
  return HEYTEA_FOOD_SAFETY_KEYWORDS.some((kw) =>
    lowerContent.includes(kw.toLowerCase())
  );
}

/**
 * 解析七鱼消息历史
 * 用于从会话历史中提取完整上下文
 */
export function parseQiyuMessageHistory(
  messages: QiyuMessage[]
): string {
  return messages
    .filter((m) => m.type === "text")
    .map((m) => {
      const author = m.userName || m.userId || "未知用户";
      const time = new Date(m.timestamp).toLocaleString("zh-CN");
      return `[${time}] ${author}: ${m.content}`;
    })
    .join("\n");
}

/**
 * 生成七鱼 Webhook 响应
 */
export function generateQiyuResponse(
  success: boolean,
  message?: string
): { code: number; message: string } {
  return {
    code: success ? 200 : 500,
    message: message || (success ? "success" : "failed"),
  };
}

/**
 * 验证七鱼 Webhook 签名
 * 七鱼使用 HMAC-SHA256 签名
 */
export async function verifyQiyuSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  if (!secret) {
    console.warn("[Qiyu] No secret configured, skipping signature verification");
    return true;
  }

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
  } catch (error) {
    console.error("[Qiyu] Signature verification failed:", error);
    return false;
  }
}

/**
 * 从七鱼会话提取食安相关信息
 */
export function extractFoodSafetyInfo(
  payload: QiyuWebhookPayload
): {
  orderId?: string;
  storeId?: string;
  productName?: string;
  issueType?: string;
} {
  const info: ReturnType<typeof extractFoodSafetyInfo> = {};
  const content = payload.message || "";

  // 提取订单号 (常见格式: 订单号: xxx, 订单: xxx, #xxx)
  const orderMatch = content.match(/订单[号:]?\s*([A-Z0-9]{8,20})/i);
  if (orderMatch?.[1]) {
    info.orderId = orderMatch[1];
  }

  // 提取门店 ID (常见格式: 门店: xxx, 店铺: xxx)
  const storeMatch = content.match(/门店[号:]?\s*([A-Z0-9]+)/i);
  if (storeMatch?.[1]) {
    info.storeId = storeMatch[1];
  }

  // 提取产品名称
  const productKeywords = ["奶茶", "波波", "芋泥", "水果茶", "纯茶", "冰淇淋"];
  for (const kw of productKeywords) {
    if (content.includes(kw)) {
      info.productName = kw;
      break;
    }
  }

  // 提取问题类型
  if (/异物|头发|虫子/.test(content)) {
    info.issueType = "foreign_matter";
  } else if (/变质|过期|馊/.test(content)) {
    info.issueType = "spoilage";
  } else if (/态度|等待|服务/.test(content)) {
    info.issueType = "service";
  }

  return info;
}
