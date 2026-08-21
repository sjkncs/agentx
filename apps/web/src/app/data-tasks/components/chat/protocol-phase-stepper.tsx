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
  isFirst,
  isLast,
}: {
  item: ProtocolPhaseProgressItem;
  isActive: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  const baseDot =
    "grid h-4 w-4 shrink-0 place-items-center rounded-full";
  return (
    <div className="relative flex shrink-0 flex-col items-center">
      {/* vertical connector above */}
      {isFirst ? null : (
        <span
          aria-hidden="true"
          className={[
            "absolute -top-2 left-1/2 h-2 w-px -translate-x-1/2",
            item.status === "completed" || item.status === "current"
              ? "bg-primary/40"
              : "bg-border",
          ].join(" ")}
        />
      )}
      {item.status === "completed" ? (
        <span className={`${baseDot} bg-step-success/15 text-step-success`}>
          <CheckIcon />
        </span>
      ) : item.status === "current" ? (
        <span className="relative grid h-4 w-4 shrink-0 place-items-center">
          {isActive ? (
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" />
          ) : null}
          <span className="relative h-4 w-4 rounded-full bg-primary shadow-[0_0_0_3px_var(--color-primary-light)] shadow-primary/15" />
        </span>
      ) : (
        <span className={`${baseDot} border border-border bg-surface`} />
      )}
      {/* vertical connector below */}
      {isLast ? null : (
        <span
          aria-hidden="true"
          className={[
            "absolute top-full left-1/2 h-2 w-px -translate-x-1/2",
            item.status === "completed"
              ? "bg-primary/40"
              : "bg-border",
          ].join(" ")}
        />
      )}
    </div>
  );
}

function StepRow({
  item,
  isActive,
  isFirst,
  isLast,
  label,
  isHumanGate,
  guidanceText,
}: {
  item: ProtocolPhaseProgressItem;
  isActive: boolean;
  isFirst: boolean;
  isLast: boolean;
  label: string;
  isHumanGate: boolean;
  guidanceText: string;
}) {
  const isCurrent = item.status === "current";
  const isCompleted = item.status === "completed";
  return (
    <li
      role="listitem"
      aria-current={isCurrent ? "step" : undefined}
      className={[
        "flex items-start gap-3 rounded-lg border px-3 py-2 transition-colors",
        isCurrent
          ? "border-primary/30 bg-primary-light/10 shadow-[0_4px_16px_-8px_rgba(15,23,42,0.18)]"
          : isCompleted
            ? "border-border bg-surface-subtle"
            : "border-border bg-surface/40",
      ].join(" ")}
    >
      <StepNode
        item={item}
        isActive={isActive}
        isFirst={isFirst}
        isLast={isLast}
      />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-center gap-1.5">
          <span
            className={[
              "truncate text-[12px] leading-4",
              isCurrent
                ? "font-semibold text-foreground"
                : isCompleted
                  ? "text-muted"
                  : "text-muted-light",
            ].join(" ")}
            title={label}
          >
            {label}
          </span>
          {isHumanGate ? (
            <span className="shrink-0 rounded-full border border-amber-300/60 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">
              ⌛
            </span>
          ) : null}
        </div>
        {guidanceText ? (
          <p
            title={guidanceText}
            className={[
              "mt-1 text-[11px] leading-4",
              isCurrent ? "text-muted" : "text-muted-light",
            ].join(" ")}
          >
            {guidanceText}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Cursor-style phase stepper for the governed protocol run — vertical layout
 * (Option A). Each phase is a row with the status dot on the left, label +
 * guidance on the right, and a thin vertical connector line tying rows
 * together. Keeps every phase label visible regardless of phase count and
 * gives the active phase a soft highlight instead of a one-line clamp.
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
      data-orientation="vertical"
      className="pointer-events-auto mb-2 rounded-xl border border-border bg-surface/95 p-2 shadow-[0_4px_16px_-8px_rgba(15,23,42,0.18)] backdrop-blur"
    >
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="rounded-md bg-surface-subtle px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-light">
          {protocolLabel}
        </span>
        {gateBadge ? (
          <span className="rounded-full border border-amber-300/60 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-600">
            {t("protocolPhase.needsYourInput")}
          </span>
        ) : null}
      </div>
      <ol role="list" className="grid gap-1.5">
        {progress.items.map((item, index) => {
          const isHumanGate = isHumanGatePhase(item.id) && item.status === "current";
          return (
            <StepRow
              key={item.id}
              item={item}
              isActive={isLive && item.status === "current"}
              isFirst={index === 0}
              isLast={index === progress.items.length - 1}
              label={phaseLabel(item.id)}
              isHumanGate={isHumanGate}
              guidanceText={
                item.status === "current" && item.guidance ? item.guidance : ""
              }
            />
          );
        })}
      </ol>
    </div>
  );
}