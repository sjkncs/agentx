/**
 * xicha-event-bus.ts — A28 喜茶事件总线（work_order.* → Inngest）
 *
 * 职责：
 *   1. 提供 emit(eventName, payload) — 内部触发事件
 *   2. 把"喜茶食安"事件（如 work_order.created / compensation.generate）投递到
 *      a. datafoundry.dfd_audit_events（兜底，always）
 *      b. datafoundry.fsf_inngest_events（如果 Supabase 可用）
 *   3. 通过 fetch 调用 Inngest dispatch gateway（如果配置了 INNGEST_DISPATCH_URL）
 *
 * 设计原则：emit 不抛异常；emit 完全 fire-and-forget 异步执行
 */

export type XichaEventName =
  | "work_order.created"
  | "work_order.escalated"
  | "work_order.stage_changed"
  | "work_order.compensation_approved"
  | "compensation.generate"
  | "escalation.dispatch"
  | "script.render"
  | "notification.dispatch"
  | "xicha.message.user"
  | "xicha.message.assistant"
  | "xicha.session.completed";

export interface XichaEventPayload {
  conversation_id?: string;
  case_no?: string;
  work_order_id?: string | number;
  category?: string;
  sub_category?: string;
  risk_level?: string;
  sla_deadline?: string;
  intent?: string;
  sub_intent?: string;
  payload?: Record<string, unknown>;
}

const EMIT_TIMEOUT_MS = 2500;

function envVar(name: string): string {
  return process.env[name] ?? "";
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race<T>([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function postToSupabaseAudit(payload: {
  event_name: string;
  case_no?: string;
  conversation_id?: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const url = envVar("SUPABASE_URL");
  const key = envVar("SUPABASE_SERVICE_KEY") || envVar("SUPABASE_ANON_KEY");
  if (!url || !key) return;

  try {
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
          category: "xicha_event",
          severity: payload.event_name.endsWith("created") ? "warning" : "info",
          action: payload.event_name,
          target: payload.case_no ?? payload.conversation_id ?? null,
          payload: payload.payload,
        }),
      }),
      EMIT_TIMEOUT_MS,
      new Response(null, { status: 0 }),
    );
    if (!res.ok && res.status !== 0) {
      console.warn(`[xicha-event-bus] audit POST failed HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[xicha-event-bus] audit threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function postToSupabaseInngestQueue(eventName: string, payload: XichaEventPayload): Promise<void> {
  // For backward compat with our existing 005_inngest_gate_rpcs.sql RPC enqueue_compensation / enqueue_notification.
  // We map payload → RPC args best-effort.
  const url = envVar("SUPABASE_URL");
  const key = envVar("SUPABASE_SERVICE_KEY") || envVar("SUPABASE_ANON_KEY");
  if (!url || !key) return;

  let rpcBody: Record<string, unknown> | null = null;
  if (eventName === "compensation.generate" && payload.case_no) {
    rpcBody = {
      rpc: "rpc_inngest_enqueue_compensation",
      body: {
        p_work_order_id: String(payload.work_order_id ?? payload.case_no),
        p_category: payload.category ?? "general",
        p_sub_category: payload.sub_category ?? null,
        p_risk_level: payload.risk_level ?? "medium",
      },
    };
  } else if (eventName === "escalation.dispatch" && payload.case_no) {
    rpcBody = {
      rpc: "rpc_inngest_enqueue_escalation",
      body: {
        p_work_order_id: String(payload.work_order_id ?? payload.case_no),
        p_category: payload.category ?? "general",
        p_risk_level: payload.risk_level ?? "medium",
      },
    };
  } else if (eventName === "notification.dispatch") {
    rpcBody = {
      rpc: "rpc_inngest_enqueue_notification",
      body: {
        p_work_order_id: String(payload.work_order_id ?? ""),
        p_title: String(payload.payload?.title ?? "Xicha Food Safety Event"),
        p_body: String(payload.payload?.body ?? ""),
        p_channel: String(payload.payload?.channel ?? "dingtalk"),
        p_priority: String(payload.payload?.priority ?? "high"),
      },
    };
  }

  if (!rpcBody) return; // not all events have an RPC enqueue path

  try {
    const res = await withTimeout(
      fetch(`${url}/rest/v1/rpc/${rpcBody.rpc}`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(rpcBody.body),
      }),
      EMIT_TIMEOUT_MS,
      new Response(null, { status: 0 }),
    );
    if (!res.ok && res.status !== 0) {
      console.warn(`[xicha-event-bus] inngest RPC failed HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[xicha-event-bus] inngest RPC threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function postToInngestDispatch(eventName: string, payload: XichaEventPayload): Promise<void> {
  const inngestUrl = envVar("INNGEST_DISPATCH_URL");
  if (!inngestUrl) return;

  try {
    const res = await withTimeout(
      fetch(inngestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(envVar("INNGEST_EVENT_KEY") ? { "X-Inngest-Event-Key": envVar("INNGEST_EVENT_KEY") } : {}),
        },
        body: JSON.stringify({ name: eventName, data: payload }),
      }),
      EMIT_TIMEOUT_MS,
      new Response(null, { status: 0 }),
    );
    if (!res.ok && res.status !== 0) {
      console.warn(`[xicha-event-bus] inngest dispatch HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[xicha-event-bus] inngest dispatch threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface XichaEventBus {
  emit(eventName: XichaEventName, payload: XichaEventPayload): void;
}

class DefaultXichaEventBus implements XichaEventBus {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  emit(eventName: XichaEventName, payload: XichaEventPayload): void {
    // fire-and-forget — fan out to all known sinks
    void (async () => {
      const flatPayload = {
        event_name: eventName,
        ...payload,
        ...(payload.payload ?? {}),
        payload: payload.payload ?? {},
      };
      await Promise.allSettled([
        postToSupabaseAudit(flatPayload),
        postToSupabaseInngestQueue(eventName, payload),
        postToInngestDispatch(eventName, payload),
      ]);
    })();
  }
}

let _bus: XichaEventBus | undefined;
export function getXichaEventBus(): XichaEventBus {
  if (!_bus) _bus = new DefaultXichaEventBus();
  return _bus;
}

/** For tests / DI: allow override of the singleton bus. */
export function setXichaEventBus(bus: XichaEventBus | undefined): void {
  _bus = bus;
}
