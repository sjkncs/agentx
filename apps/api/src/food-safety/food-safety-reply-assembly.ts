/**
 * 喜茶食安回复 Assembly
 * Food Safety Reply Assembly
 */

export type ReplyType = "auto_send" | "need_review" | "escalate";
export type CompensationType = "refund" | "coupon" | "cash" | "gift" | "none";
export type TicketAction = "close" | "follow_up" | "escalate";

export interface ReplyResult {
  reply_type: ReplyType;
  reply_content: string;
  compensation: {
    type: CompensationType;
    amount?: string;
    reason: string;
  };
  ticket_action: TicketAction;
  internal_note: string;
  escalation_reason?: string;
}

export interface ReplyInput {
  type: "food_safety_risk" | "consultation_complaint";
  severity?: "high" | "medium" | "low";
  content: string;
  customer_name?: string;
  order_id?: string;
}

// ============================================================================
// 回复模板
// ============================================================================

const REPLY_TEMPLATES = {
  // 高优先级食安风险回复
  high_risk: {
    greeting: "亲爱的顾客，您好！",
    apology: "非常抱歉给您带来了如此不愉快的体验，我们对食品中出现的问题深感歉意。",
    action: "我们已立即启动调查程序，对相关门店进行全面检查。您反映的问题已被标记为最高优先级处理。",
    compensation: "我们已为您准备了专项补偿，感谢您的耐心和理解。",
    closing: "您的健康和安全是我们的首要责任。我们会持续加强门店管理，杜绝此类问题再次发生。如有任何疑问，请随时联系我们。",
  },

  // 中等优先级食安回复
  medium_risk: {
    greeting: "亲爱的顾客，您好！",
    apology: "非常抱歉您遇到了这样的问题，我们对此深感歉意。",
    action: "我们已将您的问题反馈给相关部门，将对门店进行全面检查和整改。",
    compensation: "作为补偿，我们为您准备了相应的礼品或优惠券。",
    closing: "感谢您的理解与支持，我们会不断改进服务品质。如需进一步帮助，请联系我们的客服团队。",
  },

  // 一般投诉回复
  complaint: {
    greeting: "亲爱的顾客，您好！",
    apology: "感谢您的反馈，对于给您带来的不便，我们深感抱歉。",
    action: "我们已将您的问题记录并反馈给相关部门跟进处理。",
    compensation: "感谢您的宝贵意见，我们为您准备了一份小礼品。",
    closing: "期待下次为您带来更好的服务体验！如有其他问题，欢迎随时联系我们。",
  },

  // 咨询回复
  consultation: {
    greeting: "亲爱的顾客，您好！",
    apology: "",
    action: "感谢您的咨询，以下是您需要的信息：",
    compensation: "",
    closing: "如有任何其他问题，欢迎随时咨询。谢谢！",
  },
};

// ============================================================================
// 升级关键词
// ============================================================================

const ESCALATION_KEYWORDS = [
  "就医", "医院", "身体不适", "中毒", "法律", "律师",
  "媒体", "曝光", "投诉多次", "索赔金额", "巨额",
  "腹泻", "呕吐", "恶心", "食物中毒",
];

const NEED_REVIEW_KEYWORDS = [
  "赔偿", "退款", "优惠券", "1000", "2000", "5000",
  "媒体报道", "社交媒体", "微博", "小红书",
  "过敏", "红肿", "瘙痒",
];

// ============================================================================
// 回复生成函数
// ============================================================================

export function generateReply(input: ReplyInput): ReplyResult {
  const { type, severity = "low", content, customer_name, order_id } = input;
  const contentLower = content.toLowerCase();

  // 1. 检查是否需要升级
  const escalationKeywords = ESCALATION_KEYWORDS.some((kw) => contentLower.includes(kw));
  const needReviewKeywords = NEED_REVIEW_KEYWORDS.some((kw) => contentLower.includes(kw));

  // 2. 选择模板
  let template: typeof REPLY_TEMPLATES.complaint;
  if (type === "food_safety_risk") {
    if (severity === "high") {
      template = REPLY_TEMPLATES.high_risk;
    } else {
      template = REPLY_TEMPLATES.medium_risk;
    }
  } else {
    template = REPLY_TEMPLATES.complaint;
  }

  // 3. 构建回复内容
  const replyParts: string[] = [];

  if (template.greeting) {
    if (customer_name) {
      replyParts.push(`亲爱的 ${customer_name}，您好！`);
    } else {
      replyParts.push(template.greeting);
    }
  }

  if (template.apology) {
    replyParts.push(template.apology);
  }

  if (template.action) {
    replyParts.push(template.action);
  }

  // 添加具体处置信息
  if (type === "food_safety_risk") {
    replyParts.push("\n【我们正在采取的措施】\n1. 问题已记录并启动调查\n2. 相关门店将进行全面检查\n3. 我们会持续向您更新进展");
  }

  if (template.compensation) {
    const compensation = getCompensation(type, severity);
    replyParts.push(`\n【补偿方案】\n${compensation}`);
  }

  if (template.closing) {
    replyParts.push(`\n${template.closing}`);
  }

  if (order_id) {
    replyParts.push(`\n\n工单编号：${order_id}`);
  }

  // 4. 判断回复类型和工单操作
  let reply_type: ReplyType = "auto_send";
  let ticket_action: TicketAction = "follow_up";
  let escalation_reason = "";
  let internal_note = "";

  if (escalationKeywords || severity === "high") {
    reply_type = "escalate";
    ticket_action = "escalate";
    escalation_reason = escalationKeywords
      ? "检测到升级关键词（就医/身体不适/法律等）"
      : "高严重程度食安事件";
    internal_note = `⚠️ 升级处理 - ${escalation_reason}。请立即通知QA总监和法务部门。`;
  } else if (needReviewKeywords) {
    reply_type = "need_review";
    ticket_action = "follow_up";
    internal_note = "涉及金额较大或可能引发舆情，需要人工审核后再发送。";
  } else {
    internal_note = "普通食安投诉，已自动生成回复，等待发送确认。";
  }

  const escalationReasonStr = escalation_reason || "";

  return {
    reply_type,
    reply_content: replyParts.join("\n\n"),
    compensation: getCompensationDetails(type, severity),
    ticket_action,
    internal_note,
    ...(escalation_reason ? { escalation_reason: escalationReasonStr } : {}),
  };
}

// ============================================================================
// 补偿方案
// ============================================================================

function getCompensation(type: string, severity: string): string {
  if (type === "food_safety_risk") {
    switch (severity) {
      case "high":
        return "全额退款 + 现金补偿 + 后续医疗费用报销";
      case "medium":
        return "全额退款 + 50元礼品券 + 下次消费8折券";
      case "low":
        return "全额退款 + 30元礼品券";
      default:
        return "全额退款";
    }
  } else {
    return "根据实际情况提供优惠券或礼品作为感谢";
  }
}

function getCompensationDetails(
  type: string,
  severity: string
): ReplyResult["compensation"] {
  if (type === "food_safety_risk") {
    switch (severity) {
      case "high":
        return { type: "cash", amount: "待定（包含医疗费用）", reason: "高严重程度食安事件" };
      case "medium":
        return { type: "coupon", amount: "50元", reason: "食品中出现异物" };
      case "low":
        return { type: "coupon", amount: "30元", reason: "一般食安问题" };
      default:
        return { type: "refund", reason: "全额退款" };
    }
  } else {
    return { type: "gift", reason: "感谢反馈" };
  }
}

// ============================================================================
// Assembly 导出
// ============================================================================

export const foodSafetyReplyAssembly = {
  name: "food-safety-reply",
  version: "1.0.0",

  async process(input: ReplyInput): Promise<ReplyResult> {
    return generateReply(input);
  },
};
