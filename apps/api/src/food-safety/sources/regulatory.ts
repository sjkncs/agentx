/**
 * 监管部门公告处理器
 * Regulatory Notice Handler
 *
 * 接入食药监局、市场监管局等监管部门的抽检公告
 */

import type { CreateInboxEventInput } from "../food-safety-types.js";

export interface RegulatoryNotice {
  /** 发布部门 */
  department: string;
  /** 公告类型: 抽检公告/召回通知/风险预警 */
  notice_type: "inspection" | "recall" | "risk_warning" | "other";
  /** 产品名称 */
  product_name: string;
  /** 品牌 */
  brand?: string;
  /** 生产企业 */
  manufacturer?: string;
  /** 不合格项目 */
  violation?: string;
  /** 处置措施 */
  measures?: string;
  /** 公告时间 */
  publish_time: string;
  /** 公告链接 */
  url?: string;
}

export interface RegulatoryConfig {
  /** 监管部门列表 */
  departments: string[];
  /** 是否启用 */
  enabled: boolean;
  /** Webhook 密钥 */
  webhookSecret?: string;
}

export const DEFAULT_REGULATORY_CONFIG: RegulatoryConfig = {
  departments: [
    "国家市场监督管理总局",
    "国家食品安全风险评估中心",
    "省级市场监督管理局",
    "市级市场监督管理局",
    "食品药品监督管理局",
  ],
  enabled: true,
};

// ============================================================================
// 监管公告解析
// ============================================================================

/**
 * 解析监管公告 Webhook payload
 */
export function parseRegulatoryWebhook(
  body: unknown
): CreateInboxEventInput | null {
  try {
    const payload = body as Record<string, unknown>;

    if (!payload.content && !payload.notice && !payload.title) {
      console.warn("[Regulatory] Empty payload, skipping");
      return null;
    }

    const content =
      typeof payload.content === "string"
        ? payload.content
        : typeof payload.notice === "string"
          ? payload.notice
          : `${payload.title || ""}\n${payload.body || ""}`;

    // 解析公告类型
    const noticeType = detectNoticeType(content, payload.noticeType as string);

    return {
      source: "regulatory",
      raw_content: content,
      received_at: payload.publish_time
        ? new Date(String(payload.publish_time)).toISOString()
        : new Date().toISOString(),
      metadata: {
        department: payload.department,
        notice_type: noticeType,
        product_name: payload.product_name,
        brand: payload.brand,
        manufacturer: payload.manufacturer,
        violation: payload.violation,
        measures: payload.measures,
        url: payload.url,
        ...payload,
      },
      tags: ["监管公告", noticeType],
    };
  } catch (error) {
    console.error("[Regulatory] Failed to parse webhook:", error);
    return null;
  }
}

/**
 * 检测公告类型
 */
function detectNoticeType(
  content: string,
  hint?: string
): "抽检公告" | "召回通知" | "风险预警" | "其他" {
  if (hint) {
    const lowerHint = hint.toLowerCase();
    if (lowerHint.includes("抽检") || lowerHint.includes("inspection")) {
      return "抽检公告";
    }
    if (lowerHint.includes("召回") || lowerHint.includes("recall")) {
      return "召回通知";
    }
    if (lowerHint.includes("风险") || lowerHint.includes("warning")) {
      return "风险预警";
    }
  }

  const lowerContent = content.toLowerCase();

  if (/抽检|抽样检验|专项抽检|监督抽检/.test(content)) {
    return "抽检公告";
  }
  if (/召回|回收|下架|停售/.test(content)) {
    return "召回通知";
  }
  if (/风险|预警|警示|注意/.test(content)) {
    return "风险预警";
  }

  return "其他";
}

/**
 * 检查公告是否与喜茶相关
 */
export function isHeyteaRelated(notice: RegulatoryNotice): boolean {
  const haystack = [
    notice.product_name,
    notice.brand,
    notice.manufacturer,
    notice.violation,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // 喜茶相关关键词
  const heyteaKeywords = [
    "喜茶",
    "heytea",
    "奈雪",
    "奶茶",
    "茶饮",
    "现制茶饮",
    "新茶饮",
  ];

  return heyteaKeywords.some((kw) => haystack.includes(kw.toLowerCase()));
}

/**
 * 检查公告是否涉及食品安全问题
 */
export function isFoodSafetyIssue(notice: RegulatoryNotice): boolean {
  const haystack = [
    notice.product_name,
    notice.violation,
    notice.measures,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // 食安问题关键词
  const foodSafetyKeywords = [
    "菌落总数",
    "大肠菌群",
    "金黄色葡萄球菌",
    "沙门氏菌",
    "霉菌",
    "酵母",
    "防腐剂",
    "色素",
    "添加剂",
    "超标",
    "不合格",
    "异物",
    "污染",
    "变质",
    "过期",
  ];

  return foodSafetyKeywords.some((kw) => haystack.includes(kw));
}

/**
 * 评估监管公告严重程度
 */
export function assessRegulatorySeverity(notice: RegulatoryNotice): "high" | "medium" | "low" {
  const content = [
    notice.product_name,
    notice.violation,
    notice.measures,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // 高风险指标
  const highRiskPatterns = [
    /中毒|食物中毒|致病菌|沙门氏菌|金黄色葡萄球菌/,
    /细菌超标|微生物超标|严重超标/,
    /婴幼儿|儿童|特殊人群/,
    /死亡|住院|重症/,
  ];

  for (const pattern of highRiskPatterns) {
    if (pattern.test(content)) {
      return "high";
    }
  }

  // 中风险指标
  const mediumRiskPatterns = [
    /菌落总数超标|大肠菌群超标/,
    /霉菌超标|酵母超标/,
    /添加剂超标|色素超标/,
    /抽检不合格/,
  ];

  for (const pattern of mediumRiskPatterns) {
    if (pattern.test(content)) {
      return "medium";
    }
  }

  // 默认低风险
  return "low";
}

// ============================================================================
// 监管公告转事件
// ============================================================================

/**
 * 将监管公告转换为 Inbox 事件
 */
export function regulatoryNoticeToEvent(
  notice: RegulatoryNotice
): CreateInboxEventInput | null {
  // 检查是否与喜茶相关
  if (!isHeyteaRelated(notice) && !isFoodSafetyIssue(notice)) {
    return null;
  }

  const severity = assessRegulatorySeverity(notice);

  const content = [
    notice.product_name && `产品: ${notice.product_name}`,
    notice.brand && `品牌: ${notice.brand}`,
    notice.manufacturer && `生产企业: ${notice.manufacturer}`,
    notice.violation && `不合格项目: ${notice.violation}`,
    notice.measures && `处置措施: ${notice.measures}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    source: "regulatory",
    raw_content: content,
    received_at: notice.publish_time,
    metadata: {
      department: notice.department,
      notice_type: notice.notice_type,
      product_name: notice.product_name,
      brand: notice.brand,
      manufacturer: notice.manufacturer,
      violation: notice.violation,
      measures: notice.measures,
      url: notice.url,
      regulatory_severity: severity,
    },
    tags: ["监管公告", notice.notice_type, severity],
  };
}
