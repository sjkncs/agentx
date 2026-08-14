"use client";

import { useEffect, useState } from "react";
import { useT } from "../../../../i18n/locale-context";
import type { LiveRun } from "../../live-run-state";
import { computeRunStats, formatTokens } from "../../run-stats";

/**
 * DSH-style floating stats ball: live token throughput + cache hit rate.
 * Fixed to the bottom-right; collapses/expands on click.
 */
export function FloatingStatsBall({
  liveRun,
  cacheHitRate,
}: {
  liveRun: LiveRun;
  cacheHitRate?: number | undefined;
}) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [, setTick] = useState(0);

  // Refresh the rate ~1s while a run is active.
  const active = liveRun.runStatus === "running" || liveRun.runStatus === "suspended";
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  const s = computeRunStats(liveRun);
  const totalTokens = s.inputTokens + s.outputTokens;
  const ratePerSec = s.totalMs > 0 ? Math.round((totalTokens / s.totalMs) * 1000) : 0;

  if (totalTokens === 0) return null;

  return (
    <button
      type="button"
      data-testid="floating-stats-ball"
      onClick={() => setOpen((o) => !o)}
      className="fixed bottom-4 right-4 z-40 grid cursor-pointer place-items-center rounded-full border border-border bg-surface px-3 py-2 text-[10px] shadow-[0_4px_16px_rgba(0,0,0,0.15)]"
      title={t("statsBall.title")}
    >
      {open ? (
        <span className="tabular grid gap-0.5 text-left">
          <span className="font-semibold text-foreground">
            {formatTokens(totalTokens)} tok
          </span>
          <span className="text-muted">{ratePerSec} tok/s</span>
          <span className="text-step-success">
            {t("statsBall.cache", {
              rate: cacheHitRate !== undefined ? `${Math.round(cacheHitRate * 100)}%` : "–",
            })}
          </span>
        </span>
      ) : (
        <span className="tabular font-semibold text-foreground">
          {formatTokens(totalTokens)}
        </span>
      )}
    </button>
  );
}
