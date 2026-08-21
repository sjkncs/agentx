/**
 * xicha-session-recorder.ts — A28 喜茶食安 Supabase 会话持久化
 *
 * 职责：
 *   1. 把用户消息 + Agent 回复写到 datafoundry.fsf_messages
 *   2. 把高风险升级的工单真正写入 datafoundry.fsf_work_orders
 *   3. 把消息和工单事件落到 datafoundry.dfd_audit_events（兜底审计）
 *
 * 不抛异常：写失败时 console.warn 跳过，保证 Agent 流程不中断。
 */

import {
  createFoodSafetyClient,
  type FoodSafetyClient,
  type FsfMessage,
  type FsfWorkOrder,
  type RiskLevel,
} from "./supabase-food-safety.js";

// ─────────────────────────────────────────────────────────────
// Audit-event minimal shape — 仅写入 dfd_audit_events 兜底通道
// ─────────────────────────────────────────────────────────────

interface AuditInsert {
  auditTable: string;
  payload: Record<string, unknown>;
  client: FoodSafetyClient;
}

const AUDIT_WRITE_TIMEOUT_MS = 2000;

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race<T>([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function writeAudit(row: AuditInsert): Promise<void> {
  try {
    // Reuse supabase food_safety client (already service_role bound) to write to dfd_audit_events
    // via direct REST POST. The auth/columns are inherited from 003_food_safety_schema.sql.
    // Falls back silently on timeout/error so the agent never blocks on audit writes.
    const url = process.env.SUPABASE_URL ?? "";
    const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
    if (!url || !key) return;

    const res = await withTimeout(
      fetch(`${url}/rest/v1/dfd_audit_events`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          workspace_id: "xicha-default",
          actor_id: "agent:xicha-fsd",
          category: "food_safety",
          severity: "info",
          action: row.auditTable,
          target: row.payload.case_no ?? row.payload.conversation_id ?? null,
          payload: row.payload,
        }),
      }),
      AUDIT_WRITE_TIMEOUT_MS,
      new Response(null, { status: 0 }),
    );
    if (!res.ok && res.status !== 0) {
      // Non-fatal: log + return
      console.warn(`[xicha-session-recorder] audit write failed: HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[xicha-session-recorder] audit write threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─────────────────────────────────────────────────────────────
// SessionRecorder
// ─────────────────────────────────────────────────────────────

export interface SessionRecorderDeps {
  foodSafetyClient?: FoodSafetyClient;
}

export interface SessionRecorder {
  readonly enabled: boolean;
  appendUserMessage(input: { conversationId: string; content: string; metadata?: Record<string, unknown> }): Promise<void>;
  appendAssistantMessage(input: {
    conversationId: string;
    content: string;
    intent?: string;
    subIntent?: string | null;
    riskLevel?: string | null;
    auditStatus?: "pass" | "warn" | "block";
    auditViolations?: string[];
    latencyMs?: number;
    workOrderId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  createWorkOrder(input: {
    conversationId: string;
    userId: number | string;
    category: string;
    subCategory?: string;
    description: string;
    riskLevel?: RiskLevel;
    storeInfo?: { store_id?: string; store_name?: string; address?: string };
    orderInfo?: { order_no?: string; items?: string[]; amount?: number };
  }): Promise<FsfWorkOrder | null>;
}

class StubSessionRecorder implements SessionRecorder {
  readonly enabled = false;
  async appendUserMessage(): Promise<void> { /* noop */ }
  async appendAssistantMessage(): Promise<void> { /* noop */ }
  async createWorkOrder(): Promise<null> { return null; }
}

class SupabaseSessionRecorder implements SessionRecorder {
  readonly enabled = true;
  constructor(private readonly client: FoodSafetyClient) {}

  async appendUserMessage(input: { conversationId: string; content: string; metadata?: Record<string, unknown> }): Promise<void> {
    const msg: FsfMessage = {
      conversation_id: input.conversationId,
      role: "user",
      content: input.content,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    try {
      await this.client.appendMessage(msg);
    } catch (err) {
      console.warn(`[xicha-session-recorder] appendUserMessage failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    await writeAudit({
      auditTable: "xicha_message_user",
      client: this.client,
      payload: { conversation_id: input.conversationId, content_preview: input.content.slice(0, 80), ...(input.metadata ?? {}) },
    });
  }

  async appendAssistantMessage(input: {
    conversationId: string;
    content: string;
    intent?: string;
    subIntent?: string | null;
    riskLevel?: string | null;
    auditStatus?: "pass" | "warn" | "block";
    auditViolations?: string[];
    latencyMs?: number;
    workOrderId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const msg: FsfMessage = {
      conversation_id: input.conversationId,
      role: "assistant",
      content: input.content,
      ...(input.intent ? { intent: input.intent } : {}),
      ...(input.subIntent ? { sub_intent: input.subIntent } : {}),
      ...(input.riskLevel ? { risk_level: input.riskLevel as RiskLevel } : {}),
      ...(input.auditStatus ? { audit_status: input.auditStatus } : {}),
      ...(input.auditViolations ? { audit_violations: input.auditViolations } : {}),
      ...(input.latencyMs !== undefined ? { token_count: undefined as unknown as number, latency_ms: input.latencyMs } : {}),
      ...(input.metadata ? { metadata: { ...input.metadata, work_order_id: input.workOrderId } } : {}),
    };
    if (!input.latencyMs) delete (msg as { token_count?: number }).token_count; // omit when absent
    try {
      await this.client.appendMessage(msg);
    } catch (err) {
      console.warn(`[xicha-session-recorder] appendAssistantMessage failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    await writeAudit({
      auditTable: "xicha_message_assistant",
      client: this.client,
      payload: {
        conversation_id: input.conversationId,
        intent: input.intent ?? null,
        sub_intent: input.subIntent ?? null,
        risk_level: input.riskLevel ?? null,
        audit_status: input.auditStatus ?? null,
        work_order_id: input.workOrderId ?? null,
        latency_ms: input.latencyMs ?? null,
      },
    });
  }

  async createWorkOrder(input: {
    conversationId: string;
    userId: number | string;
    category: string;
    subCategory?: string;
    description: string;
    riskLevel?: RiskLevel;
    storeInfo?: { store_id?: string; store_name?: string; address?: string };
    orderInfo?: { order_no?: string; items?: string[]; amount?: number };
  }): Promise<FsfWorkOrder | null> {
    const userIdNum = typeof input.userId === "string" ? Number.parseInt(input.userId, 10) || 0 : input.userId;
    const wo: FsfWorkOrder = {
      case_no: generateCaseNo(),
      conversation_id: input.conversationId,
      user_id: userIdNum,
      category: input.category,
      sub_category: input.subCategory ?? null,
      description: input.description,
      risk_level: input.riskLevel ?? "medium",
      status: "open",
      stage: "reported",
      ...(input.storeInfo ? { store_info: { ...input.storeInfo } } : {}),
      ...(input.orderInfo ? { order_info: { ...input.orderInfo } } : {}),
    };
    try {
      const created = await this.client.createWorkOrder(wo);
      await writeAudit({
        auditTable: "xicha_work_order_created",
        client: this.client,
        payload: {
          case_no: created.case_no,
          conversation_id: created.conversation_id,
          category: created.category,
          risk_level: created.risk_level,
        },
      });
      return created;
    } catch (err) {
      console.warn(`[xicha-session-recorder] createWorkOrder failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}

function generateCaseNo(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const seq = String(Math.floor(Math.random() * 999) + 1).padStart(3, "0");
  return `FSW-${dateStr}-${seq}`;
}

export function createSessionRecorder(): SessionRecorder {
  const client = createFoodSafetyClient();
  if (!client.enabled) return new StubSessionRecorder();
  return new SupabaseSessionRecorder(client);
}
