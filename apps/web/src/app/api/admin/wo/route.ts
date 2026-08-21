import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const fetchCache = "force-no-store";

/**
 * POST /api/admin/wo
 * Body: { case_no?: string, status?: string, stage?: string, sla_status?: string }
 * Returns: { ok: true } | { ok: false, error: string }
 *
 * Also supports GET ?case_no=WO-xxx → fetch current work order state.
 */

interface WOCreateBody {
  category: string;
  description: string;
  risk_level: string;
  store_id?: string;
  store_name?: string;
  order_no?: string;
  reporter_email?: string;
  evidence_urls?: string[];
}

interface WOUpdateBody {
  case_no: string;
  status?: string;
  stage?: string;
  sla_status?: string;
  handler_id?: number;
  resolution?: string;
  compensation_type?: string;
  agent_notes?: string;
}

async function callSupabaseRpc<T = unknown>(
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data?: T; error?: string }> {
  const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? process.env.SUPABASE_URL  ?? "";
  const supabaseKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!supabaseUrl || !supabaseKey) {
    return { error: "Missing Supabase env vars" };
  }
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { error: `RPC ${res.status}: ${text}` };
    }
    const data = await res.json();
    return { data: data as T };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(request: Request) {
  const url  = new URL(request.url);
  const caseNo = url.searchParams.get("case_no");
  if (!caseNo) {
    return NextResponse.json({ ok: false, error: "Missing case_no" }, { status: 400 });
  }
  const { data, error } = await callSupabaseRpc<{ id: number; case_no: string; status: string; sla_status: string }[]>(
    "rpc_work_order_list",
    { p_category: null, p_status: null, p_risk_level: null, p_limit: 1 },
  );
  if (error) return NextResponse.json({ ok: false, error }, { status: 500 });
  const wo = (data ?? []).find((r) => r.case_no === caseNo);
  if (!wo) return NextResponse.json({ ok: false, error: `WO not found: ${caseNo}` }, { status: 404 });
  return NextResponse.json({ ok: true, data: wo });
}

export async function POST(request: Request) {
  let body: WOCreateBody | WOUpdateBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // Update path
  if ("case_no" in body && !("category" in body)) {
    const b = body as WOUpdateBody;
    const { error } = await callSupabaseRpc("rpc_work_order_update_status", {
      p_case_no: b.case_no,
      p_status:  b.status   ?? null,
      p_stage:   b.stage   ?? null,
    });
    if (error) return NextResponse.json({ ok: false, error }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Create path
  const b = body as WOCreateBody;
  if (!b.category || !b.description || !b.risk_level) {
    return NextResponse.json({ ok: false, error: "Missing required fields: category, description, risk_level" }, { status: 400 });
  }
  const { data, error } = await callSupabaseRpc<{ ok: boolean; case_no: string; id: number; sla_hours: number }>(
    "rpc_work_order_create",
    {
      p_category:       b.category,
      p_description:    b.description,
      p_risk_level:     b.risk_level,
      p_store_id:       b.store_id      ?? null,
      p_store_name:     b.store_name    ?? null,
      p_order_no:       b.order_no      ?? null,
      p_reporter_email: b.reporter_email ?? null,
      p_evidence_urls:  b.evidence_urls  ? JSON.stringify(b.evidence_urls) : null,
    },
  );
  if (error) return NextResponse.json({ ok: false, error }, { status: 500 });
  if (!data?.ok) return NextResponse.json({ ok: false, error: data?.case_no ?? "create failed" }, { status: 500 });
  return NextResponse.json({ ok: true, data }, { status: 201 });
}
