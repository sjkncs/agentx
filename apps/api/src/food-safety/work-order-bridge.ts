/**
 * 喜茶食安工单桥接器
 * Food Safety Work Order Bridge
 *
 * 将食安事件转换为工单，对接 Inngest 工作流引擎
 */

import type { SeverityLevel } from "./food-safety-types.js";
import type { DiagnosisResult } from "./food-safety-diagnosis-assembly.js";
import type { ReplyResult } from "./food-safety-reply-assembly.js";

export interface WorkOrderPayload {
  case_no?: string;
  work_order_id?: string;
  event_id: string;
  priority: "urgent" | "high" | "medium" | "low";
  category: string;
  body: string;
  risk_level: number;
  source: string;
  customer_name?: string;
  store_id?: string;
  order_id?: string;
  intent: string;
  severity: SeverityLevel;
  root_cause?: string;
  applicable_standards?: string[];
  suggestion?: string;
  reply_content?: string;
  escalation_reason?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkOrderResult {
  success: boolean;
  work_order_id?: string;
  case_no?: string;
  error?: string;
}

// ============================================================================
// 工单类型映射
// ============================================================================

const PRIORITY_MAP: Record<SeverityLevel, WorkOrderPayload["priority"]> = {
  high: "urgent",
  medium: "high",
  low: "medium",
};

const CATEGORY_MAP: Record<string, string> = {
  foreign_matter: "异物投诉",
  spoilage: "变质投诉",
  poisoning: "食物中毒",
  contamination: "污染事件",
  regulatory: "监管公告",
  complaint: "一般投诉",
  consultation: "咨询",
};

// ============================================================================
// 工单创建
// ============================================================================

/**
 * 创建食安工单
 */
export async function createFoodSafetyWorkOrder(
  eventId: string,
  intent: string,
  diagnosis: DiagnosisResult,
  reply: ReplyResult,
  metadata?: {
    customerName?: string;
    storeId?: string;
    orderId?: string;
    source?: string;
  }
): Promise<WorkOrderResult> {
  try {
    // 1. 生成工单号
    const caseNo = generateCaseNo();
    const workOrderId = `wo_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

    // 2. 构建工单内容
    const body = buildWorkOrderBody(intent, diagnosis, reply, metadata);

    // 3. 构建工单 payload
    const payload: WorkOrderPayload = {
      work_order_id: workOrderId,
      case_no: caseNo,
      event_id: eventId,
      priority: PRIORITY_MAP[diagnosis.severity],
      category: getCategory(intent, diagnosis),
      body,
      risk_level: diagnosis.risk_level,
      source: metadata?.source || "food-safety-system",
      intent,
      severity: diagnosis.severity,
      ...(metadata?.customerName ? { customer_name: metadata.customerName } : {}),
      ...(metadata?.storeId ? { store_id: metadata.storeId } : {}),
      ...(metadata?.orderId ? { order_id: metadata.orderId } : {}),
      ...(diagnosis.root_cause ? { root_cause: diagnosis.root_cause } : {}),
      ...(diagnosis.applicable_standards.length > 0 ? { applicable_standards: diagnosis.applicable_standards } : {}),
      ...(diagnosis.suggestion ? { suggestion: diagnosis.suggestion } : {}),
      reply_content: reply.reply_content,
      ...(reply.escalation_reason ? { escalation_reason: reply.escalation_reason } : {}),
      metadata: {
        ...metadata,
        diagnosis_result: diagnosis,
        reply_result: reply,
      },
    };

    // 4. 发送到 Inngest
    const result = await sendToInngest(payload);

    if (result.success) {
      console.log(`[WorkOrderBridge] Work order created: ${caseNo}`, {
        workOrderId,
        eventId,
        priority: payload.priority,
      });
    }

    const workOrderResult: WorkOrderResult = {
      success: result.success,
      work_order_id: workOrderId,
      case_no: caseNo,
    };
    if (result.error) {
      workOrderResult.error = result.error;
    }
    return workOrderResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[WorkOrderBridge] Failed to create work order:", message);
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * 生成工单号
 * 格式: FSF-YYYYMMDD-XXXX (4位序号)
 */
function generateCaseNo(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const seq = String(Math.floor(Math.random() * 9999)).padStart(4, "0");
  return `FSF-${dateStr}-${seq}`;
}

/**
 * 获取工单类别
 */
function getCategory(
  intent: string,
  diagnosis: DiagnosisResult
): string {
  if (intent === "irrelevant") {
    return "无关";
  }

  if (diagnosis.applicable_standards.some((s) => s.includes("监管"))) {
    return "监管公告";
  }

  const rootCause = diagnosis.root_cause || "";
  const content = `${intent} ${rootCause}`.toLowerCase();

  if (/中毒|腹泻|呕吐/.test(content)) {
    return "食物中毒";
  }
  if (/异物|头发|虫子|金属|玻璃/.test(content)) {
    return "异物投诉";
  }
  if (/变质|过期|霉菌/.test(content)) {
    return "变质投诉";
  }
  if (/细菌|超标|污染/.test(content)) {
    return "污染事件";
  }

  return intent === "food_safety_risk" ? "食安投诉" : "一般投诉";
}

/**
 * 构建工单正文
 */
function buildWorkOrderBody(
  intent: string,
  diagnosis: DiagnosisResult,
  reply: ReplyResult,
  metadata?: {
    customerName?: string;
    storeId?: string;
    orderId?: string;
  }
): string {
  const lines: string[] = [];

  // 标题
  lines.push(`## 食安事件工单`);
  lines.push(``);

  // 基本信息
  lines.push(`### 基本信息`);
  lines.push(`| 项目 | 内容 |`);
  lines.push(`|------|------|`);
  if (metadata?.customerName) {
    lines.push(`| 顾客姓名 | ${metadata.customerName} |`);
  }
  if (metadata?.storeId) {
    lines.push(`| 门店ID | ${metadata.storeId} |`);
  }
  if (metadata?.orderId) {
    lines.push(`| 订单号 | ${metadata.orderId} |`);
  }
  lines.push(`| 意图分类 | ${intent} |`);
  lines.push(`| 严重程度 | ${diagnosis.severity} |`);
  lines.push(`| 风险等级 | ${diagnosis.risk_level}/10 |`);
  lines.push(``);

  // 根因分析
  lines.push(`### 根因分析`);
  lines.push(diagnosis.root_cause);
  lines.push(``);

  // 适用标准
  if (diagnosis.applicable_standards.length > 0) {
    lines.push(`### 适用标准`);
    for (const standard of diagnosis.applicable_standards) {
      lines.push(`- ${standard}`);
    }
    lines.push(``);
  }

  // 处置建议
  lines.push(`### 处置建议`);
  lines.push(diagnosis.suggestion);
  lines.push(``);

  // 必做事项
  if (diagnosis.required_actions.length > 0) {
    lines.push(`### 必做事项`);
    for (const action of diagnosis.required_actions) {
      lines.push(`- [ ] ${action}`);
    }
    lines.push(``);
  }

  // 建议通知
  const notifyList = Object.entries(diagnosis.notification)
    .filter(([, should]) => should)
    .map(([dept]) => dept.replace("to_", "").toUpperCase());

  if (notifyList.length > 0) {
    lines.push(`### 建议通知`);
    lines.push(notifyList.join(", "));
    lines.push(``);
  }

  // 自动回复内容
  if (reply.reply_content) {
    lines.push(`### 自动回复内容`);
    lines.push(`> ${reply.reply_content.replace(/\n/g, "\n> ")}`);
    lines.push(``);
  }

  // 升级原因
  if (reply.escalation_reason) {
    lines.push(`### 升级原因`);
    lines.push(reply.escalation_reason);
    lines.push(``);
  }

  // 内部备注
  if (reply.internal_note) {
    lines.push(`### 内部备注`);
    lines.push(reply.internal_note);
    lines.push(``);
  }

  // 元信息
  lines.push(`---`);
  lines.push(`*由 AgentX 食安系统自动生成 | ${new Date().toLocaleString("zh-CN")}*`);

  return lines.join("\n");
}

// ============================================================================
// Inngest 集成
// ============================================================================

/**
 * 发送工单到 Inngest
 */
async function sendToInngest(payload: WorkOrderPayload): Promise<{ success: boolean; error?: string }> {
  // TODO: 接入实际 Inngest
  // 参照 services/inngest-bridge/src/dispatchers/work-order-notify.ts

  try {
    // 模拟发送
    console.log("[WorkOrderBridge] Would send to Inngest:", {
      case_no: payload.case_no,
      priority: payload.priority,
      category: payload.category,
    });

    // 实际实现示例:
    // const inngest = new InngestClient({ id: "agentx-food-safety" });
    // await inngest.send({
    //   name: "fsf/work-order-created",
    //   data: payload,
    // });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

/**
 * 处理工单完成事件
 */
export async function handleWorkOrderCompleted(
  workOrderId: string,
  result: {
    status: "resolved" | "closed" | "escalated";
    resolved_at?: string;
    notes?: string;
  }
): Promise<void> {
  console.log(`[WorkOrderBridge] Work order ${workOrderId} completed:`, result);

  // TODO: 更新数据库中的事件状态
  // await db.updateEventStatus(workOrderId, result.status);

  // TODO: 发送通知给相关人员
  // await sendCompletionNotification(workOrderId, result);
}

/**
 * 获取工单 SLA 状态
 */
export function getSlaStatus(
  severity: SeverityLevel,
  createdAt: Date
): {
  status: "ok" | "warning" | "breached";
  remaining?: number;
  elapsed: number;
  sla_hours: number;
} {
  const slaHours = {
    high: 2,
    medium: 8,
    low: 24,
  }[severity];

  const now = new Date();
  const elapsedMs = now.getTime() - createdAt.getTime();
  const elapsedHours = elapsedMs / (1000 * 60 * 60);
  const remainingHours = slaHours - elapsedHours;

  let status: "ok" | "warning" | "breached";
  if (remainingHours < 0) {
    status = "breached";
  } else if (remainingHours < slaHours * 0.2) {
    status = "warning";
  } else {
    status = "ok";
  }

  return {
    status,
    ...(status !== "breached" ? { remaining: Math.round(remainingHours * 60) } : {}),
    elapsed: Math.round(elapsedHours * 60),
    sla_hours: slaHours,
  };
}
