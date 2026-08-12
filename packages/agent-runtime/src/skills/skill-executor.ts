import type {
  ActiveSkillContext,
  HumanConfirmation,
  SkillDefinition,
  SkillOutcome,
  SkillSubAgentResult,
  SkillWorkflowPhase,
} from "./skill-types.js";

export type SkillExecutorOptions = {
  now?(): number;
  maxHumanConfirmations?: number;
};

export class SkillExecutor {
  private readonly activeContexts = new Map<string, ActiveSkillContext>();

  constructor(
    private readonly options: SkillExecutorOptions = {}
  ) {}

  /** Begin executing a skill, returning the initial context. */
  begin(params: {
    skillId: string;
    skill: SkillDefinition;
    runId: string;
    initialContext?: Record<string, unknown>;
  }): ActiveSkillContext {
    const context: ActiveSkillContext = {
      skillId: params.skillId,
      phase: params.skill.phases?.[0]?.id ?? "default",
      subAgentResults: [],
      humanConfirmations: [],
      metadata: {
        ...params.initialContext,
        startedAt: this.now(),
        startedBy: params.runId,
      },
    };
    this.activeContexts.set(this.activeKey(params.runId, params.skillId), context);
    return context;
  }

  /** Get the active context for a run's skill, if any. */
  getActiveContext(runId: string, skillId: string): ActiveSkillContext | undefined {
    return this.activeContexts.get(this.activeKey(runId, skillId));
  }

  /** Advance to the next phase within a skill workflow. */
  advancePhase(params: {
    runId: string;
    skillId: string;
    targetPhaseId: string;
    subAgentResults?: SkillSubAgentResult[];
  }): ActiveSkillContext {
    const key = this.activeKey(params.runId, params.skillId);
    const ctx = this.activeContexts.get(key);
    if (!ctx) {
      throw new Error(`SKILL_CONTEXT_NOT_FOUND:${params.runId}:${params.skillId}`);
    }
    const updated: ActiveSkillContext = {
      ...ctx,
      phase: params.targetPhaseId,
      subAgentResults: params.subAgentResults
        ? [...ctx.subAgentResults, ...params.subAgentResults]
        : ctx.subAgentResults,
    };
    this.activeContexts.set(key, updated);
    return updated;
  }

  /** Record sub-agent results from a skill phase. */
  recordSubAgentResults(params: {
    runId: string;
    skillId: string;
    results: SkillSubAgentResult[];
  }): ActiveSkillContext {
    const key = this.activeKey(params.runId, params.skillId);
    const ctx = this.activeContexts.get(key);
    if (!ctx) {
      throw new Error(`SKILL_CONTEXT_NOT_FOUND:${params.runId}:${params.skillId}`);
    }
    const updated: ActiveSkillContext = {
      ...ctx,
      subAgentResults: [...ctx.subAgentResults, ...params.results],
    };
    this.activeContexts.set(key, updated);
    return updated;
  }

  /** Request a human confirmation gate within a skill phase. */
  requestHumanConfirmation(params: {
    runId: string;
    skillId: string;
    prompt: string;
    options: string[];
  }): { context: ActiveSkillContext; confirmation: HumanConfirmation } {
    const key = this.activeKey(params.runId, params.skillId);
    const ctx = this.activeContexts.get(key);
    if (!ctx) {
      throw new Error(`SKILL_CONTEXT_NOT_FOUND:${params.runId}:${params.skillId}`);
    }
    const maxConfirmations =
      this.options.maxHumanConfirmations ?? AGENT_SKILL_DEFAULTS.maxHumanConfirmations;
    if (ctx.humanConfirmations.length >= maxConfirmations) {
      throw new Error(`SKILL_HUMAN_CONFIRMATION_LIMIT:${maxConfirmations}`);
    }
    const confirmation: HumanConfirmation = {
      id: `hc-${this.now()}-${Math.random().toString(36).slice(2, 8)}`,
      prompt: params.prompt,
      options: params.options,
      timestamp: this.now(),
    };
    const updated: ActiveSkillContext = {
      ...ctx,
      humanConfirmations: [...ctx.humanConfirmations, confirmation],
    };
    this.activeContexts.set(key, updated);
    return { context: updated, confirmation };
  }

  /** Resolve a human confirmation and advance. */
  resolveHumanConfirmation(params: {
    runId: string;
    skillId: string;
    confirmationId: string;
    selectedOption: string;
  }): ActiveSkillContext {
    const key = this.activeKey(params.runId, params.skillId);
    const ctx = this.activeContexts.get(key);
    if (!ctx) {
      throw new Error(`SKILL_CONTEXT_NOT_FOUND:${params.runId}:${params.skillId}`);
    }
    const updated: ActiveSkillContext = {
      ...ctx,
      humanConfirmations: ctx.humanConfirmations.map((hc) =>
        hc.id === params.confirmationId
          ? { ...hc, selectedOption: params.selectedOption }
          : hc
      ),
    };
    this.activeContexts.set(key, updated);
    return updated;
  }

  /** Complete a skill with an outcome. */
  complete(params: {
    runId: string;
    skillId: string;
    outcome: SkillOutcome;
  }): ActiveSkillContext {
    const key = this.activeKey(params.runId, params.skillId);
    const ctx = this.activeContexts.get(key);
    if (!ctx) {
      throw new Error(`SKILL_CONTEXT_NOT_FOUND:${params.runId}:${params.skillId}`);
    }
    const updated: ActiveSkillContext = {
      ...ctx,
      outcome: params.outcome,
    };
    this.activeContexts.set(key, updated);
    return updated;
  }

  /** End an active skill context. */
  end(runId: string, skillId: string): void {
    this.activeContexts.delete(this.activeKey(runId, skillId));
  }

  /** Check whether the current phase has a human gate that must be resolved before proceeding. */
  getNextHumanGate(params: {
    runId: string;
    skillId: string;
    skill: SkillDefinition;
  }): HumanConfirmation | undefined {
    const ctx = this.getActiveContext(params.runId, params.skillId);
    if (!ctx) return undefined;
    return ctx.humanConfirmations.at(-1);
  }

  /** Find the next phase definition for a skill. */
  getNextPhase(params: {
    skill: SkillDefinition;
    currentPhaseId: string;
    actionName?: string;
    selectedOption?: string;
  }): SkillWorkflowPhase | undefined {
    const currentPhase = params.skill.phases?.find(
      (p) => p.id === params.currentPhaseId
    );
    if (!currentPhase?.transitions) return undefined;

    const match = currentPhase.transitions.find((t) => {
      if (t.when === "human_confirmed" || t.when === "human_option_selected") {
        return params.selectedOption !== undefined;
      }
      if (params.actionName) {
        return t.when === params.actionName;
      }
      return false;
    });
    if (!match) return undefined;
    return params.skill.phases?.find((p) => p.id === match.targetPhase);
  }

  private activeKey(runId: string, skillId: string): string {
    return `${runId}::${skillId}`;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

const AGENT_SKILL_DEFAULTS = {
  maxHumanConfirmations: 20,
} as const;
