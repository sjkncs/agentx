"use client";

import { useT } from "../../../../i18n/locale-context";
import type { LiveRun } from "../../live-run-state";
import {
  computeRunStats,
  estimateCostUsd,
  estimateEtaMs,
  formatMs,
  formatTokens,
} from "../../run-stats";

/**
 * DSH-inspired bottom run-stats bar: rounds · steps | LLM time · tool time |
 * input · output tokens. Renders only once a run has produced activity.
 */
export function RunStatsBar({ liveRun }: { liveRun: LiveRun }) {
  const t = useT();
  const s = computeRunStats(liveRun);
  if (s.steps === 0 && s.rounds === 0 && s.inputTokens === 0) return null;
  const cost = estimateCostUsd(s);
  const etaMs = estimateEtaMs(liveRun, s);

  return (
    <div
      data-testid="run-stats-bar"
      className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 rounded-t-lg border border-b-0 border-border bg-surface-subtle px-3 py-1 text-[10px] text-muted-light"
    >
      <span className="tabular">
        {t("runStats.rounds", { count: s.rounds })} · {t("runStats.steps", { count: s.steps })}
      </span>
      <span aria-hidden="true" className="h-3 w-px bg-border" />
      <span className="tabular">
        {t("runStats.llm", { time: formatMs(s.llmMs) })} · {t("runStats.tool", { time: formatMs(s.toolMs) })}
      </span>
      <span aria-hidden="true" className="h-3 w-px bg-border" />
      <span className="tabular">
        {t("runStats.tokens", {
          in: formatTokens(s.inputTokens),
          out: formatTokens(s.outputTokens),
        })}
      </span>
      <span aria-hidden="true" className="h-3 w-px bg-border" />
      <span className="tabular" title={t("runStats.costHint")}>
        {t("runStats.cost", { usd: cost < 0.01 ? "<$0.01" : `$${cost.toFixed(3)}` })}
      </span>
      {etaMs !== null ? (
        <>
          <span aria-hidden="true" className="h-3 w-px bg-border" />
          <span className="tabular" title={t("runStats.etaHint")}>
            {t("runStats.eta", { time: formatMs(etaMs) })}
          </span>
        </>
      ) : null}
    </div>
  );
}
