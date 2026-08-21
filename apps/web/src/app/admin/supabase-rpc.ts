"use client";

/**
 * supabase-rpc.ts — 浏览器端轻量 RPC 客户端
 * 仅给 admin 面板用：直接调 datafoundry.* RPC，无 SDK 依赖。
 */
const URL_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
] as const;
const ANON_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_ANON_KEY",
] as const;

export interface RpcResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

function envValue(keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = process.env[k];
    if (v) return v;
  }
  return undefined;
}

export async function callRpc<T = unknown>(
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcResult<T>> {
  const url = envValue(URL_ENV_KEYS);
  const key = envValue(ANON_ENV_KEYS);
  if (!url || !key) {
    return { ok: false, error: "SUPABASE_URL/ANON_KEY not configured" };
  }
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: key,
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(args),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: text.slice(0, 200) };
    return { ok: true, data: text.length === 0 ? undefined : (JSON.parse(text) as T) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}