/**
 * 喜茶食安意图分类 Assembly
 * Food Safety Intent Classification Assembly
 */

export type FoodSafetyIntent = "food_safety_risk" | "consultation_complaint" | "irrelevant";
export type UrgencyLevel = "high" | "medium" | "low" | "none";

export interface IntentClassificationResult {
  intent: FoodSafetyIntent;
  confidence: number;
  reason: string;
  keywords: string[];
  urgency: UrgencyLevel;
}

export interface FoodSafetyEvent {
  id?: string;
  content: string;
  source: "sentiment" | "qiyu" | "regulatory" | "internal" | "manual" | "webhook";
  received_at?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// 食安风险关键词
// ============================================================================

const FOOD_SAFETY_KEYWORDS = [
  "异物", "头发", "虫子", "蟑螂", "苍蝇", "金属", "玻璃", "塑料",
  "变质", "过期", "馊", "异味", "发霉", "膨胀",
  "食物中毒", "腹泻", "呕吐", "恶心", "肚子疼",
  "抽检", "不合格", "超标", "污染", "细菌",
  "添加剂", "色素", "防腐剂",
  "生产日期", "保质期", "虚假",
  "食安", "食品安全", "卫生",
];

const COMPLAINT_KEYWORDS = [
  "投诉", "不满", "态度", "等待", "排队",
  "退款", "赔偿", "索赔", "优惠券",
  "口感", "味道", "温度", "冰量", "甜度",
  "服务", "店员", "门店", "包装",
];

const IRRELEVANT_KEYWORDS = [
  "招聘", "加盟", "合作", "开店",
  "地址", "门店地址", "营业时间",
  "礼品卡", "会员", "积分",
  "竞品", "喜茶", "对比",
  "广告", "宣传", "活动",
];

// ============================================================================
// 意图分类
// ============================================================================

export function classifyIntent(event: FoodSafetyEvent): IntentClassificationResult {
  const content = event.content.toLowerCase();
  const allText = content + " " + (event.metadata?.raw_text || "");

  // 1. 检查食安风险
  const foodSafetyScore = FOOD_SAFETY_KEYWORDS.reduce((score, kw) => {
    return score + (allText.includes(kw) ? 2 : 0);
  }, 0);

  // 2. 检查投诉
  const complaintScore = COMPLAINT_KEYWORDS.reduce((score, kw) => {
    return score + (allText.includes(kw) ? 1 : 0);
  }, 0);

  // 3. 检查无关
  const irrelevantScore = IRRELEVANT_KEYWORDS.reduce((score, kw) => {
    return score + (allText.includes(kw) ? 1 : 0);
  }, 0);

  // 4. 提取关键词
  const matchedKeywords = [
    ...FOOD_SAFETY_KEYWORDS.filter((kw) => allText.includes(kw)),
    ...COMPLAINT_KEYWORDS.filter((kw) => allText.includes(kw)),
  ].slice(0, 5);

  // 5. 判断意图
  let intent: FoodSafetyIntent;
  let confidence: number;
  let reason: string;
  let urgency: UrgencyLevel;

  // 规则1：食物中毒相关直接高优先级食安风险
  if (/食物中毒|中毒|腹泻|呕吐|就医|医院/.test(allText)) {
    intent = "food_safety_risk";
    confidence = 0.95;
    reason = "检测到身体不适症状";
    urgency = "high";
  }
  // 规则2：金属/玻璃异物直接高优先级
  else if (/金属|玻璃|刀片|针|钢丝/.test(allText)) {
    intent = "food_safety_risk";
    confidence = 0.95;
    reason = "检测到高危异物类型";
    urgency = "high";
  }
  // 规则3：生物异物（头发、虫子等）
  else if (/头发|虫子|蟑螂|苍蝇|蟑螂|蜘蛛/.test(allText)) {
    intent = "food_safety_risk";
    confidence = 0.9;
    reason = "食品中发现生物异物";
    urgency = "medium";
  }
  // 规则4：其他食安关键词
  else if (foodSafetyScore >= 2) {
    intent = "food_safety_risk";
    confidence = 0.75 + Math.min(foodSafetyScore * 0.05, 0.2);
    reason = `检测到${foodSafetyScore}个食安相关关键词`;
    urgency = "medium";
  }
  // 规则5：监管部门来源直接归类
  else if (event.source === "regulatory") {
    intent = "food_safety_risk";
    confidence = 0.9;
    reason = "来自监管部门的公告";
    urgency = "high";
  }
  // 规则6：仅是投诉
  else if (complaintScore > 0 && foodSafetyScore === 0) {
    intent = "consultation_complaint";
    confidence = 0.7 + Math.min(complaintScore * 0.1, 0.25);
    reason = `检测到${complaintScore}个投诉相关关键词`;
    urgency = "low";
  }
  // 规则7：无关内容
  else if (irrelevantScore >= 1 && foodSafetyScore === 0 && complaintScore === 0) {
    intent = "irrelevant";
    confidence = 0.8;
    reason = "内容与食安无关";
    urgency = "none";
  }
  // 默认：无法确定时作为咨询投诉
  else {
    intent = "consultation_complaint";
    confidence = 0.5;
    reason = "无法明确分类，默认作为咨询投诉处理";
    urgency = "low";
  }

  return {
    intent,
    confidence: Math.min(confidence, 0.99),
    reason,
    keywords: matchedKeywords,
    urgency,
  };
}

// ============================================================================
// Assembly 导出
// ============================================================================

export const foodSafetyIntentAssembly = {
  name: "food-safety-intent",
  version: "1.0.0",

  async process(event: FoodSafetyEvent): Promise<IntentClassificationResult> {
    return classifyIntent(event);
  },
};
