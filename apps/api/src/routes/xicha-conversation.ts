/**
 * xicha-conversation.ts — A28 喜茶食安对话 HTTP API
 *
 * 提供 2 个端点：
 *   POST /api/v1/agent/xicha/conversation  用户消息 → XichaFSDAgent.process()
 *   GET  /api/v1/agent/xicha/health        健康检查
 *
 * 不在这里写业务逻辑 — 全部委托给 XichaFSDAgent，
 * 本文件只负责：HTTP 解析 + envelope 形成 + 错误处理
 */

import { createErrorResult, createSuccessResult } from "@datafoundry/contracts";
import { randomUUID } from "node:crypto";

import { XichaFSDAgent } from "@datafoundry/agent-runtime";
import type { XichaFSDAgentInput, XichaFSDAgentResult } from "@datafoundry/agent-runtime";

import type { FoodSafetyClient } from "../supabase-food-safety.js";

import type { ConfigApiResponse } from "./types.js";

// ───── Types ──────────────────────────────────────────────────

interface ConversationRequestBody {
  message?: string;
  conversation_id?: string;
  store_info?: {
    store_id?: string;
    store_name?: string;
    address?: string;
  };
  order_info?: {
    order_no?: string;
    items?: string[];
    amount?: number;
  };
  metadata?: Record<string, unknown>;
}

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "");
}

function isPathConversation(pathname: string): boolean {
  return normalizePath(pathname) === "/api/v1/agent/xicha/conversation";
}

function isPathHealth(pathname: string): boolean {
  return normalizePath(pathname) === "/api/v1/agent/xicha/health";
}

// ──── Agent Factory ───────────────────────────────────────────

export interface AgentFactory {
  isEnabled(): boolean;
  build(): XichaFSDAgent | null; // sync — must already be initialized at startup
}

let _agentFactory: AgentFactory | undefined;

function buildDefaultAgentFactory(deps: { foodSafetyClient?: FoodSafetyClient }): AgentFactory {
  const enabled = !!(deps.foodSafetyClient && deps.foodSafetyClient.enabled);
  let cachedAgent: XichaFSDAgent | null = null;
  return {
    isEnabled: () => enabled,
    build: () => {
      if (cachedAgent) return cachedAgent;
      if (!enabled) return null;
      try {
        const sessionId = `xicha-fsd-${randomUUID()}`;
        cachedAgent = new XichaFSDAgent({
          sessionId,
          workspaceId: "xicha-default",
          userId: "0",
          enableAudit: true,
          enableSessionLog: true,
        });
        return cachedAgent;
      } catch (err) {
        console.warn(`[xicha-conversation] failed to construct XichaFSDAgent: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },
  };
}

/** Allow tests to inject a prebuilt agent. */
export function setXichaAgentFactory(factory: AgentFactory | undefined): void {
  _agentFactory = factory;
}

// ──── Health endpoint ─────────────────────────────────────────

interface HandleHealthDeps {
  foodSafetyClient?: FoodSafetyClient;
  agentFactory?: AgentFactory;
}

function buildHealthResponse(deps: HandleHealthDeps): ConfigApiResponse {
  const factory = deps.agentFactory ?? _agentFactory ?? buildDefaultAgentFactory({
    ...(deps.foodSafetyClient ? { foodSafetyClient: deps.foodSafetyClient } : {}),
  });
  return {
    status: 200,
    body: createSuccessResult({
      ok: true,
      agent: "XichaFSDAgent",
      supabase_enabled: factory.isEnabled(),
      ts: new Date().toISOString(),
    }),
  };
}

// ──── POST /api/v1/agent/xicha/conversation ────────────────────

interface HandleConversationDeps {
  foodSafetyClient?: FoodSafetyClient;
  agentFactory?: AgentFactory;
}

export async function handleXichaConversationRequest(
  request: import("node:http").IncomingMessage,
  pathname: string,
  body: unknown,
  deps: HandleConversationDeps = {},
): Promise<ConfigApiResponse | null> {
  if (isPathHealth(pathname)) {
    if (request.method !== "GET") {
      return {
        status: 405,
        body: createErrorResult("BAD_REQUEST", "Method not allowed."),
      };
    }
    return buildHealthResponse(deps);
  }

  if (!isPathConversation(pathname)) {
    return null;
  }

  if (request.method !== "POST") {
    return {
      status: 405,
      body: createErrorResult("BAD_REQUEST", "Method not allowed."),
    };
  }

  const reqBody = (body ?? {}) as ConversationRequestBody;
  const message = (reqBody.message ?? "").trim();

  if (!message) {
    return {
      status: 400,
      body: createErrorResult("BAD_REQUEST", "Missing required field: message"),
    };
  }
  if (message.length > 4000) {
    return {
      status: 400,
      body: createErrorResult("BAD_REQUEST", "Message too long (max 4000 chars)"),
    };
  }

  const factory = deps.agentFactory
    ?? _agentFactory
    ?? buildDefaultAgentFactory({
      ...(deps.foodSafetyClient ? { foodSafetyClient: deps.foodSafetyClient } : {}),
    });
  if (!factory.isEnabled()) {
    return {
      status: 503,
      body: createErrorResult(
        "NOT_ENABLED",
        "Xicha food safety agent requires SUPABASE_URL + SUPABASE_SERVICE_KEY to be configured.",
      ),
    };
  }

  const agent = factory.build();
  if (!agent) {
    return {
      status: 503,
      body: createErrorResult("NOT_READY", "Failed to construct XichaFSDAgent"),
    };
  }

  const userId = (request.headers["x-user-id"] as string | undefined) ?? "0";
  const conversationId =
    reqBody.conversation_id
    ?? (request.headers["x-conversation-id"] as string | undefined)
    ?? `conv-${randomUUID()}`;

  const input: XichaFSDAgentInput = {
    message,
    conversationId,
    context: {
      ...(reqBody.store_info ? { store_info: reqBody.store_info } : {}),
      ...(reqBody.order_info ? { order_info: reqBody.order_info } : {}),
      ...(reqBody.metadata ? reqBody.metadata : {}),
      userId,
    },
  };

  const { createSessionRecorder } = await import("../xicha-session-recorder.js");
  const recorder = createSessionRecorder();
  await recorder.appendUserMessage({
    conversationId,
    content: message,
    metadata: { store_info: reqBody.store_info, order_info: reqBody.order_info },
  });

  let result: XichaFSDAgentResult;
  try {
    result = await agent.process(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: 500,
      body: createErrorResult("AGENT_EXECUTION_ERROR", msg),
    };
  }

  if (result.auditedReply) {
    await recorder.appendAssistantMessage({
      conversationId,
      content: result.auditedReply,
      ...(result.intent !== undefined ? { intent: result.intent } : {}),
      ...(result.subIntent !== undefined ? { subIntent: result.subIntent } : {}),
      ...(result.riskLevel !== undefined ? { riskLevel: result.riskLevel } : {}),
      ...(result.workOrderId !== undefined ? { workOrderId: result.workOrderId } : {}),
      auditStatus: "pass",
      latencyMs: result.durationMs,
    });
  }

  let workOrderPersisted = false;
  let caseNoPersisted: string | undefined;

  if (result.workOrderId && result.caseNo && result.intent === "food_safety") {
    const wo = await recorder.createWorkOrder({
      conversationId,
      userId,
      category: result.subIntent ?? "other",
      description: message,
      ...(result.riskLevel ? { riskLevel: result.riskLevel as "high" | "medium" | "low" } : {}),
      ...(reqBody.store_info ? { storeInfo: reqBody.store_info } : {}),
      ...(reqBody.order_info ? { orderInfo: reqBody.order_info } : {}),
    });
    if (wo) {
      workOrderPersisted = true;
      caseNoPersisted = wo.case_no;
    }

    const { getXichaEventBus } = await import("../xicha-event-bus.js");
    const bus = getXichaEventBus();
    bus.emit("work_order.created", {
      conversation_id: conversationId,
      case_no: caseNoPersisted ?? result.caseNo,
      work_order_id: result.workOrderId,
      category: result.subIntent ?? "other",
      risk_level: result.riskLevel ?? "medium",
    });
    bus.emit("compensation.generate", {
      conversation_id: conversationId,
      case_no: caseNoPersisted ?? result.caseNo,
      work_order_id: result.workOrderId,
      category: result.subIntent ?? "other",
      risk_level: result.riskLevel ?? "medium",
    });
  }

  const auditStatus = (result.subagentResults as { audit?: { status?: string } } | undefined)?.audit?.status ?? null;
  return {
    status: 200,
    body: createSuccessResult({
      ok: result.success,
      conversationId,
      intent: result.intent,
      subIntent: result.subIntent,
      riskLevel: result.riskLevel,
      auditStatus,
      reply: result.auditedReply ?? null,
      caseNo: caseNoPersisted ?? result.caseNo ?? null,
      workOrderId: result.workOrderId ?? null,
      workOrderPersisted,
      durationMs: result.durationMs,
      error: result.error,
    }),
  };
}

// Re-export so server.ts can use it as a route probe
export const XICHA_PATHS = ["/api/v1/agent/xicha/conversation", "/api/v1/agent/xicha/health"] as const;
