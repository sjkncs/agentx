"use client";

import { useT } from "../../../../i18n/locale-context";
import type { LiveRun } from "../../live-run-state";

/** i18n keys (under `followUp`) for the candidate follow-up suggestions. */
export type FollowUpSuggestionKey =
  | "suggestionExportResults"
  | "suggestionSummarizeOutputs"
  | "suggestionGoDeeper";

/**
 * Pure, deterministic builder for follow-up suggestion chips after a completed run.
 * Kept free of React so it is unit-testable.
 */
export function buildFollowUpSuggestions(input: {
  runStatus: string;
  auditsCount: number;
  artifactsCount: number;
}): FollowUpSuggestionKey[] {
  if (input.runStatus !== "completed") return [];
  const keys: FollowUpSuggestionKey[] = [];
  if (input.auditsCount > 0) keys.push("suggestionExportResults");
  if (input.artifactsCount > 0) keys.push("suggestionSummarizeOutputs");
  keys.push("suggestionGoDeeper");
  return keys.slice(0, 3);
}

/**
 * Renders 2-3 context-aware follow-up chips above the chat input once a run
 * completes. Clicking a chip injects its localized text into the composer via
 * `onPick` (wired to the draft-prompt mechanism).
 */
export function FollowUpSuggestionChips({
  liveRun,
  onPick,
}: {
  liveRun: LiveRun;
  onPick: (text: string) => void;
}) {
  const t = useT();
  const keys = buildFollowUpSuggestions({
    runStatus: liveRun.runStatus,
    auditsCount: liveRun.audits.length,
    artifactsCount: liveRun.artifacts.length,
  });
  if (keys.length === 0) return null;

  return (
    <div
      data-testid="follow-up-suggestions"
      className="pointer-events-auto mb-2 flex flex-wrap gap-1.5 px-0.5"
    >
      <span className="self-center text-[11px] font-medium text-muted-light">
        {t("followUp.labelPrefix")}
      </span>
      {keys.map((key) => {
        const label = t(`followUp.${key}`);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onPick(label)}
            className="cursor-pointer rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-muted transition-colors duration-150 hover:border-primary/40 hover:bg-primary-light/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
