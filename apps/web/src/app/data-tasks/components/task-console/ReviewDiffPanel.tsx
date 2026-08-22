/**
 * Review Diff Panel - diff/worktree UI for the data-tasks console
 *
 * 借鉴 ZCode "对话式版本管理"：每个 AI 改动都能在 UI 里看 diff。
 * 此组件是 fallback-first：
 *   - 优先调 `/api/v1/worktree/diff` (服务器跑的 WorktreeHelper)
 *   - 失败时降级到本地 CLI 调用（要求 capability gate 启用）
 *   - 都没法用时显示静态提示
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  btnGhostClass,
  btnPrimaryClass,
  btnSecondaryClass,
  chipClass,
  emptyStateClass,
  panelShellClass,
  panelTitleClass,
  sectionLabelClass,
} from "../../ui-tokens";

// ============================================================================
// Types (mirror harness-core WorktreeHelper result)
// ============================================================================

export type DiffFileChange = "A" | "M" | "D" | "R";

export interface DiffFile {
  file: string;
  changeType: DiffFileChange;
  additions: number;
  deletions: number;
  patch: string;
  binary?: boolean;
}

export interface DiffResult {
  base: string;
  head: string;
  files: DiffFile[];
  totalAdditions: number;
  totalDeletions: number;
}

export interface ReviewDiffPanelProps {
  /** 默认 base ref */
  defaultBase?: string;
  /** 默认 head ref */
  defaultHead?: string;
  /** 工作目录（用于 git worktree 推断） */
  workdir?: string;
  /** 可选：自定义 fetcher，便于测试 */
  fetchDiff?: (req: { base: string; head: string; workdir?: string }) => Promise<DiffResult>;
}

// ============================================================================
// Default fetcher: 调 /api/v1/worktree/diff
// ============================================================================

async function defaultFetchDiff(req: { base: string; head: string; workdir?: string }): Promise<DiffResult> {
  const resp = await fetch("/api/v1/worktree/diff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      base: req.base,
      head: req.head,
      ...(req.workdir ? { workdir: req.workdir } : {}),
    }),
  });
  if (!resp.ok) {
    throw new Error(`diff fetch failed (${resp.status})`);
  }
  return (await resp.json()) as DiffResult;
}

// ============================================================================
// Component
// ============================================================================

export function ReviewDiffPanel(props: ReviewDiffPanelProps) {
  const { defaultBase = "main", defaultHead = "HEAD", workdir, fetchDiff = defaultFetchDiff } = props;
  const [base, setBase] = useState(defaultBase);
  const [head, setHead] = useState(defaultHead);
  const [result, setResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchDiff({ base, head, workdir });
      setResult(next);
      setOpenFile(next.files[0]?.file ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [base, head, workdir, fetchDiff]);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className={panelShellClass} data-testid="review-diff-panel">
      <header className="flex items-center justify-between gap-2">
        <h3 className={panelTitleClass}>Review · Diff</h3>
        <span className={chipClass}>{result ? `${result.files.length} files` : "—"}</span>
      </header>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className={sectionLabelClass}>Base</span>
          <input
            type="text"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            className="h-8 w-32 rounded-md border border-border bg-surface px-2 font-mono text-xs text-foreground"
            data-testid="diff-base"
          />
        </label>
        <label className="grid gap-1">
          <span className={sectionLabelClass}>Head</span>
          <input
            type="text"
            value={head}
            onChange={(e) => setHead(e.target.value)}
            className="h-8 w-32 rounded-md border border-border bg-surface px-2 font-mono text-xs text-foreground"
            data-testid="diff-head"
          />
        </label>
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className={`h-8 ${btnPrimaryClass} disabled:cursor-not-allowed disabled:opacity-60`}
          data-testid="diff-run"
        >
          {loading ? "Loading…" : "Diff"}
        </button>
        {result ? (
          <span className="ml-auto flex items-center gap-2">
            <span className="rounded-full bg-step-success/10 px-2 py-0.5 text-[11px] font-semibold text-step-success">
              +{result.totalAdditions}
            </span>
            <span className="rounded-full bg-step-error/10 px-2 py-0.5 text-[11px] font-semibold text-step-error">
              −{result.totalDeletions}
            </span>
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 rounded-md bg-step-error/10 p-2 text-[11px] text-step-error" data-testid="diff-error">
          {error}
        </p>
      ) : null}

      {!result && !error && !loading ? (
        <p className={`mt-3 ${emptyStateClass} p-4 text-xs text-muted-light`}>
          Enter two git refs (branches, tags, or commit SHA) and press Diff.
        </p>
      ) : null}

      {result && result.files.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-border bg-surface-subtle p-3 text-center text-xs text-muted-light">
          No changes between <code>{base}</code> and <code>{head}</code>.
        </p>
      ) : null}

      {result && result.files.length > 0 ? (
        <div className="mt-3 grid gap-3 md:grid-cols-[260px_1fr]">
          <ul className="max-h-72 overflow-y-auto rounded-lg border border-border bg-surface-subtle">
            {result.files.map((f) => {
              const active = f.file === openFile;
              return (
                <li key={f.file} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setOpenFile(f.file)}
                    className={[
                      "flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left transition-colors duration-150",
                      active ? "bg-primary-light/10" : "hover:bg-surface",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "shrink-0 rounded-full px-1.5 text-[10px] font-bold",
                        f.changeType === "A"
                          ? "bg-step-success/15 text-step-success"
                          : f.changeType === "D"
                            ? "bg-step-error/15 text-step-error"
                            : "bg-step-knowledge/15 text-step-knowledge",
                      ].join(" ")}
                    >
                      {f.changeType}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{f.file}</span>
                    <span className="shrink-0 text-[10px] text-muted-light">
                      <span className="text-step-success">+{f.additions}</span>
                      {" "}
                      <span className="text-step-error">−{f.deletions}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="min-w-0 rounded-lg border border-border bg-surface">
            {openFile ? (
              <PatchView file={result.files.find((f) => f.file === openFile) ?? null} />
            ) : (
              <p className="p-4 text-xs text-muted-light">Select a file to view its patch.</p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PatchView({ file }: { file: DiffFile | null }) {
  if (!file) return null;
  return (
    <div className="flex h-full min-h-32 flex-col">
      <div className="flex items-center justify-between border-b border-border bg-surface-subtle px-3 py-2">
        <span className="truncate font-mono text-xs font-semibold text-foreground">{file.file}</span>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-step-success/10 px-2 py-0.5 text-[10px] font-semibold text-step-success">
            +{file.additions}
          </span>
          <span className="rounded-full bg-step-error/10 px-2 py-0.5 text-[10px] font-semibold text-step-error">
            −{file.deletions}
          </span>
        </div>
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[11px] leading-5 text-muted">
        {file.binary ? <em>(binary file, patch not shown)</em> : file.patch || <em>(empty patch)</em>}
      </pre>
    </div>
  );
}

// ============================================================================
// Test helpers
// ============================================================================

export function createMockDiffResult(overrides: Partial<DiffResult> = {}): DiffResult {
  return {
    base: overrides.base ?? "main",
    head: overrides.head ?? "HEAD",
    files: overrides.files ?? [
      {
        file: "src/example.ts",
        changeType: "M",
        additions: 8,
        deletions: 2,
        patch: "@@ -1,3 +1,9 @@\n unchanged\n+added line\n-removed line",
      },
    ],
    totalAdditions: overrides.totalAdditions ?? 8,
    totalDeletions: overrides.totalDeletions ?? 2,
  };
}
