import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

// ────────────────────────────────────────────────────────────────────────────
// Schema — three new tables for the A33 evaluation pipeline:
//
//   eval_datasets    — domain-scoped benchmark definitions (id, kind, etc.)
//                      test_cases live in payload_json for forward compatibility.
//   eval_cases       — normalized view of one test case (denormalized for fast
//                      audit queries; payload stays authoritative).
//   eval_runs        — every execution of a dataset against a model/agent.
//
// We keep dataset definitions in the existing config_resources table (kind =
// "eval-dataset") so the audit/scope/secret machinery is reusable. eval_runs
// is new because runs are append-only and high-frequency.
// ────────────────────────────────────────────────────────────────────────────

export type EvalDatasetDomain =
  | "general"
  | "code"
  | "data"
  | "rag"
  | "safety"
  | "vertical";

export type EvalScoringStrategy =
  | "exact-match"
  | "contains"
  | "regex"
  | "judge-llm"
  | "tool-call-success";

export interface EvalTestCase {
  id: string;
  input: string;
  expected_output?: string;
  /** Free-form key/value context for the case. */
  context?: Record<string, unknown>;
  /** Weight 0–1 — defaults to 1 inside the runner if missing. */
  weight?: number;
  tags?: string[];
}

export interface EvalDatasetRecord {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  description: string;
  domain: EvalDatasetDomain;
  scoring: EvalScoringStrategy;
  /** Optional LLM judge profile id (for scoring=judge-llm). */
  judge_profile_id?: string;
  test_cases: EvalTestCase[];
  builtin: boolean;
  status: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export type EvalRunStatus = "running" | "completed" | "failed" | "canceled";

export interface EvalRunRecord {
  id: string;
  workspace_id: string;
  user_id: string;
  dataset_id: string;
  dataset_revision: number;
  model_provider?: string;
  model_name?: string;
  status: EvalRunStatus;
  started_at: string;
  ended_at?: string;
  duration_ms?: number;
  /** Number of test cases in the dataset at run time. */
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  /** Weighted pass rate 0–1. */
  pass_rate: number;
  /** Per-case detail rows. */
  case_results: EvalCaseResult[];
  /** Optional reference to the originating agent run. */
  source_run_id?: string;
  /** Free-form metadata (sampling config, prompt version, etc.). */
  metadata?: Record<string, unknown>;
}

export interface EvalCaseResult {
  case_id: string;
  passed: boolean;
  score: number;
  actual_output?: string;
  reason?: string;
  duration_ms?: number;
}

export type UpsertEvalDatasetInput = {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  description: string;
  domain: EvalDatasetDomain;
  scoring: EvalScoringStrategy;
  judge_profile_id?: string;
  test_cases: EvalTestCase[];
  builtin?: boolean;
  expected_revision?: number;
};

export type CreateEvalRunInput = {
  workspace_id: string;
  user_id: string;
  dataset_id: string;
  dataset_revision: number;
  model_provider?: string;
  model_name?: string;
  total_cases: number;
  source_run_id?: string;
  metadata?: Record<string, unknown>;
};

// ────────────────────────────────────────────────────────────────────────────
// Schema bootstrap
// ────────────────────────────────────────────────────────────────────────────

export const initializeEvalSchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS eval_datasets (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      domain TEXT NOT NULL,
      scoring TEXT NOT NULL,
      judge_profile_id TEXT,
      test_cases_json TEXT NOT NULL DEFAULT '[]',
      builtin INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ready',
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id, id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_eval_datasets_scope
      ON eval_datasets(workspace_id, user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS eval_cases (
      dataset_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id, dataset_id, case_id),
      FOREIGN KEY (workspace_id, user_id, dataset_id)
        REFERENCES eval_datasets(workspace_id, user_id, id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS eval_runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      dataset_id TEXT NOT NULL,
      dataset_revision INTEGER NOT NULL,
      model_provider TEXT,
      model_name TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_ms INTEGER,
      total_cases INTEGER NOT NULL DEFAULT 0,
      passed_cases INTEGER NOT NULL DEFAULT 0,
      failed_cases INTEGER NOT NULL DEFAULT 0,
      pass_rate REAL NOT NULL DEFAULT 0,
      case_results_json TEXT NOT NULL DEFAULT '[]',
      source_run_id TEXT,
      metadata_json TEXT,
      FOREIGN KEY (workspace_id, user_id, dataset_id)
        REFERENCES eval_datasets(workspace_id, user_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_eval_runs_scope
      ON eval_runs(workspace_id, user_id, dataset_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_eval_runs_status
      ON eval_runs(workspace_id, user_id, status, started_at DESC);
  `);
};

// ────────────────────────────────────────────────────────────────────────────
// Mappers
// ────────────────────────────────────────────────────────────────────────────

type RawDatasetRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  description: string;
  domain: string;
  scoring: string;
  judge_profile_id: string | null;
  test_cases_json: string;
  builtin: number;
  status: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

type RawRunRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  dataset_id: string;
  dataset_revision: number;
  model_provider: string | null;
  model_name: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  pass_rate: number;
  case_results_json: string;
  source_run_id: string | null;
  metadata_json: string | null;
};

const isDomain = (value: string): value is EvalDatasetDomain =>
  value === "general" ||
  value === "code" ||
  value === "data" ||
  value === "rag" ||
  value === "safety" ||
  value === "vertical";

const isScoring = (value: string): value is EvalScoringStrategy =>
  value === "exact-match" ||
  value === "contains" ||
  value === "regex" ||
  value === "judge-llm" ||
  value === "tool-call-success";

const parseTestCases = (raw: string): EvalTestCase[] => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry, idx) => {
        const id = typeof entry.id === "string" ? entry.id : `case-${idx + 1}`;
        const input = typeof entry.input === "string" ? entry.input : "";
        const expected_output = typeof entry.expected_output === "string" ? entry.expected_output : undefined;
        const weight = typeof entry.weight === "number" ? entry.weight : 1;
        const context = typeof entry.context === "object" && entry.context !== null && !Array.isArray(entry.context)
          ? (entry.context as Record<string, unknown>)
          : undefined;
        const tags = Array.isArray(entry.tags)
          ? entry.tags.filter((t): t is string => typeof t === "string")
          : undefined;
        return {
          id,
          input,
          ...(expected_output !== undefined ? { expected_output } : {}),
          weight,
          ...(context ? { context } : {}),
          ...(tags ? { tags } : {})
        } satisfies EvalTestCase;
      });
  } catch {
    return [];
  }
};

const mapDataset = (row: unknown): EvalDatasetRecord | undefined => {
  if (typeof row !== "object" || row === null) return undefined;
  const r = row as RawDatasetRow;
  if (!isDomain(r.domain)) return undefined;
  if (!isScoring(r.scoring)) return undefined;
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    user_id: r.user_id,
    name: r.name,
    description: r.description,
    domain: r.domain,
    scoring: r.scoring,
    ...(r.judge_profile_id ? { judge_profile_id: r.judge_profile_id } : {}),
    test_cases: parseTestCases(r.test_cases_json),
    builtin: r.builtin === 1,
    status: r.status,
    revision: r.revision,
    created_at: r.created_at,
    updated_at: r.updated_at
  };
};

const requiredDataset = (row: unknown): EvalDatasetRecord => {
  const mapped = mapDataset(row);
  if (!mapped) {
    throw new Error("EVAL_DATASET_INVALID_ROW");
  }
  return mapped;
};

const parseCaseResults = (raw: string): EvalCaseResult[] => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry) => ({
        case_id: typeof entry.case_id === "string" ? entry.case_id : "",
        passed: entry.passed === true,
        score: typeof entry.score === "number" ? entry.score : 0,
        ...(typeof entry.actual_output === "string" ? { actual_output: entry.actual_output } : {}),
        ...(typeof entry.reason === "string" ? { reason: entry.reason } : {}),
        ...(typeof entry.duration_ms === "number" ? { duration_ms: entry.duration_ms } : {})
      }));
  } catch {
    return [];
  }
};

const mapRun = (row: unknown): EvalRunRecord | undefined => {
  if (typeof row !== "object" || row === null) return undefined;
  const r = row as RawRunRow;
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    user_id: r.user_id,
    dataset_id: r.dataset_id,
    dataset_revision: r.dataset_revision,
    ...(r.model_provider ? { model_provider: r.model_provider } : {}),
    ...(r.model_name ? { model_name: r.model_name } : {}),
    status: r.status as EvalRunStatus,
    started_at: r.started_at,
    ...(r.ended_at ? { ended_at: r.ended_at } : {}),
    ...(r.duration_ms !== null ? { duration_ms: r.duration_ms } : {}),
    total_cases: r.total_cases,
    passed_cases: r.passed_cases,
    failed_cases: r.failed_cases,
    pass_rate: r.pass_rate,
    case_results: parseCaseResults(r.case_results_json),
    ...(r.source_run_id ? { source_run_id: r.source_run_id } : {}),
    ...(r.metadata_json
      ? (() => {
          try {
            return { metadata: JSON.parse(r.metadata_json) as Record<string, unknown> };
          } catch {
            return {};
          }
        })()
      : {})
  };
};

const requiredRun = (row: unknown): EvalRunRecord => {
  const mapped = mapRun(row);
  if (!mapped) {
    throw new Error("EVAL_RUN_INVALID_ROW");
  }
  return mapped;
};

// ────────────────────────────────────────────────────────────────────────────
// Repositories
// ────────────────────────────────────────────────────────────────────────────

export class EvalDatasetRepository {
  constructor(private readonly db: Database.Database) {}

  /** Create or update one workspace-scoped evaluation dataset. */
  upsert(input: UpsertEvalDatasetInput): EvalDatasetRecord {
    const current = this.find(input);
    if (current?.builtin && input.builtin !== true) {
      throw new Error(`BUILTIN_EVAL_DATASET_READONLY:${input.id}`);
    }
    if (input.expected_revision !== undefined && current?.revision !== input.expected_revision) {
      throw new Error(`EVAL_DATASET_REVISION_CONFLICT:${input.id}`);
    }
    const now = new Date().toISOString();
    const revision = current ? current.revision + 1 : 1;
    const casesJson = JSON.stringify(input.test_cases);

    this.db.prepare(`
      INSERT INTO eval_datasets (
        id, workspace_id, user_id, name, description, domain, scoring,
        judge_profile_id, test_cases_json, builtin, status, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, user_id, id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        domain = excluded.domain,
        scoring = excluded.scoring,
        judge_profile_id = excluded.judge_profile_id,
        test_cases_json = excluded.test_cases_json,
        status = excluded.status,
        revision = excluded.revision,
        updated_at = excluded.updated_at
    `).run(
      input.id,
      input.workspace_id,
      input.user_id,
      input.name,
      input.description,
      input.domain,
      input.scoring,
      input.judge_profile_id ?? null,
      casesJson,
      (input.builtin ?? current?.builtin ?? false) ? 1 : 0,
      "ready",
      revision,
      current?.created_at ?? now,
      now
    );

    // Mirror each test case to eval_cases for downstream joins / audit.
    this.db.prepare(`
      DELETE FROM eval_cases WHERE workspace_id = ? AND user_id = ? AND dataset_id = ?
    `).run(input.workspace_id, input.user_id, input.id);
    const caseInsert = this.db.prepare(`
      INSERT INTO eval_cases (dataset_id, workspace_id, user_id, case_id, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction((cases: EvalTestCase[]) => {
      for (const c of cases) {
        caseInsert.run(
          input.id,
          input.workspace_id,
          input.user_id,
          c.id,
          JSON.stringify(c)
        );
      }
    });
    tx(input.test_cases);

    return this.get({ id: input.id, workspace_id: input.workspace_id, user_id: input.user_id });
  }

  get(input: { id: string; workspace_id: string; user_id: string }): EvalDatasetRecord {
    const record = this.find(input);
    if (!record) {
      throw new Error(`EVAL_DATASET_NOT_FOUND:${input.id}`);
    }
    return record;
  }

  find(input: { id: string; workspace_id: string; user_id: string }): EvalDatasetRecord | undefined {
    return mapDataset(this.db.prepare(`
      SELECT * FROM eval_datasets
      WHERE workspace_id = ? AND user_id = ? AND id = ?
    `).get(input.workspace_id, input.user_id, input.id));
  }

  list(input: { workspace_id: string; user_id: string; domain?: EvalDatasetDomain }): EvalDatasetRecord[] {
    const rows = input.domain
      ? this.db.prepare(`
          SELECT * FROM eval_datasets
          WHERE workspace_id = ? AND user_id = ? AND domain = ?
          ORDER BY updated_at DESC
        `).all(input.workspace_id, input.user_id, input.domain)
      : this.db.prepare(`
          SELECT * FROM eval_datasets
          WHERE workspace_id = ? AND user_id = ?
          ORDER BY updated_at DESC
        `).all(input.workspace_id, input.user_id);
    return rows.map(requiredDataset);
  }

  delete(input: { id: string; workspace_id: string; user_id: string }): void {
    const current = this.find(input);
    if (!current) return;
    if (current.builtin) {
      throw new Error(`BUILTIN_EVAL_DATASET_READONLY:${input.id}`);
    }
    this.db.prepare(`
      DELETE FROM eval_datasets WHERE workspace_id = ? AND user_id = ? AND id = ?
    `).run(input.workspace_id, input.user_id, input.id);
  }
}

export class EvalRunRepository {
  constructor(private readonly db: Database.Database) {}

  /** Begin a new run; returns the id so the caller can update it later. */
  start(input: CreateEvalRunInput & { id?: string }): EvalRunRecord {
    const id = input.id ?? randomUUID();
    this.db.prepare(`
      INSERT INTO eval_runs (
        id, workspace_id, user_id, dataset_id, dataset_revision,
        model_provider, model_name, status, started_at, total_cases,
        source_run_id, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)
    `).run(
      id,
      input.workspace_id,
      input.user_id,
      input.dataset_id,
      input.dataset_revision,
      input.model_provider ?? null,
      input.model_name ?? null,
      new Date().toISOString(),
      input.total_cases,
      input.source_run_id ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null
    );
    return this.get(id);
  }

  /** Persist final results and flip the status to completed/failed/canceled. */
  complete(input: {
    id: string;
    status: Exclude<EvalRunStatus, "running">;
    case_results: EvalCaseResult[];
  }): EvalRunRecord {
    const current = this.get(input.id);
    const endedAt = new Date().toISOString();
    const startedMs = Date.parse(current.started_at);
    const endedMs = Date.parse(endedAt);
    const durationMs = Math.max(0, endedMs - startedMs);
    const passed = input.case_results.filter((c) => c.passed).length;
    const failed = input.case_results.length - passed;
    const totalWeight = input.case_results.reduce((acc, c, idx) => {
      const w = typeof c.score === "number" ? c.score : c.passed ? 1 : 0;
      return acc + w;
    }, 0);
    const passRate = input.case_results.length > 0 ? totalWeight / input.case_results.length : 0;

    this.db.prepare(`
      UPDATE eval_runs SET
        status = ?,
        ended_at = ?,
        duration_ms = ?,
        passed_cases = ?,
        failed_cases = ?,
        pass_rate = ?,
        case_results_json = ?
      WHERE id = ?
    `).run(
      input.status,
      endedAt,
      durationMs,
      passed,
      failed,
      passRate,
      JSON.stringify(input.case_results),
      input.id
    );

    return this.get(input.id);
  }

  get(id: string): EvalRunRecord {
    const row = this.db.prepare(`SELECT * FROM eval_runs WHERE id = ?`).get(id);
    return requiredRun(row);
  }

  list(input: {
    workspace_id: string;
    user_id: string;
    dataset_id?: string;
    limit?: number;
  }): EvalRunRecord[] {
    const limit = input.limit ?? 100;
    const rows = input.dataset_id
      ? this.db.prepare(`
          SELECT * FROM eval_runs
          WHERE workspace_id = ? AND user_id = ? AND dataset_id = ?
          ORDER BY started_at DESC
          LIMIT ?
        `).all(input.workspace_id, input.user_id, input.dataset_id, limit)
      : this.db.prepare(`
          SELECT * FROM eval_runs
          WHERE workspace_id = ? AND user_id = ?
          ORDER BY started_at DESC
          LIMIT ?
        `).all(input.workspace_id, input.user_id, limit);
    return rows.map(requiredRun);
  }

  /** Roll up the latest N runs per dataset for the dashboard. */
  snapshot(input: { workspace_id: string; user_id: string; window_hours?: number }): {
    total_runs: number;
    avg_pass_rate: number;
    by_dataset: Array<{ dataset_id: string; runs: number; avg_pass_rate: number; last_run_at: string | null }>;
  } {
    const windowMs = (input.window_hours ?? 24) * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - windowMs).toISOString();
    const rows = this.db.prepare(`
      SELECT dataset_id,
             COUNT(*) as runs,
             AVG(pass_rate) as avg_pass_rate,
             MAX(started_at) as last_run_at
      FROM eval_runs
      WHERE workspace_id = ? AND user_id = ? AND started_at >= ?
      GROUP BY dataset_id
    `).all(input.workspace_id, input.user_id, cutoff) as Array<{
      dataset_id: string;
      runs: number;
      avg_pass_rate: number | null;
      last_run_at: string | null;
    }>;

    const total = rows.reduce((acc, r) => acc + r.runs, 0);
    const totalPass = rows.reduce((acc, r) => acc + (r.avg_pass_rate ?? 0) * r.runs, 0);
    const avgPass = total > 0 ? totalPass / total : 0;

    return {
      total_runs: total,
      avg_pass_rate: avgPass,
      by_dataset: rows.map((r) => ({
        dataset_id: r.dataset_id,
        runs: r.runs,
        avg_pass_rate: r.avg_pass_rate ?? 0,
        last_run_at: r.last_run_at
      }))
    };
  }
}
