/**
 * 喜茶食安回复模板
 * Reply templates for Heytea food safety events
 */

export type SeverityLevel = "high" | "medium" | "low";
export type ReplyType = "auto_send" | "need_review" | "escalate";
export type CompensationType = "refund" | "coupon" | "cash" | "gift" | "none";

export interface ReplyTemplate {
  type: ReplyType;
  templates: {
    greeting: string;
    apology: string;
    action: string;
    compensation: string;
    closing: string;
  };
  escalationKeywords: string[];
}

export interface CompensationTemplate {
  type: CompensationType;
  amount?: string;
  reason: string;
  threshold: {
    min: number;
    max: number;
  };
}

/**
 * 严重程度对应的补偿模板
 */
export const COMPENSATION_TEMPLATES: Record<SeverityLevel, CompensationTemplate> = {
  high: {
    type: "cash",
    reason: "严重食安事件",
    threshold: { min: 300, max: 1000 },
  },
  medium: {
    type: "coupon",
    reason: "一般食安投诉",
    threshold: { min: 30, max: 200 },
  },
  low: {
    type: "coupon",
    reason: "轻微问题",
    threshold: { min: 10, max: 50 },
  },
};

/**
 * 回复模板库
 */
export const REPLY_TEMPLATES: Record<string, ReplyTemplate> = {
  foreign_matter: {
    type: "auto_send",
    templates: {
      greeting: "亲爱的顾客，您好！",
      apology: "非常抱歉给您带来了如此不愉快的体验，我们对食品中出现异物深感歉意。",
      action: "我们已立即通知相关部门对门店进行全面检查，并调取制作监控核实情况。",
      compensation: "我们为您准备了相应的补偿，感谢您的理解与支持。",
      closing: "我们会持续加强门店操作规范培训，杜绝此类情况再次发生。如有疑问，请随时联系我们的客服团队。",
    },
    escalationKeywords: ["就医", "医院", "身体不适", "中毒", "法律", "律师"],
  },

  spoilage: {
    type: "auto_send",
    templates: {
      greeting: "亲爱的顾客，您好！",
      apology: "非常抱歉您收到的产品存在变质问题，我们对此深感歉意。",
      action: "我们将立即调查原因，并加强配送环节的冷链管理。",
      compensation: "我们为您准备了全额退款和下次消费优惠券。",
      closing: "感谢您的反馈，我们会不断改进服务品质。",
    },
    escalationKeywords: ["腹泻", "呕吐", "就医"],
  },

  complaint: {
    type: "auto_send",
    templates: {
      greeting: "亲爱的顾客，您好！",
      apology: "感谢您的反馈，我们对给您带来的不便深感抱歉。",
      action: "我们已将您的问题记录并反馈给相关部门。",
      compensation: "我们为您准备了一份小礼品或优惠券作为感谢。",
      closing: "期待下次为您带来更好的服务体验！",
    },
    escalationKeywords: ["媒体", "曝光", "投诉多次", "律师函"],
  },

  consultation: {
    type: "auto_send",
    templates: {
      greeting: "亲爱的顾客，您好！",
      apology: "",
      action: "",
      compensation: "",
      closing: "如有其他问题，欢迎随时咨询。谢谢！",
    },
    escalationKeywords: [],
  },
};

/**
 * 生成完整回复内容
 */
export function generateReply(
  template: ReplyTemplate,
  params: {
    customerName?: string;
    orderId?: string;
    compensation?: string;
  } = {}
): string {
  const parts: string[] = [];

  if (template.templates.greeting) {
    parts.push(template.templates.greeting);
  }

  if (template.templates.apology) {
    parts.push(template.templates.apology);
  }

  if (template.templates.action) {
    parts.push(template.templates.action);
  }

  if (template.templates.compensation && params.compensation) {
    parts.push(`${template.templates.compensation} ${params.compensation}`);
  }

  if (template.templates.closing) {
    parts.push(template.templates.closing);
  }

  return parts.join("\n\n");
}

/**
 * 检查是否需要升级
 */
export function shouldEscalate(content: string, template: ReplyTemplate): boolean {
  const lowerContent = content.toLowerCase();
  return template.escalationKeywords.some((keyword) =>
    lowerContent.includes(keyword)
  );
}

/**
 * 根据严重程度获取补偿方案
 */
export function getCompensation(
  severity: SeverityLevel,
  customerRequest?: string
): CompensationTemplate {
  const template = COMPENSATION_TEMPLATES[severity];

  // 如果客户有具体请求，尝试匹配
  if (customerRequest) {
    const amountMatch = customerRequest.match(/\d+/);
    if (amountMatch) {
      const requestedAmount = parseInt(amountMatch[0], 10);
      if (requestedAmount > template.threshold.max) {
        // 超过阈值，需要升级
        return {
          ...template,
          type: "cash",
          reason: "需人工审核",
        };
      }
    }
  }

  return template;
}

/**
 * 升级判断
 */
export function determineEscalation(
  content: string,
  severity: SeverityLevel
): {
  shouldEscalate: boolean;
  reason?: string;
} {
  // 高严重程度默认升级
  if (severity === "high") {
    return {
      shouldEscalate: true,
      reason: "高严重程度食安事件，需法务和QA介入",
    };
  }

  // 检查关键词
  const escalationKeywords = [
    "就医",
    "医院",
    "身体不适",
    "中毒",
    "法律",
    "律师",
    "媒体",
    "曝光",
    "投诉多次",
    "腹泻",
    "呕吐",
  ];

  for (const keyword of escalationKeywords) {
    if (content.includes(keyword)) {
      return {
        shouldEscalate: true,
        reason: `检测到关键词「${keyword}」，需人工审核`,
      };
    }
  }

  return { shouldEscalate: false };
}
