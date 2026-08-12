import type {
  ActiveSkillContext,
  HumanConfirmation,
  SkillDefinition,
  SkillOutcome,
  SkillSubAgentResult,
} from "./skill-types.js";
import { SkillExecutor } from "./skill-executor.js";
import { SkillRegistry } from "./skill-registry.js";
import type { ProtocolEvent } from "../protocol/types.js";
import { codeExplorerSkill } from "./anthropic/code-explorer.js";
import { codeArchitectSkill } from "./anthropic/code-architect.js";
import { codeReviewerSkill } from "./anthropic/code-reviewer.js";
import { featureDevSkill } from "./anthropic/feature-dev.js";

/**
 * SkillRouterBridge coordinates between the skill layer (Anthropic patterns)
 * and the protocol runtime layer (FSM).
 *
 * Key responsibilities:
 * 1. Intercept protocol events related to skills
 * 2. Pause protocol execution when a skill phase has a human gate
 * 3. Route human confirmation responses back into the protocol
 * 4. Track active skill context per run
 */
export class SkillRouterBridge {
  private readonly skillExecutor: SkillExecutor;
  private readonly skillRegistry: SkillRegistry;

  constructor(params: {
    skillRegistry: SkillRegistry;
    skillExecutor?: SkillExecutor;
  }) {
    this.skillRegistry = params.skillRegistry;
    this.skillExecutor = params.skillExecutor ?? new SkillExecutor();
  }

  /** Register all Anthropic-pattern skills with the registry. */
  registerAnthropicSkills(): void {
    for (const skill of [
      codeExplorerSkill,
      codeArchitectSkill,
      codeReviewerSkill,
      featureDevSkill,
    ]) {
      this.skillRegistry.register(skill);
    }
  }

  /** Start a skill and return the initial active context. */
  beginSkill(params: {
    skillId: string;
    runId: string;
    initialContext?: Record<string, unknown>;
  }): ActiveSkillContext {
    const skill = this.skillRegistry.find(params.skillId);
    if (!skill) {
      throw new Error(`SKILL_NOT_FOUND:${params.skillId}`);
    }
    return this.skillExecutor.begin({
      skillId: params.skillId,
      skill,
      runId: params.runId,
      ...(params.initialContext !== undefined
        ? { initialContext: params.initialContext }
        : {}),
    });
  }

  /** Advance a skill to the next phase. */
  advancePhase(params: {
    runId: string;
    skillId: string;
    targetPhaseId: string;
  }): ActiveSkillContext {
    return this.skillExecutor.advancePhase({
      runId: params.runId,
      skillId: params.skillId,
      targetPhaseId: params.targetPhaseId,
    });
  }

  /** Record sub-agent results within a skill phase. */
  recordSubAgentResults(params: {
    runId: string;
    skillId: string;
    results: Array<{
      agentId: string;
      output: string;
      findings: Array<{
        category: string;
        fileRef?: string;
        summary: string;
        entryPoints?: Array<{ file: string; line: number }>;
        keyInsight?: string;
      }>;
      executionTimeMs: number;
    }>;
  }): ActiveSkillContext {
    return this.skillExecutor.recordSubAgentResults(params);
  }

  /** Request a human confirmation gate within a skill phase.
   * Returns the confirmation object so the caller can surface it to the user.
   * Protocol execution should pause until the confirmation is resolved.
   */
  requestHumanConfirmation(params: {
    runId: string;
    skillId: string;
    prompt: string;
    options: string[];
  }): HumanConfirmation {
    const result = this.skillExecutor.requestHumanConfirmation({
      runId: params.runId,
      skillId: params.skillId,
      prompt: params.prompt,
      options: params.options,
    });
    return result.confirmation;
  }

  /** Resolve a human confirmation and return the updated context. */
  resolveConfirmation(params: {
    runId: string;
    skillId: string;
    confirmationId: string;
    selectedOption: string;
  }): ActiveSkillContext {
    return this.skillExecutor.resolveHumanConfirmation({
      runId: params.runId,
      skillId: params.skillId,
      confirmationId: params.confirmationId,
      selectedOption: params.selectedOption,
    });
  }

  /** Complete a skill with an outcome. */
  completeSkill(params: {
    runId: string;
    skillId: string;
    outcome: SkillOutcome;
  }): ActiveSkillContext {
    return this.skillExecutor.complete(params);
  }

  /** End an active skill context. */
  endSkill(runId: string, skillId: string): void {
    this.skillExecutor.end(runId, skillId);
  }

  /** Get the active context for a run's skill. */
  getActiveContext(runId: string, skillId: string): ActiveSkillContext | undefined {
    return this.skillExecutor.getActiveContext(runId, skillId);
  }

  /** Check whether the current skill phase has a pending human gate. */
  hasPendingGate(runId: string, skillId: string): boolean {
    const skill = this.skillRegistry.find(skillId);
    if (!skill) return false;
    const gate = this.skillExecutor.getNextHumanGate({ runId, skillId, skill });
    return gate !== undefined && gate.selectedOption === undefined;
  }

  /** Given the current run's active skill and phase, determine what the
   *  next protocol phase should be.
   *
   *  This is the key integration point: the bridge translates skill-level
   *  human-confirmed state back into protocol-level phase transitions.
   */
  resolveNextPhase(params: {
    runId: string;
    skillId: string;
    actionName?: string;
  }): { phase: string; transitionReason: string } | undefined {
    const skill = this.skillRegistry.find(params.skillId);
    const ctx = this.skillExecutor.getActiveContext(params.runId, params.skillId);
    if (!skill || !ctx) return undefined;

    const currentPhase = skill.phases?.find((p) => p.id === ctx.phase);
    if (!currentPhase?.transitions) return undefined;

    const resolvedOption = ctx.humanConfirmations.at(-1)?.selectedOption;

    const match = currentPhase.transitions.find((t) => {
      if (t.when === "human_confirmed") {
        return resolvedOption !== undefined;
      }
      if (t.when === "human_option_selected") {
        return resolvedOption !== undefined;
      }
      if (params.actionName) {
        return t.when === params.actionName;
      }
      return false;
    });

    if (!match) return undefined;

    return {
      phase: match.targetPhase,
      transitionReason: match.when,
    };
  }

  /** Build the onEvent handler to wire into ProtocolRuntime.
   *
   *  Intercepts skill-related events and updates the skill context:
   *  - protocol.run.started       → begin skill
   *  - protocol.segment.ended     → end skill
   *  - protocol.handoff.accepted  → switch active skill
   */
  buildProtocolEventHandler(params: {
    runId: string;
    activeSkillId?: string;
  }): (event: ProtocolEvent) => unknown {
    return (event: ProtocolEvent): unknown => {
      switch (event.type) {
        case "protocol.run.started": {
          if (params.activeSkillId) {
            this.beginSkill({
              skillId: params.activeSkillId,
              runId: params.runId,
            });
          }
          break;
        }
        case "protocol.segment.ended": {
          if (params.activeSkillId) {
            this.endSkill(params.runId, params.activeSkillId);
          }
          break;
        }
        case "protocol.handoff.accepted": {
          const payload = event.payload as {
            target?: { protocolId: string };
            previousSegmentId?: string;
          } | undefined;
          if (payload?.target?.protocolId) {
            const handoffSkillMap: Record<string, string> = {
              "feature-dev": "feature-dev",
            };
            const nextSkillId = handoffSkillMap[payload.target.protocolId];
            if (nextSkillId) {
              this.beginSkill({
                skillId: nextSkillId,
                runId: params.runId,
              });
            }
          }
          break;
        }
      }
      return undefined;
    };
  }
}
