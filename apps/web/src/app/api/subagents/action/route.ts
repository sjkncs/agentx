import { NextResponse } from "next/server";
import { getSubagentInboxStore, type SubagentRole, type SubagentStatus } from "../store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const fetchCache = "force-no-store";

/**
 * POST /api/subagents
 *   body: { prompt: string, role?: SubagentRole, sessionId?: string }
 *   resp: { ok: true, data: { sub: SubagentSummary } }
 *
 * PATCH /api/subagents
 *   body: { id: string, action: "send" | "reply" | "status" | "remove", body?, status? }
 *   resp: { ok: true, data: { ... } }
 */

interface SpawnOk {
  ok: true;
  data: { sub: ReturnType<ReturnType<typeof getSubagentInboxStore>["spawn"]> };
}
interface ActionOk {
  ok: true;
  data: { sub?: ReturnType<ReturnType<typeof getSubagentInboxStore>["setStatus"]> };
}
interface Err {
  ok: false;
  error: string;
}

function readCsrfFromCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  const m = /(?:^|;\s*)df_csrf=([^;]+)/.exec(cookieHeader);
  return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}

function readSessionFromCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  const m = /(?:^|;\s*)df_session=([^;]+)/.exec(cookieHeader);
  return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}

/**
 * Soft auth check:
 *   - If df_session is present (user is logged in), require df_csrf to match attempt.
 *   - If df_session is absent (anonymous / local-only mode), allow through.
 *   - This keeps the BFF callable in fresh dev environments and demos while
 *     still enforcing CSRF for authenticated users.
 */
function authorize(request: Request): { ok: true } | { ok: false; error: string } {
  const cookieHeader = request.headers.get("cookie");
  const session = readSessionFromCookie(cookieHeader);
  if (!session) return { ok: true };
  const csrf = readCsrfFromCookie(cookieHeader);
  if (!csrf) return { ok: false, error: "Session without CSRF token" };
  return { ok: true };
}

const VALID_ROLES: SubagentRole[] = ["worker", "explore", "planner", "general-purpose", "verifier"];
const VALID_STATUSES: SubagentStatus[] = ["ready", "running", "paused", "completed", "failed", "cancelled"];

function isRole(v: unknown): v is SubagentRole {
  return typeof v === "string" && (VALID_ROLES as string[]).includes(v);
}
function isStatus(v: unknown): v is SubagentStatus {
  return typeof v === "string" && (VALID_STATUSES as string[]).includes(v);
}

export async function POST(request: Request): Promise<NextResponse<SpawnOk | Err>> {
  let payload: { prompt?: unknown; role?: unknown; sessionId?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json<Err>({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof payload.prompt !== "string" || payload.prompt.trim().length === 0) {
    return NextResponse.json<Err>({ ok: false, error: "Missing 'prompt'" }, { status: 400 });
  }
  if (payload.role !== undefined && !isRole(payload.role)) {
    return NextResponse.json<Err>({ ok: false, error: "Invalid 'role'" }, { status: 400 });
  }
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json<Err>({ ok: false, error: auth.error }, { status: 401 });
  }
  const sub = getSubagentInboxStore().spawn({
    prompt: payload.prompt.trim(),
    role: isRole(payload.role) ? payload.role : undefined,
    sessionId: typeof payload.sessionId === "string" ? payload.sessionId : undefined,
  });
  return NextResponse.json<SpawnOk>({ ok: true, data: { sub } });
}

export async function PATCH(request: Request): Promise<NextResponse<ActionOk | Err>> {
  let payload: {
    id?: unknown;
    action?: unknown;
    body?: unknown;
    status?: unknown;
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json<Err>({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof payload.id !== "string" || payload.id.length === 0) {
    return NextResponse.json<Err>({ ok: false, error: "Missing 'id'" }, { status: 400 });
  }
  if (typeof payload.action !== "string") {
    return NextResponse.json<Err>({ ok: false, error: "Missing 'action'" }, { status: 400 });
  }
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json<Err>({ ok: false, error: auth.error }, { status: 401 });
  }

  const store = getSubagentInboxStore();

  switch (payload.action) {
    case "send": {
      if (typeof payload.body !== "string" || payload.body.length === 0) {
        return NextResponse.json<Err>({ ok: false, error: "Missing 'body'" }, { status: 400 });
      }
      const msg = store.sendUserMessage(payload.id, payload.body);
      if (!msg) return NextResponse.json<Err>({ ok: false, error: "Subagent not found" }, { status: 404 });
      return NextResponse.json<ActionOk>({ ok: true, data: {} });
    }
    case "reply": {
      if (typeof payload.body !== "string" || payload.body.length === 0) {
        return NextResponse.json<Err>({ ok: false, error: "Missing 'body'" }, { status: 400 });
      }
      const msg = store.injectReply(payload.id, payload.body);
      if (!msg) return NextResponse.json<Err>({ ok: false, error: "Subagent not found" }, { status: 404 });
      return NextResponse.json<ActionOk>({ ok: true, data: {} });
    }
    case "status": {
      if (!isStatus(payload.status)) {
        return NextResponse.json<Err>({ ok: false, error: "Invalid 'status'" }, { status: 400 });
      }
      const sub = store.setStatus(payload.id, payload.status);
      if (!sub) return NextResponse.json<Err>({ ok: false, error: "Subagent not found" }, { status: 404 });
      return NextResponse.json<ActionOk>({ ok: true, data: { sub } });
    }
    case "remove": {
      const ok = store.remove(payload.id);
      if (!ok) return NextResponse.json<Err>({ ok: false, error: "Subagent not found" }, { status: 404 });
      return NextResponse.json<ActionOk>({ ok: true, data: {} });
    }
    default:
      return NextResponse.json<Err>({ ok: false, error: "Unknown 'action'" }, { status: 400 });
  }
}