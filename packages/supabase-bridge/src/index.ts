/**
 * packages/supabase-bridge/src/index.ts
 *
 * STUB PACKAGE — original source was lost during repo migration.
 *
 * The package metadata (name, version, deps) is preserved in
 * package-lock.json (line 26215) so the workspace resolves; this stub
 * re-exports the surface apps/api imports with the loosest possible
 * type signature so callers can compile. Operations are no-ops until
 * a real implementation is restored.
 *
 * To re-enable real Supabase persistence:
 *   1) `npm install @supabase/supabase-js`
 *   2) Replace this file with the original implementation that mapped
 *      the surface below to the @supabase/postgrest-js client.
 *   3) Refresh package-lock.json (the line 26215 entry hashes the
 *      tarball); re-run `npm install` to update the lock.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;

/**
 * PostgREST-shaped query result.
 *   - `status` is the HTTP status code (number). Disabled clients use
 *     0 as a sentinel — callers check `client.enabled` instead.
 *   - `error` is a string when the call failed, null on success.
 *   - `data` holds the inserted / patched / selected payload (null for
 *     insert/update when Prefer is return=minimal).
 */
export interface SupabaseQueryResult<T = AnyRow> {
  status: number;
  error: string | null;
  data: T | null;
}

/** Filter / merge hint for upsert/update calls. */
export interface SupabaseFilterOptions {
  filter?: string;
  onConflict?: string;
}

/**
 * Loose client interface. Disabled clients no-op every call.
 * Live clients map to the @supabase/supabase-js PostgREST API when
 * SUPABASE_URL + a key are configured.
 */
export interface SupabaseClient {
  enabled: boolean;
  url?: string;
  serviceKey?: string;

  /** Insert a row. */
  insert<T extends Record<string, unknown> = AnyRow>(
    table: string,
    row: Record<string, unknown>,
    opts?: SupabaseFilterOptions,
  ): Promise<SupabaseQueryResult<T>>;

  /** Patch rows matching the filter. */
  update<T extends Record<string, unknown> = AnyRow>(
    table: string,
    patch: Record<string, unknown>,
    opts: SupabaseFilterOptions,
  ): Promise<SupabaseQueryResult<T>>;

  /** Upsert by primary/conflict key. Third argument accepts either an
   *  options object or a column-name shorthand (`"id"`). */
  upsert<T extends Record<string, unknown> = AnyRow>(
    table: string,
    row: Record<string, unknown>,
    optsOrConflict?: SupabaseFilterOptions | string,
  ): Promise<SupabaseQueryResult<T>>;

  /** Select rows matching the filter. Returns an array in `data`. */
  select<T extends Record<string, unknown> = AnyRow>(
    table: string,
    opts?: SupabaseFilterOptions,
  ): Promise<SupabaseQueryResult<T[]>>;
}

// ── Sinks ─────────────────────────────────────────────────────────────

export interface SupabaseSinkStats {
  enqueued: number;
  flushed: number;
  failed: number;
}

/**
 * Session event log sink. Real implementation posts every event to
 * `dfd_session_events`. The stub only tracks stats.
 */
export class SupabaseEventLogSink {
  readonly enabled: boolean;
  readonly stats: SupabaseSinkStats;

  constructor(client: SupabaseClient) {
    this.enabled = client.enabled;
    this.stats = { enqueued: 0, flushed: 0, failed: 0 };
  }

  /** Append an event. */
  append(_event: AnyRow): void {
    this.stats.enqueued += 1;
    if (!this.enabled) {
      this.stats.flushed += 1;
      return;
    }
    queueMicrotask(() => {
      this.stats.flushed += 1;
    });
  }

  /** Force-flush queued events. */
  async flush(): Promise<void> {
    /* stub: no buffering */
  }

  async dispose(): Promise<void> {
    await this.flush();
  }
}

/** Run-lifecycle event payload — loose because callers pass varied shapes. */
export interface SupabaseRunLifecycleEvent {
  runId: string;
  sessionId: string;
  status: "started" | "running" | "finished" | "completed" | "error" | "errored";
  startedAt?: string;
  endedAt?: string;
}

/**
 * Run lifecycle sink. Real implementation tracks rows in `dfd_runs`.
 * The stub only tracks stats.
 */
export class SupabaseRunSink {
  readonly enabled: boolean;
  readonly stats: SupabaseSinkStats;

  constructor(client: SupabaseClient) {
    this.enabled = client.enabled;
    this.stats = { enqueued: 0, flushed: 0, failed: 0 };
  }

  /** Mark a run as started. */
  start(_event: AnyRow): void {
    this.stats.enqueued += 1;
    if (this.enabled) this.stats.flushed += 1;
  }

  /** Mark a run as ended (finished / errored). */
  end(_event: AnyRow): void {
    this.stats.enqueued += 1;
    if (this.enabled) this.stats.flushed += 1;
  }

  async dispose(): Promise<void> {
    /* stateless */
  }
}

// ── Factory ───────────────────────────────────────────────────────────

/**
 * Returns a Supabase client backed by `SUPABASE_URL` / `SUPABASE_*_KEY`
 * env vars, or a disabled client when credentials are missing.
 * Disabled clients return `{ status: 0 }` (sentinel) from every call.
 */
export function supabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  if (!url || !serviceKey) {
    return makeDisabledClient();
  }
  return makeLiveClient({ url: url.replace(/\/+$/, ""), key: serviceKey });
}

async function disabledRowResult<T>(): Promise<SupabaseQueryResult<T>> {
  return { status: 0, error: null, data: null };
}

function makeDisabledClient(): SupabaseClient {
  const insert = async <T extends Record<string, unknown> = AnyRow>(
    _table: string,
    _row: Record<string, unknown>,
    _opts?: SupabaseFilterOptions,
  ): Promise<SupabaseQueryResult<T>> => disabledRowResult<T>();

  const update = async <T extends Record<string, unknown> = AnyRow>(
    _table: string,
    _patch: Record<string, unknown>,
    _opts: SupabaseFilterOptions,
  ): Promise<SupabaseQueryResult<T>> => disabledRowResult<T>();

  const upsert = async <T extends Record<string, unknown> = AnyRow>(
    _table: string,
    _row: Record<string, unknown>,
    _optsOrConflict?: SupabaseFilterOptions | string,
  ): Promise<SupabaseQueryResult<T>> => disabledRowResult<T>();

  const select = async <T extends Record<string, unknown> = AnyRow>(
    _table: string,
    _opts?: SupabaseFilterOptions,
  ): Promise<SupabaseQueryResult<T[]>> => ({
    status: 0,
    error: null,
    data: [],
  });

  return {
    enabled: false,
    insert,
    update,
    upsert,
    select,
  };
}

function makeLiveClient(env: { url: string; key: string }): SupabaseClient {
  const headers = {
    apikey: env.key,
    Authorization: `Bearer ${env.key}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };

  const withFilter = (table: string, opts?: SupabaseFilterOptions): string => {
    const base = `${env.url}/rest/v1/${encodeURIComponent(table)}`;
    const parts: string[] = [];
    if (opts?.filter) parts.push(opts.filter);
    if (opts?.onConflict) parts.push(`on_conflict=${encodeURIComponent(opts.onConflict)}`);
    return parts.length ? `${base}?${parts.join("&")}` : base;
  };

  const liveQuery = async <T>(
    url: string,
    init: RequestInit,
  ): Promise<SupabaseQueryResult<T>> => {
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          status: res.status,
          error: text.slice(0, 200),
          data: null,
        };
      }
      return { status: res.status, error: null, data: null };
    } catch (err) {
      return { status: 0, error: String(err), data: null };
    }
  };

  return {
    enabled: true,
    url: env.url,
    serviceKey: env.key,

    async insert<T extends Record<string, unknown> = AnyRow>(
      table: string,
      row: Record<string, unknown>,
      opts?: SupabaseFilterOptions,
    ) {
      const query: SupabaseFilterOptions = opts ?? {};
      return liveQuery<T>(withFilter(table, query), {
        method: "POST",
        headers,
        body: JSON.stringify(row),
      });
    },

    async update<T extends Record<string, unknown> = AnyRow>(
      table: string,
      patch: Record<string, unknown>,
      opts: SupabaseFilterOptions,
    ) {
      return liveQuery<T>(withFilter(table, opts), {
        method: "PATCH",
        headers,
        body: JSON.stringify(patch),
      });
    },

    async upsert<T extends Record<string, unknown> = AnyRow>(
      table: string,
      row: Record<string, unknown>,
      optsOrConflict?: SupabaseFilterOptions | string,
    ) {
      const opts: SupabaseFilterOptions =
        typeof optsOrConflict === "string"
          ? { onConflict: optsOrConflict }
          : (optsOrConflict ?? {});
      return liveQuery<T>(withFilter(table, opts), {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(row),
      });
    },

    async select<T extends Record<string, unknown> = AnyRow>(
      table: string,
      opts?: SupabaseFilterOptions,
    ) {
      const url = withFilter(table, opts);
      try {
        const res = await fetch(url, { headers });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return { status: res.status, error: text.slice(0, 200), data: [] };
        }
        const rows = (await res.json().catch(() => [])) as T[];
        return { status: res.status, error: null, data: rows };
      } catch (err) {
        return { status: 0, error: String(err), data: [] };
      }
    },
  };
}
