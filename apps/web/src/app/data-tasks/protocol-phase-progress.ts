import type { LiveProtocolDefinition } from "./live-run-state";

export type ProtocolPhaseStatus = "completed" | "current" | "pending";

export type ProtocolPhaseProgressItem = {
  id: string;
  guidance?: string;
  status: ProtocolPhaseStatus;
  /** Zero-based position in the protocol's phase order. */
  index: number;
};

export type ProtocolPhaseProgress = {
  protocolId: string;
  items: ProtocolPhaseProgressItem[];
  /** Index of the active phase, or -1 when the current phase is unknown. */
  currentIndex: number;
};

/**
 * Phase ids that block on an explicit human decision (Anthropic-style human
 * gates). Used to surface a "needs your input" affordance in the stepper and
 * the approval card.
 */
export const HUMAN_GATE_PHASE_IDS: ReadonlySet<string> = new Set([
  // general-task
  "clarify",
  "pre_commit_review",
  // data-analysis
  "human_approval",
]);

export function isHumanGatePhase(phaseId: string | undefined): boolean {
  return phaseId !== undefined && HUMAN_GATE_PHASE_IDS.has(phaseId);
}

export function buildProtocolPhaseProgress(
  definition: LiveProtocolDefinition,
  currentPhaseId?: string,
): ProtocolPhaseProgress {
  const currentIndex = currentPhaseId
    ? definition.phases.findIndex((phase) => phase.id === currentPhaseId)
    : -1;
  const items = definition.phases.map((phase, index) => {
    const status: ProtocolPhaseStatus =
      currentIndex === -1
        ? "pending"
        : index < currentIndex
          ? "completed"
          : index === currentIndex
            ? "current"
            : "pending";
    return {
      id: phase.id,
      ...(phase.guidance ? { guidance: phase.guidance } : {}),
      status,
      index,
    };
  });
  return {
    protocolId: definition.protocolId,
    items,
    currentIndex,
  };
}

/** `pre_commit_review` -> `Pre Commit Review` (fallback label for stepper steps). */
export function humanizePhaseId(phaseId: string): string {
  return phaseId
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Map a protocol id to its i18n namespace key (`data-analysis` -> `dataAnalysis`). */
export function protocolI18nNamespace(protocolId: string): string {
  return protocolId
    .split(/[^a-zA-Z0-9]+/u)
    .filter(Boolean)
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join("");
}
