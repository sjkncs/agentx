/**
 * apps/api/src/routes/eval-datasets.ts — A33 evaluation dataset HTTP API
 *
 * Endpoints:
 *   GET  /api/v1/eval/datasets                — list datasets in workspace scope
 *   GET  /api/v1/eval/datasets/:id            — read one dataset (returns cases)
 *   POST /api/v1/eval/datasets                — create or upsert (id required)
 *   PUT  /api/v1/eval/datasets/:id            — full update w/ expected_revision
 *   DELETE /api/v1/eval/datasets/:id          — remove a dataset
 *
 * The actual test-case content lives in the SQLite eval_datasets table via
 * metadataStore.evalDatasets. We additionally mirror each dataset definition
 * to dfd_eval_datasets in Supabase for cross-device durability and realtime
 * dashboards (best-effort: offline Supabase must not break the API).
 *
 * Built-in seed datasets ship as JSON in packages/eval/builtin/seed/*.json
 * (id starts with "builtin-") so they install on first boot.
 */

import { createErrorResult, createSuccessResult } from "@agentx/contracts";
import type {
  EvalDatasetDomain,
  EvalScoringStrategy,
  EvalDatasetRecord,
  EvalTestCase
} from "@agentx/metadata";
import { supabase } from "@agentx/supabase-bridge";
import type { IncomingMessage } from "node:http";

import type { ConfigApiContext, ConfigApiResponse } from "./types.js";

const DATASETS_PATH = "/api/v1/eval/datasets";

const DOMAINS: ReadonlySet<EvalDatasetDomain> = new Set<EvalDatasetDomain>([
  "general",
  "code",
  "data",
  "rag",
  "safety",
  "vertical"
]);

const SCORINGS: ReadonlySet<EvalScoringStrategy> = new Set<EvalScoringStrategy>([
  "exact-match",
  "contains",
  "regex",
  "judge-llm",
  "tool-call-success"
]);

const MAX_CASES = 500;
const MAX_CASE_INPUT_BYTES = 8 * 1024;
const MAX_DATASET_NAME_BYTES = 200;

export interface EvalDatasetsDeps {
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

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const isString = (v: unknown, max = 4096): v is string => typeof v === "string" && v.length <= max;

const parseDomain = (v: unknown): ValidationResult<EvalDatasetDomain> => {
  if (typeof v !== "string" || !DOMAINS.has(v as EvalDatasetDomain)) {
    return { ok: false, error: `domain must be one of: ${[...DOMAINS].join(", ")}` };
  }
  return { ok: true, value: v as EvalDatasetDomain };
};

const parseScoring = (v: unknown): ValidationResult<EvalScoringStrategy> => {
  if (typeof v !== "string" || !SCORINGS.has(v as EvalScoringStrategy)) {
    return { ok: false, error: `scoring must be one of: ${[...SCORINGS].join(", ")}` };
  }
  return { ok: true, value: v as EvalScoringStrategy };
};

const parseTestCases = (v: unknown): ValidationResult<EvalTestCase[]> => {
  if (!Array.isArray(v)) {
    return { ok: false, error: "test_cases must be an array" };
  }
  if (v.length > MAX_CASES) {
    return { ok: false, error: `test_cases exceeds ${MAX_CASES} entries` };
  }
  const seen = new Set<string>();
  const cases: EvalTestCase[] = [];
  for (let i = 0; i < v.length; i += 1) {
    const entry = v[i];
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, error: `test_cases[${i}] must be an object` };
    }
    const r = entry as Record<string, unknown>;
    if (!isString(r.id, 128) || !isString(r.input, MAX_CASE_INPUT_BYTES)) {
      return { ok: false, error: `test_cases[${i}].id and .input are required strings` };
    }
    if (seen.has(r.id)) {
      return { ok: false, error: `test_cases[${i}].id duplicate: ${r.id}` };
    }
    seen.add(r.id);
    const tc: EvalTestCase = {
      id: r.id,
      input: r.input,
      ...(isString(r.expected_output, MAX_CASE_INPUT_BYTES) ? { expected_output: r.expected_output } : {}),
      ...(typeof r.weight === "number" && r.weight >= 0 && r.weight <= 10 ? { weight: r.weight } : {}),
      ...(typeof r.context === "object" && r.context !== null && !Array.isArray(r.context)
        ? { context: r.context as Record<string, unknown> }
        : {}),
      ...(Array.isArray(r.tags) && r.tags.every((t) => typeof t === "string")
        ? { tags: r.tags as string[] }
        : {})
    };
    cases.push(tc);
  }
  return { ok: true, value: cases };
};

const parseUpsertInput = (
  body: unknown,
  fallbackId?: string
): ValidationResult<{
  id: string;
  name: string;
  description: string;
  domain: EvalDatasetDomain;
  scoring: EvalScoringStrategy;
  judge_profile_id?: string;
  test_cases: EvalTestCase[];
  expected_revision?: number;
}> => {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "request body must be an object" };
  }
  const r = body as Record<string, unknown>;
  const id = isString(r.id, 128) ? r.id : fallbackId;
  if (!id) {
    return { ok: false, error: "id is required" };
  }
  if (!isString(r.name, MAX_DATASET_NAME_BYTES) || r.name.length === 0) {
    return { ok: false, error: "name is required (<= 200 chars)" };
  }
  if (typeof r.description !== "string") {
    return { ok: false, error: "description must be a string" };
  }
  const domain = parseDomain(r.domain);
  if (!domain.ok) return domain;
  const scoring = parseScoring(r.scoring);
  if (!scoring.ok) return scoring;
  const cases = parseTestCases(r.test_cases);
  if (!cases.ok) return cases;

  return {
    ok: true,
    value: {
      id,
      name: r.name,
      description: r.description,
      domain: domain.value,
      scoring: scoring.value,
      ...(isString(r.judge_profile_id, 128) ? { judge_profile_id: r.judge_profile_id } : {}),
      test_cases: cases.value,
      ...(typeof r.expected_revision === "number" ? { expected_revision: r.expected_revision } : {})
    }
  };
};

const parsePathId = (pathname: string, prefix: string): string | undefined => {
  if (!pathname.startsWith(prefix)) return undefined;
  const tail = pathname.slice(prefix.length);
  if (tail.length === 0 || tail.includes("/")) return undefined;
  return decodeURIComponent(tail);
};

const toDto = (record: EvalDatasetRecord): {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  domain: EvalDatasetDomain;
  scoring: EvalScoringStrategy;
  judge_profile_id: string | null;
  test_cases: EvalTestCase[];
  builtin: boolean;
  status: string;
  revision: number;
  created_at: string;
  updated_at: string;
} => ({
  id: record.id,
  workspace_id: record.workspace_id,
  name: record.name,
  description: record.description,
  domain: record.domain,
  scoring: record.scoring,
  judge_profile_id: record.judge_profile_id ?? null,
  test_cases: record.test_cases,
  builtin: record.builtin,
  status: record.status,
  revision: record.revision,
  created_at: record.created_at,
  updated_at: record.updated_at
});

/** Best-effort Supabase mirror so the admin dashboard has realtime durability. */
const mirrorToSupabase = async (
  deps: EvalDatasetsDeps,
  scope: { workspace_id: string; user_id: string },
  action: "upsert" | "delete",
  payload: EvalDatasetRecord | { id: string }
): Promise<{ status: number; error: string | null }> => {
  const client = deps.supabaseClient ?? supabase();
  if (!client.enabled) {
    return { status: 0, error: null };
  }
  if (action === "delete") {
    const res = await client.update(
      "dfd_eval_datasets",
      { deleted_at: new Date().toISOString() },
      { filter: `workspace_id=eq.${scope.workspace_id}&id=eq.${payload.id}` }
    );
    return { status: res.status, error: res.error };
  }
  const p = payload as EvalDatasetRecord;
  const res = await client.upsert(
    "dfd_eval_datasets",
    {
      workspace_id: p.workspace_id,
      user_id: p.user_id,
      id: p.id,
      name: p.name,
      description: p.description,
      domain: p.domain,
      scoring: p.scoring,
      judge_profile_id: p.judge_profile_id ?? null,
      test_cases: p.test_cases,
      builtin: p.builtin,
      status: p.status,
      revision: p.revision,
      updated_at: p.updated_at
    },
    { onConflict: "workspace_id,id" }
  );
  return { status: res.status, error: res.error };
};

export async function handleEvalDatasetsRequest(
  request: IncomingMessage,
  pathname: string,
  body: unknown,
  deps: EvalDatasetsDeps = {}
): Promise<ConfigApiResponse | null> {
  const ctx = (request as IncomingMessage & { configContext?: ConfigApiContext }).configContext;
  if (!ctx) return null;

  const scope = resolveScope(ctx);

  // /api/v1/eval/datasets — list (GET) / create (POST)
  if (pathname === DATASETS_PATH) {
    if (request.method === "GET") {
      const url = (request.url ?? "").split("?")[1] ?? "";
      const params = new URLSearchParams(url);
      const domainParam = params.get("domain");
      const domain =
        domainParam && DOMAINS.has(domainParam as EvalDatasetDomain)
          ? (domainParam as EvalDatasetDomain)
          : undefined;
      const records = domain
        ? ctx.metadataStore.evalDatasets.list({ workspace_id: scope.workspace_id, user_id: scope.user_id, domain })
        : ctx.metadataStore.evalDatasets.list({ workspace_id: scope.workspace_id, user_id: scope.user_id });
      return ok({ items: records.map(toDto) });
    }
    if (request.method === "POST") {
      const parsed = parseUpsertInput(body);
      if (!parsed.ok) return fail(400, "BAD_REQUEST", parsed.error);
      try {
        const record = ctx.metadataStore.evalDatasets.upsert({
          id: parsed.value.id,
          workspace_id: scope.workspace_id,
          user_id: scope.user_id,
          name: parsed.value.name,
          description: parsed.value.description,
          domain: parsed.value.domain,
          scoring: parsed.value.scoring,
          ...(parsed.value.judge_profile_id
            ? { judge_profile_id: parsed.value.judge_profile_id }
            : {}),
          test_cases: parsed.value.test_cases,
          ...(parsed.value.expected_revision !== undefined
            ? { expected_revision: parsed.value.expected_revision }
            : {})
        });
        const sb = await mirrorToSupabase(deps, scope, "upsert", record);
        return ok({ dataset: toDto(record), supabase: sb });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.startsWith("EVAL_DATASET_REVISION_CONFLICT") ? 409 : 500;
        return fail(status, "BAD_REQUEST", `Create failed: ${message}`);
      }
    }
    return methodNotAllowed();
  }

  // /api/v1/eval/datasets/:id — read / update / delete
  const id = parsePathId(pathname, `${DATASETS_PATH}/`);
  if (id) {
    if (request.method === "GET") {
      const record = ctx.metadataStore.evalDatasets.find({
        id,
        workspace_id: scope.workspace_id,
        user_id: scope.user_id
      });
      if (!record) return fail(404, "BAD_REQUEST", `dataset not found: ${id}`);
      return ok({ dataset: toDto(record) });
    }
    if (request.method === "PUT") {
      const parsed = parseUpsertInput(body, id);
      if (!parsed.ok) return fail(400, "BAD_REQUEST", parsed.error);
      try {
        const record = ctx.metadataStore.evalDatasets.upsert({
          id: parsed.value.id,
          workspace_id: scope.workspace_id,
          user_id: scope.user_id,
          name: parsed.value.name,
          description: parsed.value.description,
          domain: parsed.value.domain,
          scoring: parsed.value.scoring,
          ...(parsed.value.judge_profile_id
            ? { judge_profile_id: parsed.value.judge_profile_id }
            : {}),
          test_cases: parsed.value.test_cases,
          ...(parsed.value.expected_revision !== undefined
            ? { expected_revision: parsed.value.expected_revision }
            : {})
        });
        const sb = await mirrorToSupabase(deps, scope, "upsert", record);
        return ok({ dataset: toDto(record), supabase: sb });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.startsWith("EVAL_DATASET_REVISION_CONFLICT") ? 409 : 500;
        return fail(status, "BAD_REQUEST", `Update failed: ${message}`);
      }
    }
    if (request.method === "DELETE") {
      try {
        ctx.metadataStore.evalDatasets.delete({
          id,
          workspace_id: scope.workspace_id,
          user_id: scope.user_id
        });
        const sb = await mirrorToSupabase(deps, scope, "delete", { id });
        return ok({ deleted: id, supabase: sb });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail(403, "BAD_REQUEST", message);
      }
    }
    return methodNotAllowed();
  }

  return null;
}
