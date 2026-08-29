/**
 * Webhook 路由 — Inngest + DingTalk 双入站
 * 设计：
 *   - 不引入 express，server.ts 用裸 http；这里也是裸 handler
 *   - 签名校验：DingTalk SHA1(token+ts+body) ; Inngest HMAC-SHA256
 *   - 入站 payload 落到 agentx.fsf_webhook_inbox
 *   - 关联到工单：rpc_inngest_ack_webhook(source, external_event_id, work_order_id, result)
 * 路由：
 *   POST /api/webhooks/inngest
 *   POST /api/webhooks/dingtalk
 *   POST /api/webhooks/generic/:source
 *   GET  /api/webhooks/inbox
 */
import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface WebhookEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
  dingtalkTokens: string[];
  inngestSigningKey?: string;
}

export function loadWebhookEnv(): WebhookEnv {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const tokens = (process.env.DINGTALK_TOKENS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const signing = process.env.INNGEST_SIGNING_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL/SERVICE_ROLE_KEY required");
  return {
    supabaseUrl: url,
    serviceRoleKey: key,
    dingtalkTokens: tokens,
    ...(signing ? { inngestSigningKey: signing } : {}),
  };
}

/** Minimal REST-only Supabase client (no @supabase/supabase-js dependency) */
async function dbInsert(env: WebhookEnv, table: string, row: unknown): Promise<void> {
  const url = `${env.supabaseUrl}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: env.serviceRoleKey,
      authorization: `Bearer ${env.serviceRoleKey}`,
      prefer: "return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`db insert ${table} -> ${res.status} ${await res.text()}`);
}

async function dbRpc(env: WebhookEnv, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const url = `${env.supabaseUrl}/rest/v1/rpc/${fn}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: env.serviceRoleKey,
      authorization: `Bearer ${env.serviceRoleKey}`,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`db rpc ${fn} -> ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export function isWebhookPath(pathname: string): boolean {
  return pathname.startsWith("/api/webhooks/");
}

export async function handleWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  env: WebhookEnv,
): Promise<boolean> {
  const url = req.url ?? "";
  const m = /^\/api\/webhooks\/([^?]+)/.exec(url);
  if (!m) return false;
  const route = m[1]!;
  const body = await readBody(req);
  const headers = pickHeaders(req);
  try {
    if (route === "inngest") {
      await handleInngest(env, body, headers, res);
      return true;
    }
    if (route === "dingtalk") {
      await handleDingtalk(env, body, headers, res);
      return true;
    }
    if (route.startsWith("generic/")) {
      await handleGeneric(env, route.slice("generic/".length), body, headers, res);
      return true;
    }
    if (route === "inbox") {
      await handleInbox(env, url, res);
      return true;
    }
    notFound(res, `unknown route: ${route}`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[webhooks] ${route} error: ${msg}`);
    json(res, 500, { ok: false, error: msg });
    return true;
  }
}

async function handleInngest(env: WebhookEnv, body: string, headers: Record<string, string>, res: ServerResponse): Promise<void> {
  if (env.inngestSigningKey && !verifyInngestSignature(env.inngestSigningKey, body, headers)) {
    json(res, 401, { ok: false, error: "bad signature" });
    return;
  }
  const payload = parseJson(body);
  const eventId = String(payload?.id ?? payload?.event_id ?? "");
  const eventName = String(payload?.name ?? payload?.event ?? "inngest.unknown");
  const eventData = (payload?.data ?? {}) as Record<string, unknown>;
  const workOrderId = typeof eventData.work_order_id === "string" ? eventData.work_order_id : null;

  await dbInsert(env, "fsf_webhook_inbox", {
    source: "inngest",
    event_id: eventId || null,
    signature: headers["x-inngest-signature"] ?? null,
    headers,
    payload,
    processed: true,
    processed_at: new Date().toISOString(),
    work_order_id: workOrderId,
    result: { received: true, event_name: eventName },
  });
  await dbRpc(env, "rpc_inngest_ack_webhook", {
    p_source: "inngest",
    p_external_event_id: eventId,
    p_work_order_id: workOrderId,
    p_result: { event_name: eventName, status: "received" },
  });
  json(res, 200, { ok: true });
}

async function handleDingtalk(env: WebhookEnv, body: string, headers: Record<string, string>, res: ServerResponse): Promise<void> {
  const ts = headers["timestamp"] ?? "";
  const sign = headers["sign"] ?? "";
  if (env.dingtalkTokens.length > 0) {
    const ok = env.dingtalkTokens.some((tok) => safeEq(computeDingtalkSignature(tok, body, ts), sign));
    if (!ok) {
      json(res, 401, { ok: false, error: "bad signature" });
      return;
    }
  }
  const payload = parseJson(body);
  const workOrderId = pickWorkOrder(payload);
  await dbInsert(env, "fsf_webhook_inbox", {
    source: "dingtalk",
    event_id: String(payload?.eventId ?? ""),
    signature: sign || null,
    headers,
    payload,
    processed: true,
    processed_at: new Date().toISOString(),
    work_order_id: workOrderId,
    result: { received: true, text: pickText(payload) },
  });
  await dbRpc(env, "rpc_inngest_ack_webhook", {
    p_source: "dingtalk",
    p_external_event_id: String(payload?.eventId ?? ""),
    p_work_order_id: workOrderId,
    p_result: { text: pickText(payload) },
  });
  json(res, 200, { ok: true });
}

async function handleGeneric(env: WebhookEnv, source: string, body: string, headers: Record<string, string>, res: ServerResponse): Promise<void> {
  const payload = parseJson(body);
  const externalId = String(payload?.id ?? payload?.event_id ?? "");
  const workOrderId = pickWorkOrder(payload);
  await dbInsert(env, "fsf_webhook_inbox", {
    source,
    event_id: externalId || null,
    signature: headers["x-signature"] ?? null,
    headers,
    payload,
    processed: true,
    processed_at: new Date().toISOString(),
    work_order_id: workOrderId,
    result: { received: true },
  });
  await dbRpc(env, "rpc_inngest_ack_webhook", {
    p_source: source,
    p_external_event_id: externalId,
    p_work_order_id: workOrderId,
    p_result: { ok: true },
  });
  json(res, 200, { ok: true });
}

async function handleInbox(env: WebhookEnv, url: string, res: ServerResponse): Promise<void> {
  const limit = Number(new URL(url, "http://x").searchParams.get("limit") ?? 50);
  const rowsUrl = `${env.supabaseUrl}/rest/v1/fsf_webhook_inbox` +
    `?select=id,source,event_id,work_order_id,processed,received_at` +
    `&order=received_at.desc` +
    `&limit=${Math.max(1, Math.min(limit, 500))}`;
  const res_ = await fetch(rowsUrl, {
    headers: {
      apikey: env.serviceRoleKey,
      authorization: `Bearer ${env.serviceRoleKey}`,
    },
  });
  if (!res_.ok) {
    json(res, 500, { ok: false, error: `fetch inbox -> ${res_.status}` });
    return;
  }
  const data = await res_.json().catch(() => []);
  json(res, 200, { ok: true, rows: Array.isArray(data) ? data : [] });
}

function computeDingtalkSignature(token: string, body: string, ts: string): string {
  return createHash("sha1").update(`${token}\n${ts}\n${body}`).digest("base64");
}

function verifyInngestSignature(signingKey: string, body: string, headers: Record<string, string>): boolean {
  // Inngest ISV spec: HMAC-SHA256(signingKey, "${timestamp}\n${body}") → hex
  // Header format: X-Inngest-Signature: s=hex (s= prefix), X-Inngest-Signature-Timestamp: timestamp
  const ts = headers["x-inngest-signature-timestamp"] ?? "";
  const sig = headers["x-inngest-signature"] ?? "";
  if (!ts || !sig) return false;
  const expected = createHmac("sha256", signingKey).update(`${ts}\n${body}`).digest("hex");
  return safeEq(expected, sig);
}

function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
      if (raw.length > 5_000_000) {
        req.destroy();
        reject(new Error("body too large"));
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", (err: Error) => reject(err));
  });
}

function parseJson(s: string): Record<string, unknown> {
  if (!s) return {};
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function pickHeaders(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") out[k.toLowerCase()] = v;
    else if (Array.isArray(v)) out[k.toLowerCase()] = v.join(",");
  }
  return out;
}

function pickWorkOrder(payload: Record<string, unknown>): string | null {
  const direct = payload?.work_order_id;
  if (typeof direct === "string") return direct;
  const data = payload?.data as Record<string, unknown> | undefined;
  if (data && typeof data.work_order_id === "string") return data.work_order_id;
  return null;
}

function pickText(payload: Record<string, unknown>): string {
  const text = payload?.text;
  if (typeof text === "string") return text;
  if (payload?.msgtype === "markdown" && payload?.markdown) {
    const m = payload.markdown as Record<string, unknown>;
    return String(m.title ?? m.text ?? "");
  }
  return "";
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(data));
  res.end(data);
}

function notFound(res: ServerResponse, msg: string): void {
  json(res, 404, { ok: false, error: msg });
}
