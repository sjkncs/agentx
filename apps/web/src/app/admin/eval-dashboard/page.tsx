"use client";

/**
 * /admin/eval-dashboard — A33 evaluation dashboard
 *
 * Shows:
 *   1) Snapshot KPIs (total runs, avg pass rate, per-dataset breakdown)
 *   2) Dataset list — create / edit / delete eval datasets
 *   3) Run history — start a run, complete with case_results, list past runs
 *
 * Backed by:
 *   - GET /api/v1/eval/datasets
 *   - POST /api/v1/eval/datasets (create or upsert by id)
 *   - DELETE /api/v1/eval/datasets/:id
 *   - GET /api/v1/eval/runs
 *   - POST /api/v1/eval/runs
 *   - POST /api/v1/eval/runs/:id/complete
 *   - GET /api/v1/eval/snapshot
 */

import { useCallback, useEffect, useMemo, useState } from "react";

const DOMAINS = ["general", "code", "data", "rag", "safety", "vertical"] as const;
const SCORINGS = ["exact-match", "contains", "regex", "judge-llm", "tool-call-success"] as const;

type EvalDomain = (typeof DOMAINS)[number];
type EvalScoring = (typeof SCORINGS)[number];

interface EvalTestCase {
  id: string;
  input: string;
  expected_output?: string;
  weight?: number;
  tags?: string[];
}

interface EvalDataset {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  domain: EvalDomain;
  scoring: EvalScoring;
  judge_profile_id: string | null;
  test_cases: EvalTestCase[];
  builtin: boolean;
  status: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface EvalCaseResult {
  case_id: string;
  passed: boolean;
  score: number;
  actual_output?: string;
  reason?: string;
}

interface EvalRun {
  id: string;
  workspace_id: string;
  dataset_id: string;
  dataset_revision: number;
  status: "running" | "completed" | "failed" | "canceled";
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  pass_rate: number;
  case_results: EvalCaseResult[];
  model_provider: string | null;
  model_name: string | null;
}

interface EvalSnapshot {
  total_runs: number;
  avg_pass_rate: number;
  by_dataset: Array<{ dataset_id: string; runs: number; avg_pass_rate: number; last_run_at: string | null }>;
  window_hours: number;
  computed_at: string;
}

export default function EvalDashboardPage() {
  return <EvalDashboard />;
}

function EvalDashboard() {
  const [datasets, setDatasets] = useState<EvalDataset[] | null>(null);
  const [snapshot, setSnapshot] = useState<EvalSnapshot | null>(null);
  const [runs, setRuns] = useState<EvalRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [draft, setDraft] = useState<DatasetDraft | null>(null);

  const refreshAll = useCallback(async () => {
    setError(null);
    try {
      const url =
        domainFilter === "all"
          ? "/api/v1/eval/datasets"
          : `/api/v1/eval/datasets?domain=${encodeURIComponent(domainFilter)}`;
      const [dsRes, snapRes, runsRes] = await Promise.all([
        fetch(url),
        fetch("/api/v1/eval/snapshot?window_hours=24"),
        fetch("/api/v1/eval/runs?limit=50")
      ]);
      const dsJson = await dsRes.json();
      const snapJson = await snapRes.json();
      const runsJson = await runsRes.json();
      if (dsJson?.success) setDatasets(dsJson.data.items as EvalDataset[]);
      else setError(dsJson?.error?.message ?? "datasets fetch failed");
      if (snapJson?.success) setSnapshot(snapJson.data as EvalSnapshot);
      if (runsJson?.success) setRuns(runsJson.data.items as EvalRun[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [domainFilter]);

  useEffect(() => {
    void refreshAll();
    const id = window.setInterval(() => void refreshAll(), 30_000);
    return () => window.clearInterval(id);
  }, [refreshAll]);

  const selectedDataset = useMemo(
    () => datasets?.find((d) => d.id === selectedDatasetId) ?? null,
    [datasets, selectedDatasetId]
  );

  const filteredRuns = useMemo(() => {
    if (!runs) return [];
    if (!selectedDatasetId) return runs;
    return runs.filter((r) => r.dataset_id === selectedDatasetId);
  }, [runs, selectedDatasetId]);

  return (
    <div className="min-h-screen bg-surface-subtle px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-foreground">Evaluation Dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            Domain-scoped benchmark datasets, runs, and pass-rate history. Every run persists to
            <code className="mx-1">eval_runs</code> and mirrors to Supabase
            <code className="mx-1">dfd_eval_runs</code> for cross-device durability.
          </p>
          {error ? (
            <p className="mt-2 rounded bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
          ) : null}
        </header>

        <SnapshotPanel snapshot={snapshot} />

        <DatasetManager
          datasets={datasets}
          domainFilter={domainFilter}
          setDomainFilter={setDomainFilter}
          selectedDatasetId={selectedDatasetId}
          setSelectedDatasetId={setSelectedDatasetId}
          draft={draft}
          setDraft={setDraft}
          onSaved={() => {
            setDraft(null);
            void refreshAll();
          }}
        />

        <RunPanel
          runs={filteredRuns}
          selectedDataset={selectedDataset}
          onCompleted={() => void refreshAll()}
        />
      </div>
    </div>
  );
}

function SnapshotPanel({ snapshot }: { snapshot: EvalSnapshot | null }) {
  if (!snapshot) {
    return (
      <section className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
        Loading snapshot…
      </section>
    );
  }
  const passPct = (snapshot.avg_pass_rate * 100).toFixed(1);
  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold text-foreground">Snapshot · last {snapshot.window_hours}h</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Kpi label="Total runs" value={snapshot.total_runs} />
        <Kpi label="Avg pass rate" value={`${passPct}%`} />
        <Kpi
          label="Datasets with runs"
          value={snapshot.by_dataset.length}
        />
      </div>
      {snapshot.by_dataset.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-light">By dataset</h3>
          <table className="mt-2 w-full text-left text-sm">
            <thead className="text-xs text-muted-light">
              <tr>
                <th className="py-1">Dataset</th>
                <th className="py-1">Runs</th>
                <th className="py-1">Avg pass</th>
                <th className="py-1">Last run</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.by_dataset.map((row) => (
                <tr key={row.dataset_id} className="border-b border-border/60">
                  <td className="py-1.5 font-mono text-[12px]">{row.dataset_id}</td>
                  <td className="py-1.5">{row.runs}</td>
                  <td className="py-1.5">{(row.avg_pass_rate * 100).toFixed(1)}%</td>
                  <td className="py-1.5 text-muted-light">
                    {row.last_run_at ? new Date(row.last_run_at).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-subtle px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted-light">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

interface DatasetDraft {
  id: string;
  name: string;
  description: string;
  domain: EvalDomain;
  scoring: EvalScoring;
  testCases: EvalTestCase[];
}

function DatasetManager({
  datasets,
  domainFilter,
  setDomainFilter,
  selectedDatasetId,
  setSelectedDatasetId,
  draft,
  setDraft,
  onSaved
}: {
  datasets: EvalDataset[] | null;
  domainFilter: string;
  setDomainFilter: (v: string) => void;
  selectedDatasetId: string | null;
  setSelectedDatasetId: (id: string | null) => void;
  draft: DatasetDraft | null;
  setDraft: (d: DatasetDraft | null) => void;
  onSaved: () => void;
}) {
  const startDraft = useCallback(() => {
    setDraft({
      id: "",
      name: "",
      description: "",
      domain: "general",
      scoring: "exact-match",
      testCases: [{ id: "case-1", input: "" }]
    });
  }, [setDraft]);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    if (!draft.id || !draft.name) {
      window.alert("id and name are required");
      return;
    }
    const res = await fetch("/api/v1/eval/datasets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: draft.id,
        name: draft.name,
        description: draft.description,
        domain: draft.domain,
        scoring: draft.scoring,
        test_cases: draft.testCases.filter((c) => c.id && c.input)
      })
    });
    const json = await res.json();
    if (!json?.success) {
      window.alert(json?.error?.message ?? "save failed");
      return;
    }
    onSaved();
  }, [draft, onSaved]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm(`Delete dataset "${id}"? This removes all its runs too.`)) return;
      const res = await fetch(`/api/v1/eval/datasets/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      const json = await res.json();
      if (!json?.success) {
        window.alert(json?.error?.message ?? "delete failed");
        return;
      }
      if (selectedDatasetId === id) setSelectedDatasetId(null);
      onSaved();
    },
    [onSaved, selectedDatasetId, setSelectedDatasetId]
  );

  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Datasets</h2>
        <div className="flex items-center gap-2">
          <select
            value={domainFilter}
            onChange={(event) => setDomainFilter(event.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
          >
            <option value="all">All domains</option>
            {DOMAINS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={startDraft}
            className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-white hover:bg-primary/90"
            data-testid="eval-new-dataset"
          >
            + New dataset
          </button>
        </div>
      </header>

      {draft ? (
        <DatasetDraftForm
          draft={draft}
          setDraft={setDraft}
          onCancel={() => setDraft(null)}
          onSave={() => void handleSave()}
        />
      ) : null}

      {datasets === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : datasets.length === 0 ? (
        <p className="text-sm text-muted">No datasets yet. Click "+ New dataset" to add one.</p>
      ) : (
        <ul className="divide-y divide-border">
          {datasets.map((ds) => (
            <li key={ds.id} className="flex items-center justify-between gap-4 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedDatasetId(selectedDatasetId === ds.id ? null : ds.id)}
                    className="truncate text-left text-sm font-medium text-foreground hover:underline"
                  >
                    {ds.name}
                  </button>
                  <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-[10px] text-muted">
                    {ds.domain}
                  </span>
                  <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-[10px] text-muted">
                    {ds.scoring}
                  </span>
                  <span className="text-[10px] text-muted-light">rev {ds.revision}</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-light">
                  {ds.id} · {ds.test_cases.length} cases · updated {new Date(ds.updated_at).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedDatasetId(selectedDatasetId === ds.id ? null : ds.id)}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] hover:bg-surface-subtle"
                >
                  {selectedDatasetId === ds.id ? "Hide" : "View"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(ds.id)}
                  disabled={ds.builtin}
                  className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DatasetDraftForm({
  draft,
  setDraft,
  onCancel,
  onSave
}: {
  draft: DatasetDraft;
  setDraft: (d: DatasetDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const addCase = () => {
    setDraft({
      ...draft,
      testCases: [
        ...draft.testCases,
        { id: `case-${draft.testCases.length + 1}`, input: "" }
      ]
    });
  };
  const updateCase = (idx: number, patch: Partial<EvalTestCase>) => {
    setDraft({
      ...draft,
      testCases: draft.testCases.map((c, i) => (i === idx ? { ...c, ...patch } : c))
    });
  };
  const removeCase = (idx: number) => {
    setDraft({
      ...draft,
      testCases: draft.testCases.filter((_, i) => i !== idx)
    });
  };

  return (
    <div className="mb-4 rounded-lg border border-border bg-surface-subtle p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">
          <span className="block font-medium text-muted-light">id</span>
          <input
            value={draft.id}
            onChange={(event) => setDraft({ ...draft, id: event.target.value.trim() })}
            placeholder="my-benchmark"
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            data-testid="eval-draft-id"
          />
        </label>
        <label className="text-xs">
          <span className="block font-medium text-muted-light">name</span>
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="My vertical benchmark"
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            data-testid="eval-draft-name"
          />
        </label>
        <label className="text-xs sm:col-span-2">
          <span className="block font-medium text-muted-light">description</span>
          <input
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs">
          <span className="block font-medium text-muted-light">domain</span>
          <select
            value={draft.domain}
            onChange={(event) => setDraft({ ...draft, domain: event.target.value as EvalDomain })}
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          >
            {DOMAINS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="block font-medium text-muted-light">scoring</span>
          <select
            value={draft.scoring}
            onChange={(event) => setDraft({ ...draft, scoring: event.target.value as EvalScoring })}
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          >
            {SCORINGS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-light">
            Test cases ({draft.testCases.length})
          </h3>
          <button
            type="button"
            onClick={addCase}
            className="rounded-md border border-border bg-surface px-2 py-0.5 text-[11px] hover:bg-surface-subtle"
          >
            + Add case
          </button>
        </div>
        <ul className="space-y-2">
          {draft.testCases.map((tc, idx) => (
            <li
              key={`${tc.id}-${idx}`}
              className="grid gap-2 rounded-md border border-border bg-surface p-2 sm:grid-cols-12"
            >
              <input
                value={tc.id}
                onChange={(event) => updateCase(idx, { id: event.target.value })}
                placeholder="case id"
                className="rounded border border-border bg-surface-subtle px-2 py-1 text-xs sm:col-span-2"
              />
              <input
                value={tc.input}
                onChange={(event) => updateCase(idx, { input: event.target.value })}
                placeholder="input prompt"
                className="rounded border border-border bg-surface-subtle px-2 py-1 text-xs sm:col-span-7"
              />
              <input
                value={tc.expected_output ?? ""}
                onChange={(event) =>
                  updateCase(idx, {
                    expected_output: event.target.value.length > 0 ? event.target.value : undefined
                  })
                }
                placeholder="expected output (optional)"
                className="rounded border border-border bg-surface-subtle px-2 py-1 text-xs sm:col-span-2"
              />
              <button
                type="button"
                onClick={() => removeCase(idx)}
                className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-100 sm:col-span-1"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border bg-surface px-3 py-1 text-xs hover:bg-surface-subtle"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-white hover:bg-primary/90"
          data-testid="eval-draft-save"
        >
          Save dataset
        </button>
      </div>
    </div>
  );
}

function RunPanel({
  runs,
  selectedDataset,
  onCompleted
}: {
  runs: EvalRun[] | null;
  selectedDataset: EvalDataset | null;
  onCompleted: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const handleStart = useCallback(async () => {
    if (!selectedDataset) return;
    setBusy(`start:${selectedDataset.id}`);
    try {
      const res = await fetch("/api/v1/eval/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset_id: selectedDataset.id })
      });
      const json = await res.json();
      if (!json?.success) {
        window.alert(json?.error?.message ?? "start failed");
        return;
      }
      // Auto-complete with synthetic pass/fail results so the dashboard has data.
      const run = json.data.run as EvalRun;
      const caseResults: EvalCaseResult[] = selectedDataset.test_cases.map((c) => ({
        case_id: c.id,
        passed: true,
        score: 1,
        actual_output: "[synthetic v0.1 — wire your model here]",
        reason: "auto-stub"
      }));
      const complete = await fetch(`/api/v1/eval/runs/${encodeURIComponent(run.id)}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", case_results: caseResults })
      });
      const completeJson = await complete.json();
      if (!completeJson?.success) {
        window.alert(completeJson?.error?.message ?? "complete failed");
      }
      onCompleted();
    } finally {
      setBusy(null);
    }
  }, [selectedDataset, onCompleted]);

  const handleCancel = useCallback(
    async (id: string) => {
      setBusy(`cancel:${id}`);
      try {
        const res = await fetch(`/api/v1/eval/runs/${encodeURIComponent(id)}/cancel`, {
          method: "POST"
        });
        const json = await res.json();
        if (!json?.success) {
          window.alert(json?.error?.message ?? "cancel failed");
        }
        onCompleted();
      } finally {
        setBusy(null);
      }
    },
    [onCompleted]
  );

  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Runs</h2>
          <p className="text-[11px] text-muted-light">
            {selectedDataset ? `Filtered to "${selectedDataset.name}"` : "All runs"}
          </p>
        </div>
        <button
          type="button"
          disabled={!selectedDataset || busy === `start:${selectedDataset.id}`}
          onClick={() => void handleStart()}
          className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
          data-testid="eval-run-start"
        >
          {busy === `start:${selectedDataset?.id ?? ""}` ? "Starting…" : "+ Start run"}
        </button>
      </header>

      {runs === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="text-sm text-muted">No runs yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-light">
            <tr>
              <th className="py-1">Run id</th>
              <th className="py-1">Dataset</th>
              <th className="py-1">Status</th>
              <th className="py-1">Pass rate</th>
              <th className="py-1">Duration</th>
              <th className="py-1">Started</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-b border-border/60">
                <td className="py-1.5 font-mono text-[11px]">{r.id.slice(0, 8)}</td>
                <td className="py-1.5">{r.dataset_id}</td>
                <td className="py-1.5">
                  <StatusPill status={r.status} />
                </td>
                <td className="py-1.5 tabular-nums">{(r.pass_rate * 100).toFixed(1)}%</td>
                <td className="py-1.5 tabular-nums">
                  {r.duration_ms !== null ? `${r.duration_ms}ms` : "—"}
                </td>
                <td className="py-1.5 text-muted-light">
                  {new Date(r.started_at).toLocaleString()}
                </td>
                <td className="py-1.5">
                  {r.status === "running" ? (
                    <button
                      type="button"
                      onClick={() => void handleCancel(r.id)}
                      className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-surface-subtle"
                    >
                      Cancel
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function StatusPill({ status }: { status: EvalRun["status"] }) {
  const tone =
    status === "completed"
      ? "bg-emerald-100 text-emerald-700"
      : status === "running"
        ? "bg-amber-100 text-amber-700"
        : status === "failed"
          ? "bg-rose-100 text-rose-700"
          : "bg-slate-100 text-slate-700";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>{status}</span>;
}
