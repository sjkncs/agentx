"use client";

import React from "react";
import { useEffect, useState } from "react";
import { useT } from "../../../../i18n/locale-context";
import {
  panelShellClass,
  panelTitleClass,
  emptyStateClass,
  btnSecondaryClass,
  btnGhostClass,
} from "../../ui-tokens";

/**
 * DiffViewer - lightweight "Review/diff" entry point.
 *
 * The user complained that git diff / version management had no
 * first-class surface in the UI: they had to keep asking in chat.
 * This panel calls /api/diff (server side WorktreeHelper) and
 * renders a file list with expandable patches.
 *
 * Defaults to base=main, head=HEAD; both inputs are editable.
 */

export interface DiffViewerProps {
  /** Absolute filesystem path to the git repo. If omitted, /api/diff returns an error. */
  repoPath?: string;
  base?: string;
  head?: string;
}

interface DiffFileSummary {
  file: string;
  changeType: "A" | "M" | "D" | "R";
  additions: number;
  deletions: number;
  binary?: boolean;
  patch?: string;
}

interface DiffResultPayload {
  base: string;
  head: string;
  files: DiffFileSummary[];
  totalAdditions: number;
  totalDeletions: number;
}

interface DiffApiResponse {
  ok: boolean;
  data?: DiffResultPayload;
  error?: string;
}

export function DiffViewer({ repoPath, base = "main", head = "HEAD" }: DiffViewerProps) {
  const t = useT();
  const [b, setB] = useState(base);
  const [h, setH] = useState(head);
  const [result, setResult] = useState<DiffResultPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  // Whether the entire panel body (input row + file list) is collapsed.
  const [open, setOpen] = useState(false);

  const [repoInput, setRepoInput] = useState<string>(repoPath ?? "");

  useEffect(() => {
    setRepoInput(repoPath ?? "");
  }, [repoPath]);

  const fetchDiff = async () => {
    const effective = repoPath ?? repoInput.trim();
    if (!effective) return;
    setLoading(true);
    setError(null);
    try {
      const url = `/api/diff?repo=${encodeURIComponent(effective)}&base=${encodeURIComponent(b)}&head=${encodeURIComponent(h)}`;
      const resp = await fetch(url, { credentials: "include" });
      const json = (await resp.json()) as DiffApiResponse;
      if (!json.ok || !json.data) {
        setError(json.error || t("diff.error"));
        setResult(null);
        return;
      }
      setResult(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("diff.error"));
    } finally {
      setLoading(false);
    }
  };

  // Re-fetch when the user toggles the panel open, edits base/head, or enters a repo path.
  useEffect(() => {
    if (!open) return;
    void fetchDiff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, b, h, repoInput, repoPath]);

  const toggleFile = (file: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  return (
    <section data-testid="diff-viewer" className={panelShellClass}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="mb-1 flex w-full cursor-pointer items-center justify-between gap-2 rounded-md text-left transition-colors hover:bg-surface-subtle"
      >
        <h3 className={panelTitleClass}>{t("diff.title")}</h3>
        <span className="flex items-center gap-2 text-[11px] text-muted-light">
          <span>
            {result
              ? `${result.files.length} files · +${result.totalAdditions} / -${result.totalDeletions}`
              : t("diff.empty")}
          </span>
          <span
            aria-hidden="true"
            className={[
              "inline-flex h-6 w-6 items-center justify-center rounded-md transition-transform duration-200",
              open ? "rotate-180" : "",
            ].join(" ")}
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="m4 6 4 4 4-4" />
            </svg>
          </span>
        </span>
      </button>

      {open ? (
        <>
          <p
            data-testid="diff-hint"
            className="mb-2 rounded-md border border-border/60 bg-surface-subtle px-2 py-1.5 text-[11px] text-muted-light"
          >
            {t("diff.hint")}
          </p>
          <label className="mb-2 grid gap-1 text-[11px] text-muted-light">
            {t("diff.repo")}
            <input
              type="text"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              placeholder={t("diff.repoPlaceholder")}
              className="h-7 w-full rounded-md border border-border bg-surface px-2 font-mono text-xs text-foreground"
            />
          </label>
      <div className="mb-3 flex items-center gap-2">
        <label className="grid gap-1 text-[11px] text-muted-light">
          {t("diff.base")}
          <input
            type="text"
            value={b}
            onChange={(e) => setB(e.target.value)}
            className="h-7 w-40 rounded-md border border-border bg-surface px-2 font-mono text-xs text-foreground"
          />
        </label>
        <label className="grid gap-1 text-[11px] text-muted-light">
          {t("diff.head")}
          <input
            type="text"
            value={h}
            onChange={(e) => setH(e.target.value)}
            className="h-7 w-40 rounded-md border border-border bg-surface px-2 font-mono text-xs text-foreground"
          />
        </label>
        <button
          type="button"
          onClick={() => void fetchDiff()}
          disabled={loading}
          className={`${btnSecondaryClass} disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {loading ? t("diff.loading") : t("diff.refresh")}
        </button>
      </div>

      {error ? (
        <p className="mb-2 rounded-lg bg-step-error/10 px-3 py-2 text-xs text-step-error">
          {error}
        </p>
      ) : null}

      {result && result.files.length === 0 ? (
        <p className={`${emptyStateClass} text-center text-xs`}>{t("diff.noChanges")}</p>
      ) : null}

      {result && result.files.length > 0 ? (
        <ol className="grid gap-1.5">
          {result.files.map((file) => {
            const isExpanded = expandedFiles.has(file.file);
            return (
              <li
                key={file.file}
                className="overflow-hidden rounded-lg border border-border bg-surface-subtle"
              >
                <button
                  type="button"
                  onClick={() => toggleFile(file.file)}
                  className="flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-surface"
                >
                  <ChangeTypeBadge type={file.changeType} />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                    {file.file}
                  </span>
                  <span className="shrink-0 tabular font-mono text-[10px] text-step-success">
                    +{file.additions}
                  </span>
                  <span className="shrink-0 tabular font-mono text-[10px] text-step-error">
                    -{file.deletions}
                  </span>
                  <span
                    className={`${btnGhostClass} text-[10px] text-muted-light`}
                    aria-label={isExpanded ? "collapse" : "expand"}
                  >
                    {isExpanded ? "-" : "+"}
                  </span>
                </button>
                {isExpanded && file.patch ? (
                  <pre className="max-h-72 overflow-auto border-t border-border bg-code-bg p-2 font-mono text-[10px] leading-4 text-slate-100">
                    <code>{file.patch}</code>
                  </pre>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
        </>
      ) : null}
    </section>
  );
}

function ChangeTypeBadge({ type }: { type: DiffFileSummary["changeType"] }) {
  const tone =
    type === "A"
      ? "bg-step-success/15 text-step-success"
      : type === "D"
        ? "bg-step-error/15 text-step-error"
        : "bg-primary/15 text-primary";
  return (
    <span
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-semibold ${tone}`}
    >
      {type}
    </span>
  );
}
