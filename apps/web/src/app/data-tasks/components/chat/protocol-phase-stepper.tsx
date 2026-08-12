"use client";

import { useMemo } from "react";
import { useT } from "../../../../i18n/locale-context";
import type { LiveProtocolDefinition } from "../../live-run-state";
import {
  buildProtocolPhaseProgress,
  humanizePhaseId,
  isHumanGatePhase,
  protocolI18nNamespace,
  type ProtocolPhaseProgressItem,
} from "../../protocol-phase-progress";

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3" fill="none">
      <path
        d="M2.5 6.5l2.4 2.4L9.5 3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StepNode({
  item,
  isActive,
}: {
  item: ProtocolPhaseProgressItem;
  isActive: boolean;
}) {
  if (item.status === "completed") {
    return (
      <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-step-success/15 text-step-success">
        <CheckIcon />
      </span>
    );
  }
  if (item.status === "current") {
    return (
      <span className="relative grid h-[18px] w-[18px] shrink-0 place-items-center">
        {isActive ? (
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" />
        ) : null}
        <span className="relative h-[18px] w-[18px] rounded-full bg-primary shadow-[0_0_0_3px_var(--color-primary-light)] shadow-primary/15" />
      </span>
    );
  }
  return (
    <span className="h-[18px] w-[18px] shrink-0 rounded-full border border-border bg-surface" />
  );
}

/**
 * Cursor-style phase stepper for the governed protocol run. Renders the phase
 * track above the chat input plus the current phase's natural-language guidance
 * (Option B). Hidden when the run has no protocol definition yet.
 */
export function ProtocolPhaseStepper({
  definition,
  currentPhase,
  runStatus,
}: {
  definition: LiveProtocolDefinition | undefined;
  currentPhase: string | undefined;
  runStatus: string;
}) {
  const t = useT();
  const progress = useMemo(
    () => (definition ? buildProtocolPhaseProgress(definition, currentPhase) : null),
    [definition, currentPhase],
  );
  if (!definition || !progress || progress.items.length === 0) {
    return null;
  }

  const ns = protocolI18nNamespace(definition.protocolId);
  const phaseLabel = (phaseId: string): string => {
    const key = `protocolPhase.protocols.${ns}.${phaseId}`;
    const translated = t(key);
    return translated === key ? humanizePhaseId(phaseId) : translated;
  };
  const protocolKey = `protocolPhase.protocols.${ns}.label`;
  const protocolTranslated = t(protocolKey);
  const protocolLabel =
    protocolTranslated === protocolKey ? definition.protocolId : protocolTranslated;

  const current =
    progress.currentIndex >= 0 ? progress.items[progress.currentIndex] : undefined;
  const isLive = runStatus === "running" || runStatus === "suspended";
  const gateBadge = isHumanGatePhase(current?.id);

  return (
    <div
      data-testid="protocol-phase-stepper"
      className="pointer-events-auto mb-2 rounded-xl border border-border bg-surface/95 px-3 py-2 shadow-[0_4px_16px_-8px_rgba(15,23,42,0.18)] backdrop-blur"
    >
      <div className="flex items-center gap-2 overflow-x-auto">
        <span className="shrink-0 rounded-md bg-surface-subtle px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-light">
          {protocolLabel}
        </span>
        {progress.items.map((item, index) => (
          <div key={item.id} className="flex shrink-0 items-center gap-1.5">
            {index > 0 ? <span className="h-px w-3 bg-border" /> : null}
            <StepNode item={item} isActive={isLive && item.status === "current"} />
            <span
              className={[
                "whitespace-nowrap text-[11px] leading-4",
                item.status === "current"
                  ? "font-semibold text-foreground"
                  : item.status === "completed"
                    ? "text-muted"
                    : "text-muted-light",
              ].join(" ")}
            >
              {phaseLabel(item.id)}
            </span>
          </div>
        ))}
        {gateBadge ? (
          <span className="ml-auto shrink-0 rounded-full border border-amber-300/60 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
            {t("protocolPhase.needsYourInput")}
          </span>
        ) : null}
      </div>
      {current?.guidance ? (
        <p
          title={current.guidance}
          className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-muted"
        >
          {current.guidance}
        </p>
      ) : null}
    </div>
  );
}
