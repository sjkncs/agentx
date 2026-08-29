/**
 * apps/api/src/routes/eval-runs.ts — A33 evaluation run HTTP API
 *
 * Endpoints:
 *   GET  /api/v1/eval/runs                  — list runs (filter ?dataset_id=, ?limit=)
 *   GET  /api/v1/eval/runs/:id              — read one run with full case_results
 *   POST /api/v1/eval/runs                  — start a run
 *   POST /api/v1/eval/runs/:id/complete     — finish a run (case_results required)
 *   POST /api/v1/eval/runs/:id/cancel       — mark a running run as canceled
 *   GET  /api/v1/eval/snapshot              — roll-up across datasets (window 24h)
 *
 * This is the persistent mirror of `apps/api/src/agent-eval.ts`. Once a run
 * completes, the snapshot endpoint reads from eval_runs instead of the rolling
 * in-memory buffer. agent-eval.ts stays as the live telemetry path; eval_runs
 * is the audit / dashboard path.
 */

import { createErrorResult, createSuccessResult } from "@agentx/contracts";
import type {
  EvalCaseResult,
  EvalRunRecord,
  EvalRunStatus
} from "@agentx/metadata";
import { supabase } from "@agentx/supabase-bridge";
import type { IncomingMessage } from "node:http";

import type { ConfigApiContext, ConfigApiResponse } from "./types.js";

const RUNS_PATH = "/api/v1/eval/runs";
const SNAPSHOT_PATH = "/api/v1/eval/snapshot";

export interface EvalRunsDeps {
  supabaseClient?: ReturnType<typeof supabase>;
}

const respond = (status: number, body: ConfigApiResponse["body"]): ConfigApiResponse => ({
  status,
  body
});
const ok = <T>(data: T): ConfigApiResponse => respond(200, createSuccessResult(data));
const fail = (status: number, code: string, message: string): ConfigApiResponse =>
  respond(status, createErrorResult(code as never, message));
const methodNotAllowed = (): ConfigApiResponse =>
  respond(405, createErrorResult("BAD_REQUEST", "Method not allowed."));

const resolveScope = (ctx: ConfigApiContext): { workspace_id: string; user_id: string } => ({
  user_id: ctx.userId,
  workspace_id: ctx.workspaceId ?? "default"
});

const parseStatus = (v: unknown): ValidationResult<Exclude<EvalRunStatus, "running">> => {
  if (v === "completed" || v === "failed" || v === "canceled") {
    return { ok: true, value: v };
  }
  return { ok: false, error: "status must be one of: completed, failed, canceled" };
};

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const parseCaseResults = (v: unknown): ValidationResult<EvalCaseResult[]> => {
  if (!Array.isArray(v)) return { ok: false, error: "case_results must be an array" };
  const out: EvalCaseResult[] = [];
  for (let i = 0; i < v.length; i += 1) {
    const entry = v[i];
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, error: `case_results[${i}] must be an object` };
    }
    const r = entry as Record<string, unknown>;
    if (typeof r.case_id !== "string" || r.case_id.length === 0) {
      return { ok: false, error: `case_results[${i}].case_id required` };
    }
    out.push({
      case_id: r.case_id,
      passed: r.passed === true,
      score: typeof r.score === "number" ? r.score : r.passed === true ? 1 : 0,
      ...(typeof r.actual_output === "string" ? { actual_output: r.actual_output } : {}),
      ...(typeof r.reason === "string" ? { reason: r.reason } : {}),
      ...(typeof r.duration_ms === "number" ? { duration_ms: r.duration_ms } : {})
    });
  }
  return { ok: true, value: out };
};

const parseStartInput = (
  body: unknown
): ValidationResult<{
  dataset_id: string;
  dataset_revision?: number;
  model_provider?: string;
  model_name?: string;
  source_run_id?: string;
  metadata?: Record<string, unknown>;
  total_cases?: number;
}> => {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "request body must be an object" };
  }
  const r = body as Record<string, unknown>;
  if (typeof r.dataset_id !== "string" || r.dataset_id.length === 0) {
    return { ok: false, error: "dataset_id required" };
  }
  return {
    ok: true,
    value: {
      dataset_id: r.dataset_id,
      ...(typeof r.dataset_revision === "number" ? { dataset_revision: r.dataset_revision } : {}),
      ...(typeof r.model_provider === "string" ? { model_provider: r.model_provider } : {}),
      ...(typeof r.model_name === "string" ? { model_name: r.model_name } : {}),
      ...(typeof r.source_run_id === "string" ? { source_run_id: r.source_run_id } : {}),
      ...(typeof r.metadata === "object" && r.metadata !== null && !Array.isArray(r.metadata)
        ? { metadata: r.metadata as Record<string, unknown> }
        : {}),
      ...(typeof r.total_cases === "number" && r.total_cases >= 0 ? { total_cases: r.total_cases } : {})
    }
  };
};

const parsePathTail = (pathname: string, prefix: string): { id: string; action?: string } | undefined => {
  if (!pathname.startsWith(prefix)) return undefined;
  const tail = pathname.slice(prefix.length);
  if (tail.length === 0) return undefined;
  const [id, action] = tail.split("/");
  if (!id) return undefined;
  return { id: decodeURIComponent(id), ...(action ? { action } : {}) };
};

const toDto = (record: EvalRunRecord): Record<string, unknown> => ({
  id: record.id,
  workspace_id: record.workspace_id,
  dataset_id: record.dataset_id,
  dataset_revision: record.dataset_revision,
  model_provider: record.model_provider ?? null,
  model_name: record.model_name ?? null,
  status: record.status,
  started_at: record.started_at,
  ended_at: record.ended_at ?? null,
  duration_ms: record.duration_ms ?? null,
  total_cases: record.total_cases,
  passed_cases: record.passed_cases,
  failed_cases: record.failed_cases,
  pass_rate: record.pass_rate,
  case_results: record.case_results,
  source_run_id: record.source_run_id ?? null,
  metadata: record.metadata ?? null
});

const mirrorToSupabase = async (
  deps: EvalRunsDeps,
  scope: { workspace_id: string; user_id: string },
  record: EvalRunRecord
): Promise<{ status: number; error: string | null }> => {
  const client = deps.supabaseClient ?? supabase();
  if (!client.enabled) {
    return { status: 0, error: null };
  }
  const res = await client.upsert(
    "dfd_eval_runs",
    {
      workspace_id: scope.workspace_id,
      user_id: scope.user_id,
      id: record.id,
      dataset_id: record.dataset_id,
      dataset_revision: record.dataset_revision,
      model_provider: record.model_provider ?? null,
      model_name: record.model_name ?? null,
      status: record.status,
      started_at: record.started_at,
      ended_at: record.ended_at ?? null,
      duration_ms: record.duration_ms ?? null,
      total_cases: record.total_cases,
      passed_cases: record.passed_cases,
      failed_cases: record.failed_cases,
      pass_rate: record.pass_rate,
      source_run_id: record.source_run_id ?? null
    },
    { onConflict: "id" }
  );
  return { status: res.status, error: res.error };
};

export async function handleEvalRunsRequest(
  request: IncomingMessage,
  pathname: string,
  body: unknown,
  deps: EvalRunsDeps = {}
): Promise<ConfigApiResponse | null> {
  const ctx = (request as IncomingMessage & { configContext?: ConfigApiContext }).configContext;
  if (!ctx) return null;

  const scope = resolveScope(ctx);

  // GET /api/v1/eval/snapshot — roll-up across datasets
  if (pathname === SNAPSHOT_PATH) {
    if (request.method !== "GET") return methodNotAllowed();
    const url = (request.url ?? "").split("?")[1] ?? "";
    const params = new URLSearchParams(url);
    const windowParam = params.get("window_hours");
    const window_hours = windowParam ? Number.parseInt(windowParam, 10) : 24;
    if (!Number.isFinite(window_hours) || window_hours <= 0 || window_hours > 24 * 30) {
      return fail(400, "BAD_REQUEST", "window_hours must be 1–720");
    }
    const snap = ctx.metadataStore.evalRuns.snapshot({
      workspace_id: scope.workspace_id,
      user_id: scope.user_id,
      window_hours
    });
    return ok({
      ...snap,
      window_hours,
      computed_at: new Date().toISOString()
    });
  }

  // /api/v1/eval/runs — list (GET) / start (POST)
  if (pathname === RUNS_PATH) {
    if (request.method === "GET") {
      const url = (request.url ?? "").split("?")[1] ?? "";
      const params = new URLSearchParams(url);
      const datasetId = params.get("dataset_id") ?? undefined;
      const limitRaw = params.get("limit");
      const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 100;
      if (!Number.isFinite(limit) || limit <= 0 || limit > 1000) {
        return fail(400, "BAD_REQUEST", "limit must be 1–1000");
      }
      const records = ctx.metadataStore.evalRuns.list({
        workspace_id: scope.workspace_id,
        user_id: scope.user_id,
        ...(datasetId ? { dataset_id: datasetId } : {}),
        limit
      });
      return ok({ items: records.map(toDto) });
    }
    if (request.method === "POST") {
      const parsed = parseStartInput(body);
      if (!parsed.ok) return fail(400, "BAD_REQUEST", parsed.error);

      // Auto-fill total_cases + dataset_revision from current dataset revision.
      let datasetRevision = parsed.value.dataset_revision;
      let totalCases = parsed.value.total_cases;
      const dataset = ctx.metadataStore.evalDatasets.find({
        id: parsed.value.dataset_id,
        workspace_id: scope.workspace_id,
        user_id: scope.user_id
      });
      if (!dataset) {
        return fail(404, "BAD_REQUEST", `dataset not found: ${parsed.value.dataset_id}`);
      }
      if (datasetRevision === undefined) datasetRevision = dataset.revision;
      if (totalCases === undefined) totalCases = dataset.test_cases.length;

      const record = ctx.metadataStore.evalRuns.start({
        workspace_id: scope.workspace_id,
        user_id: scope.user_id,
        dataset_id: parsed.value.dataset_id,
        dataset_revision: datasetRevision,
        ...(parsed.value.model_provider ? { model_provider: parsed.value.model_provider } : {}),
        ...(parsed.value.model_name ? { model_name: parsed.value.model_name } : {}),
        ...(parsed.value.source_run_id ? { source_run_id: parsed.value.source_run_id } : {}),
        ...(parsed.value.metadata ? { metadata: parsed.value.metadata } : {}),
        total_cases: totalCases
      });
      const sb = await mirrorToSupabase(deps, scope, record);
      return ok({ run: toDto(record), supabase: sb });
    }
    return methodNotAllowed();
  }

  // /api/v1/eval/runs/:id[/action]
  const tail = parsePathTail(pathname, `${RUNS_PATH}/`);
  if (tail) {
    if (!tail.action) {
      if (request.method === "GET") {
        try {
          const record = ctx.metadataStore.evalRuns.get(tail.id);
          return ok({ run: toDto(record) });
        } catch (err) {
          return fail(404, "BAD_REQUEST", err instanceof Error ? err.message : String(err));
        }
      }
      return methodNotAllowed();
    }
    if (tail.action === "complete" && request.method === "POST") {
      const r = (body ?? {}) as Record<string, unknown>;
      const status = parseStatus(r.status);
      if (!status.ok) return fail(400, "BAD_REQUEST", status.error);
      const cases = parseCaseResults(r.case_results);
      if (!cases.ok) return fail(400, "BAD_REQUEST", cases.error);
      try {
        const record = ctx.metadataStore.evalRuns.complete({
          id: tail.id,
          status: status.value,
          case_results: cases.value
        });
        const sb = await mirrorToSupabase(deps, scope, record);
        return ok({ run: toDto(record), supabase: sb });
      } catch (err) {
        return fail(404, "BAD_REQUEST", err instanceof Error ? err.message : String(err));
      }
    }
    if (tail.action === "cancel" && request.method === "POST") {
      try {
        const current = ctx.metadataStore.evalRuns.get(tail.id);
        if (current.status !== "running") {
          return fail(409, "BAD_REQUEST", `run is not running: status=${current.status}`);
        }
        const record = ctx.metadataStore.evalRuns.complete({
          id: tail.id,
          status: "canceled",
          case_results: current.case_results
        });
        const sb = await mirrorToSupabase(deps, scope, record);
        return ok({ run: toDto(record), supabase: sb });
      } catch (err) {
        return fail(404, "BAD_REQUEST", err instanceof Error ? err.message : String(err));
      }
    }
  }

  return null;
}
