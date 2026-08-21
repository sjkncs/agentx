/**
 * Food-safety Supabase client (PostgREST + RPC) — service_role based.
 *
 * Uses fetch (no SDK). Falls back to a no-op stub when env vars are missing so
 * callers can keep running during local dev without Supabase configured.
 *
 * Env:
 *  - SUPABASE_URL          e.g. https://xyz.supabase.co
 *  - SUPABASE_SERVICE_KEY  (preferred — bypasses RLS for writes)
 *  - SUPABASE_ANON_KEY     (fallback — read-only access to compensation matrix etc.)
 *
 * Tables / RPCs in `datafoundry` schema:
 *  - fsf_work_orders     (POST /rest/v1/fsf_work_orders)
 *  - fsf_messages        (POST /rest/v1/fsf_messages)
 *  - fsf_compensation_matrix, fsf_script_library, fsf_sla_config (anon-readable)
 *  - match_dfd_memories_hybrid(...)
 */
export type RiskLevel = "high" | "medium" | "low";
export type FsfStatus = "open" | "investigating" | "resolved" | "closed" | "escalated";
export type FsfStage = "reported" | "triage" | "investigating" | "compensating" | "closed";

export interface FsfWorkOrder {
  id?: number;
  case_no: string;
  conversation_id: string;
  user_id: number;
  category: string;
  sub_category: string | null;
  description: string;
  evidence_urls?: unknown[];
  risk_level: RiskLevel;
  status?: FsfStatus;
  stage?: FsfStage;
  handler_id?: number | null;
  store_info?: Record<string, unknown>;
  order_info?: Record<string, unknown>;
  sla_deadline?: string;
  sla_start?: string;
  metadata?: Record<string, unknown>;
}

export interface FsfMessage {
  conversation_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  intent?: string;
  sub_intent?: string;
  risk_level?: RiskLevel;
  audit_status?: "pass" | "warn" | "block";
  audit_violations?: unknown[];
  token_count?: number;
  latency_ms?: number;
  metadata?: Record<string, unknown>;
}

export interface FsfCompensationRow {
  id: number;
  category: string;
  sub_category: string | null;
  risk_level: RiskLevel;
  severity_score: number;
  min_amount: number | null;
  max_amount: number | null;
  recommended_type: "voucher" | "redelivery" | "refund" | "apology" | "none";
  description: string | null;
}

export interface FoodSafetyClient {
  enabled: boolean;
  // Work orders
  createWorkOrder(wo: FsfWorkOrder): Promise<FsfWorkOrder>;
  updateWorkOrderStatus(caseNo: string, status: FsfStatus, stage?: FsfStage): Promise<void>;
  listWorkOrdersByUser(userId: number, limit?: number): Promise<FsfWorkOrder[]>;
  listHighRiskOpenWorkOrders(): Promise<FsfWorkOrder[]>;
  // Messages
  appendMessage(msg: FsfMessage): Promise<void>;
  listMessages(conversationId: string): Promise<unknown[]>;
  // Reference tables (anon-readable, cache for hot path)
  listCompensationMatrix(): Promise<FsfCompensationRow[]>;
  listScripts(category?: string): Promise<unknown[]>;
  listSlaConfig(category?: string): Promise<unknown[]>;
}

function readEnv(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

const STUB: FoodSafetyClient = {
  enabled: false,
  createWorkOrder: async () => {
    throw new Error("Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY missing)");
  },
  updateWorkOrderStatus: async () => {},
  listWorkOrdersByUser: async () => [],
  listHighRiskOpenWorkOrders: async () => [],
  appendMessage: async () => {},
  listMessages: async () => [],
  listCompensationMatrix: async () => [],
  listScripts: async () => [],
  listSlaConfig: async () => [],
};

export function createFoodSafetyClient(): FoodSafetyClient {
  const env = readEnv();
  if (!env) return STUB;

  const headers = {
    apikey: env.key,
    Authorization: `Bearer ${env.key}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };

  const headersReturning = { ...headers, Prefer: "return=representation" };

  async function getJson<T>(path: string): Promise<T[]> {
    const res = await fetch(`${env!.url}/rest/v1${path}`, { headers });
    if (!res.ok) {
      throw new Error(`supabase ${path} -> HTTP ${res.status} ${await res.text()}`);
    }
    const rows = (await res.json().catch(() => [])) as T[];
    return Array.isArray(rows) ? rows : [];
  }

  async function postReturning<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${env!.url}/rest/v1${path}`, {
      method: "POST",
      headers: headersReturning,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`supabase POST ${path} -> HTTP ${res.status} ${await res.text()}`);
    }
    const rows = (await res.json().catch(() => [])) as T[];
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error(`supabase POST ${path} returned no rows`);
    }
    return rows[0] as T;
  }

  async function patch(path: string): Promise<void> {
    const res = await fetch(`${env!.url}/rest/v1${path}`, { method: "PATCH", headers });
    if (!res.ok) {
      throw new Error(`supabase PATCH ${path} -> HTTP ${res.status} ${await res.text()}`);
    }
  }

  return {
    enabled: true,

    async createWorkOrder(wo) {
      return postReturning<FsfWorkOrder>("/fsf_work_orders", wo);
    },

    async updateWorkOrderStatus(caseNo, status, stage) {
      const body: Record<string, unknown> = { status };
      if (stage) body.stage = stage;
      if (status === "resolved" || status === "closed") body.resolved_at = new Date().toISOString();
      if (status === "escalated") body.escalated_at = new Date().toISOString();
      const res = await fetch(
        `${env.url}/rest/v1/fsf_work_orders?case_no=eq.${encodeURIComponent(caseNo)}`,
        {
          method: "PATCH",
          headers: { ...headers, Prefer: "return=minimal" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        throw new Error(`supabase PATCH work_order -> HTTP ${res.status} ${await res.text()}`);
      }
    },

    async listWorkOrdersByUser(userId, limit = 50) {
      return getJson<FsfWorkOrder>(
        `/fsf_work_orders?user_id=eq.${userId}&order=created_at.desc&limit=${limit}`,
      );
    },

    async listHighRiskOpenWorkOrders() {
      return getJson<FsfWorkOrder>(
        "/fsf_work_orders?risk_level=eq.high&status=in.(open,investigating)&order=created_at.desc",
      );
    },

    async appendMessage(msg) {
      const res = await fetch(`${env.url}/rest/v1/fsf_messages`, {
        method: "POST",
        headers,
        body: JSON.stringify(msg),
      });
      if (!res.ok) {
        throw new Error(`supabase POST fsf_messages -> HTTP ${res.status} ${await res.text()}`);
      }
    },

    async listMessages(conversationId) {
      return getJson<unknown[]>(
        `/fsf_messages?conversation_id=eq.${encodeURIComponent(conversationId)}&order=created_at.asc`,
      );
    },

    async listCompensationMatrix() {
      return getJson<FsfCompensationRow>(
        "/fsf_compensation_matrix?active=eq.true&order=risk_level.desc,severity_score.desc",
      );
    },

    async listScripts(category) {
      const filter = category ? `&category=eq.${encodeURIComponent(category)}` : "";
      return getJson<unknown[]>(`/fsf_script_library?active=eq.true${filter}`);
    },

    async listSlaConfig(category) {
      const filter = category ? `&category=eq.${encodeURIComponent(category)}` : "";
      return getJson<unknown[]>(`/fsf_sla_config${filter}`);
    },
  };
}