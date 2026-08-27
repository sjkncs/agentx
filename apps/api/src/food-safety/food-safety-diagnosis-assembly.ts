/**
 * 喜茶食安诊断 Assembly
 * Food Safety Diagnosis Assembly
 */

export type SeverityLevel = "high" | "medium" | "low";
export type RootCauseCategory = "raw_material" | "production" | "logistics" | "storage" | "packaging" | "unknown";

export interface DiagnosisResult {
  severity: SeverityLevel;
  root_cause: string;
  applicable_standards: string[];
  risk_level: number;
  suggestion: string;
  required_actions: string[];
  notification: {
    to_qa: boolean;
    to_ops: boolean;
    to_legal: boolean;
    to_pr: boolean;
  };
}

export interface DiagnosisInput {
  event_id: string;
  content: string;
  source: string;
  keywords: string[];
  received_at?: string;
}

// ============================================================================
// 诊断标准
// ============================================================================

const APPLICABLE_STANDARDS = {
  // GB 7718 — 预包装食品标签通则
  GB_7718: {
    name: "GB 7718-2011 预包装食品标签通则",
    description: "食品标签、成分表、保质期标示规范",
  },
  // GB 2760 — 食品添加剂使用标准
  GB_2760: {
    name: "GB 2760-2014 食品添加剂使用标准",
    description: "食品添加剂使用范围和限量",
  },
  // GB 29921 — 食品中致病菌限量
  GB_29921: {
    name: "GB 29921-2021 食品中致病菌限量",
    description: "沙门氏菌、金黄色葡萄球菌等致病菌限量标准",
  },
  // 企业 SOP
  SOP_HYGIENE: {
    name: "喜茶门店SOP-个人卫生规范",
    description: "门店操作人员个人卫生要求",
  },
  SOP_COLD_CHAIN: {
    name: "喜茶SOP-冷链管理规范",
    description: "原料及成品冷链储存温度要求",
  },
  SOP_EXPIRY: {
    name: "喜茶SOP-效期管理规范",
    description: "原料及成品效期管理要求",
  },
};

// ============================================================================
// 诊断规则
// ============================================================================

const DIAGNOSIS_RULES: Array<{
  pattern: RegExp;
  severity: SeverityLevel;
  rootCause: RootCauseCategory;
  standards: string[];
  actions: string[];
  riskLevel: number;
  suggestionTemplate: string;
  notify: DiagnosisResult["notification"];
}> = [
  {
    pattern: /金属|玻璃|刀片|针|钢丝|硬币|骨头渣/,
    severity: "high",
    rootCause: "production",
    standards: ["GB 29921-2021", "喜茶SOP-异物控制"],
    actions: ["立即停产相关产品线", "全面排查生产设备", "保留同批次原料", "通知质量总监"],
    riskLevel: 9,
    suggestionTemplate: "高危异物事件，立即启动召回程序，保留现场证据，配合监管部门调查。",
    notify: { to_qa: true, to_ops: true, to_legal: true, to_pr: true },
  },
  {
    pattern: /食物中毒|腹泻|呕吐|就医|医院|身体不适/,
    severity: "high",
    rootCause: "unknown",
    standards: ["GB 29921-2021", "喜茶SOP-食品安全应急"],
    actions: ["立即通知QA总监", "保留同批次原料送检", "配合监管部门调查", "启动消费者安抚程序"],
    riskLevel: 10,
    suggestionTemplate: "疑似食物中毒事件，立即启动食品安全应急预案，通知法务部门。",
    notify: { to_qa: true, to_ops: true, to_legal: true, to_pr: true },
  },
  {
    pattern: /蟑螂|苍蝇|蚊子|虫子|蜘蛛|蚂蚁/,
    severity: "medium",
    rootCause: "storage",
    standards: ["喜茶SOP-门店卫生规范", "GB 7718-2011"],
    actions: ["门店环境全面消杀", "检查防虫设施", "食材全面排查", "加强门店卫生培训"],
    riskLevel: 6,
    suggestionTemplate: "生物异物事件，检查门店卫生状况，加强防虫措施，对相关食材进行排查。",
    notify: { to_qa: true, to_ops: true, to_legal: false, to_pr: false },
  },
  {
    pattern: /头发|指甲|手套/,
    severity: "medium",
    rootCause: "production",
    standards: ["喜茶SOP-个人卫生规范", "GB 7718-2011"],
    actions: ["调取制作监控", "检查当日人员健康证", "对应批次食材排查", "全员个人卫生再培训"],
    riskLevel: 5,
    suggestionTemplate: "操作异物事件，检查当日制作流程，核实操作人员卫生规范执行情况。",
    notify: { to_qa: true, to_ops: true, to_legal: false, to_pr: false },
  },
  {
    pattern: /塑料|橡胶|手套碎|吸管/,
    severity: "medium",
    rootCause: "packaging",
    standards: ["GB 7718-2011", "喜茶SOP-包材管理"],
    actions: ["检查包材质量", "排查设备磨损情况", "加强包材入库检验"],
    riskLevel: 5,
    suggestionTemplate: "包装材料异物事件，检查包材质量和设备状态，加强供应商管理。",
    notify: { to_qa: true, to_ops: true, to_legal: false, to_pr: false },
  },
  {
    pattern: /变质|过期|馊|异味|发酵|膨胀/,
    severity: "medium",
    rootCause: "storage",
    standards: ["喜茶SOP-冷链管理", "喜茶SOP-效期管理", "GB 7718-2011"],
    actions: ["检查冷链完整性", "排查效期管理流程", "检查储存温度记录", "加强效期培训"],
    riskLevel: 6,
    suggestionTemplate: "变质事件，检查冷链温度和效期管理记录，排查储存环节问题。",
    notify: { to_qa: true, to_ops: true, to_legal: false, to_pr: false },
  },
  {
    pattern: /细菌|超标|污染|霉菌|发霉/,
    severity: "high",
    rootCause: "unknown",
    standards: ["GB 29921-2021", "GB 2760-2014", "喜茶SOP-食品安全应急"],
    actions: ["送检第三方实验室", "启动召回程序", "全面排查生产环节", "通知监管部门"],
    riskLevel: 8,
    suggestionTemplate: "微生物超标事件，立即启动食品安全应急预案，配合监管部门调查。",
    notify: { to_qa: true, to_ops: true, to_legal: true, to_pr: true },
  },
  {
    pattern: /抽检|不合格|监管/,
    severity: "high",
    rootCause: "unknown",
    standards: ["GB 2760-2014", "GB 29921-2021", "喜茶SOP-监管配合"],
    actions: ["配合监管部门调查", "分析不合格原因", "整改并提交报告", "追溯同批次产品"],
    riskLevel: 9,
    suggestionTemplate: "监管部门抽检不合格，立即配合调查，分析原因进行整改。",
    notify: { to_qa: true, to_ops: true, to_legal: true, to_pr: true },
  },
];

const ROOT_CAUSE_LABELS: Record<RootCauseCategory, string> = {
  raw_material: "原料端问题（供应商原料不合格）",
  production: "生产端问题（门店操作不规范）",
  logistics: "物流端问题（冷链/配送破损）",
  storage: "储存端问题（门店存储不当）",
  packaging: "包装端问题（包材质量问题）",
  unknown: "需进一步调查",
};

// ============================================================================
// 诊断函数
// ============================================================================

export function diagnose(input: DiagnosisInput): DiagnosisResult {
  const { content, keywords } = input;
  const contentLower = content.toLowerCase();

  // 1. 匹配诊断规则
  let matchedRule = DIAGNOSIS_RULES.find((rule) => rule.pattern.test(contentLower));

  // 2. 如果没有匹配，根据关键词推断
  if (!matchedRule && keywords.length > 0) {
    const kwText = keywords.join(" ");
    matchedRule = DIAGNOSIS_RULES.find((rule) => rule.pattern.test(kwText));
  }

  // 3. 默认诊断（低风险）
  if (!matchedRule) {
    return {
      severity: "low",
      root_cause: "需进一步调查确认",
      applicable_standards: ["喜茶SOP-食品安全规范"],
      risk_level: 2,
      suggestion: "事件内容不涉及明确食安风险，建议持续关注。如有恶化趋势可升级处理。",
      required_actions: ["持续监控", "如有新进展则升级"],
      notification: { to_qa: false, to_ops: false, to_legal: false, to_pr: false },
    };
  }

  // 4. 构建诊断结果
  const rootCauseText = ROOT_CAUSE_LABELS[matchedRule.rootCause];

  // 根据关键词微调根因
  let finalRootCause = rootCauseText;
  if (/头发|指甲/.test(contentLower)) {
    finalRootCause = "门店操作人员未正确佩戴帽子或操作不规范";
  } else if (/冷链|温度|冰/.test(contentLower)) {
    finalRootCause = "冷链储存温度异常或门店储存不当";
  } else if (/配送|外卖|快递/.test(contentLower)) {
    finalRootCause = "配送环节温控或物理保护不足";
  }

  return {
    severity: matchedRule.severity,
    root_cause: finalRootCause,
    applicable_standards: matchedRule.standards,
    risk_level: matchedRule.riskLevel,
    suggestion: matchedRule.suggestionTemplate,
    required_actions: matchedRule.actions,
    notification: matchedRule.notify,
  };
}

// ============================================================================
// Assembly 导出
// ============================================================================

export const foodSafetyDiagnosisAssembly = {
  name: "food-safety-diagnosis",
  version: "1.0.0",

  async process(input: DiagnosisInput): Promise<DiagnosisResult> {
    return diagnose(input);
  },
};
