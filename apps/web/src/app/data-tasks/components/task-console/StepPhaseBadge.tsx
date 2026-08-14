"use client";

import { useT } from "../../../../i18n/locale-context";
import type { StepPhase } from "../../step-phase";

const PHASE_STYLE: Record<StepPhase, { cls: string; icon: string }> = {
  search: { cls: "bg-sky-100 text-sky-700", icon: "⊕" },
  think: { cls: "bg-violet-100 text-violet-700", icon: "⊗" },
  tool: { cls: "bg-amber-100 text-amber-700", icon: "⚙" },
};

/** DSH-style Search / Think / Tool badge shown next to a ReAct step. */
export function StepPhaseBadge({ phase }: { phase: StepPhase }) {
  const t = useT();
  const s = PHASE_STYLE[phase];
  return (
    <span
      data-testid={`step-phase-${phase}`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.cls}`}
    >
      <span aria-hidden="true">{s.icon}</span>
      {t(`stepPhase.${phase}`)}
    </span>
  );
}
