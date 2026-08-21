import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const fetchCache = "force-no-store";

/**
 * GET /api/admin/audit
 *   ?keyword=WO-      — payload JSONB 关键词
 *   &time_range=7d    — 1h | 24h | 7d | 30d | null
 *   &category=workspace
 *   &severity=warning
 *   &action=workspace_seed
 *   &actor_id=user123
 *   &target_like=WO-%   — work_order_id 前缀
 *   &limit=100
 *   &offset=0
 *
 * POST /api/admin/audit/export
 *   Body: same filter params
 *   Returns: CSV blob
 */

async function callSupabaseRpc<T = unknown>(
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data?: T; error?: string }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? process.env.SUPABASE_URL  ?? "";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
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
  const wsId = url.searchParams.get("workspace_id") ?? "default";
  const limit  = Math.min(Number(url.searchParams.get("limit")  ?? 100), 500);
  const offset = Number(url.searchParams.get("offset")  ?? 0);
  const keyword     = url.searchParams.get("keyword")     || null;
  const timeRange   = url.searchParams.get("time_range")  || null;
  const category    = url.searchParams.get("category")     || null;
  const severity    = url.searchParams.get("severity")     || null;
  const action      = url.searchParams.get("action")       || null;
  const actorId     = url.searchParams.get("actor_id")    || null;
  const targetLike  = url.searchParams.get("target_like")  || null;

  const [searchResult, statsResult] = await Promise.allSettled([
    callSupabaseRpc<{ id: number; category: string; severity: string; action: string;
      target: string; payload: Record<string, unknown>; actor_id: string;
      created_at: string; row_count: number }[]>(
      "rpc_audit_search",
      { p_workspace_id: wsId, p_keyword: keyword, p_time_range: timeRange,
        p_category: category, p_severity: severity, p_action: action,
        p_actor_id: actorId, p_target_like: targetLike,
        p_limit: limit, p_offset: offset },
    ),
    callSupabaseRpc<{ category: string; severity: string; count: number }[]>(
      "rpc_audit_stats",
      { p_workspace_id: wsId, p_time_range: timeRange ?? "24h" },
    ),
  ]);

  const rows = searchResult.status === "fulfilled" ? (searchResult.value.data ?? []) : [];
  const stats = statsResult.status === "fulfilled" ? (statsResult.value.data ?? []) : [];
  const total = rows[0]?.row_count ?? 0;

  return NextResponse.json({
    ok: true,
    data: {
      rows,
      total,
      stats,
      timeRange,
      category,
      severity,
      action,
      keyword,
      targetLike,
    },
  });
}

export async function POST(request: Request) {
  // Export: same filters → CSV
  const url  = new URL(request.url);
  const wsId = url.searchParams.get("workspace_id") ?? "default";
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  const { data, error } = await callSupabaseRpc<
    { id: number; category: string; severity: string; action: string;
      target: string; payload: Record<string, unknown>; actor_id: string;
      created_at: string }[]
  >(
    "rpc_audit_search",
    {
      p_workspace_id: wsId,
      p_keyword:     body.keyword    ?? null,
      p_time_range:  body.timeRange  ?? null,
      p_category:    body.category   ?? null,
      p_severity:    body.severity   ?? null,
      p_action:      body.action     ?? null,
      p_actor_id:    body.actorId    ?? null,
      p_target_like: body.targetLike ?? null,
      p_limit: 1000,
      p_offset: 0,
    },
  );

  if (error) return NextResponse.json({ ok: false, error }, { status: 500 });

  const rows = data ?? [];
  const header = "id,category,severity,action,target,actor_id,created_at,payload\n";
  const csv = rows.map((r) =>
    [
      r.id,
      r.category,
      r.severity,
      r.action,
      r.target ?? "",
      r.actor_id ?? "",
      r.created_at,
      JSON.stringify(r.payload).replace(/"/g, '""'),
    ].map((v) => `"${v}"`).join(","),
  ).join("\n");

  const csvBlob = `\ufeff${header}${csv}`;
  return new Response(csvBlob, {
    headers: {
      "Content-Type":        "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-${wsId}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
