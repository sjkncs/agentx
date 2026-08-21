/**
 * Supabase PostgREST + RPC 客户端：
 *   - 通过 service_role key 调 RPC
 *   - 不依赖 SDK（避免额外依赖）
 *   - 所有调用都 POST 到 /rest/v1/rpc/<fn_name>
 */

import type { WorkerConfig } from "./config.js";

const RPC_PATH = "/rest/v1/rpc";

export interface SupabaseClient {
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
}

export function makeClient(cfg: WorkerConfig): SupabaseClient {
  const headers = {
    "content-type": "application/json",
    apikey: cfg.serviceRoleKey,
    authorization: `Bearer ${cfg.serviceRoleKey}`,
  } as const;

  return {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      const url = `${cfg.supabaseUrl}${RPC_PATH}/${fn}`;
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), cfg.httpTimeoutMs);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(args),
          signal: ctrl.signal,
        });
        const text = await res.text();
        if (!res.ok) {
          throw new Error(`rpc ${fn} -> ${res.status}: ${text.slice(0, 300)}`);
        }
        return text.length === 0 ? (null as T) : (JSON.parse(text) as T);
      } finally {
        clearTimeout(to);
      }
    },
  };
}
