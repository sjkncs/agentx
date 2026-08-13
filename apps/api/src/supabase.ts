/**
 * Minimal Supabase (PostgREST) client over fetch — no SDK dependency.
 * Used to persist scheduled tasks server-side when SUPABASE_URL + a key are set.
 * When not configured, callers fall back to the in-memory store.
 *
 * Env:
 *  - SUPABASE_URL          e.g. https://xyz.supabase.co
 *  - SUPABASE_SERVICE_KEY  (or SUPABASE_ANON_KEY) bearer key
 *
 * Table (create once in Supabase SQL editor):
 *   create table if not exists scheduled_tasks (
 *     id text primary key,
 *     user_id text not null,
 *     name text not null default '',
 *     prompt text not null default '',
 *     interval_minutes integer not null default 60,
 *     enabled boolean not null default true,
 *     created_at bigint not null,
 *     next_run_at bigint not null
 *   );
 */

export interface SupabaseScheduledTaskRow {
  id: string;
  user_id: string;
  name: string;
  prompt: string;
  interval_minutes: number;
  enabled: boolean;
  created_at: number;
  next_run_at: number;
}

export interface SupabaseClient {
  enabled: boolean;
  listTasks(userId: string): Promise<SupabaseScheduledTaskRow[]>;
  upsertTask(row: SupabaseScheduledTaskRow): Promise<void>;
  deleteTask(id: string): Promise<void>;
}

function readEnv(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

export function createSupabaseClient(): SupabaseClient {
  const env = readEnv();
  if (!env) {
    return { enabled: false, listTasks: async () => [], upsertTask: async () => {}, deleteTask: async () => {} };
  }

  const headers = {
    apikey: env.key,
    Authorization: `Bearer ${env.key}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };

  return {
    enabled: true,
    async listTasks(userId) {
      const res = await fetch(
        `${env.url}/rest/v1/scheduled_tasks?user_id=eq.${encodeURIComponent(userId)}&order=created_at`,
        { headers },
      );
      if (!res.ok) return [];
      const rows = (await res.json().catch(() => [])) as SupabaseScheduledTaskRow[];
      return Array.isArray(rows) ? rows : [];
    },
    async upsertTask(row) {
      await fetch(`${env.url}/rest/v1/scheduled_tasks`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(row),
      }).catch(() => {});
    },
    async deleteTask(id) {
      await fetch(`${env.url}/rest/v1/scheduled_tasks?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers,
      }).catch(() => {});
    },
  };
}
