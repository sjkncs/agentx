import type { AgentRunContext } from "../types.js";

/**
 * A Skill is a declarative, composable unit of agent behavior.
 * It mirrors the Anthropic Claude Code skill pattern: lightweight,
 * focus-driven, and usable as a first-class unit of collaboration
 * without changing the underlying protocol runtime.
 *
 * Unlike protocols (which are FSM-driven), skills are guided
 * conversational flows with human-in-the-loop confirmation gates.
 */

/** What kind of output this skill produces when it completes. */
export type SkillOutcome =
  | { kind: "exploration"; findings: SkillExplorationFinding[] }
  | { kind: "architecture"; recommendation: SkillArchitectureRecommendation }
  | { kind: "review"; issues: SkillReviewIssue[] }
  | { kind: "verification"; status: "pass" | "pass_with_warnings" | "fail"; findings: string[] }
  | { kind: "workflow"; phases: SkillWorkflowPhase[] }
  | { kind: "handoff"; targetProtocolId: string };

export type SkillExplorationFinding = {
  category: string;
  fileRef?: string;
  summary: string;
  entryPoints?: Array<{ file: string; line: number }>;
  callChain?: string[];
  keyInsight?: string;
};

export type SkillArchitectureRecommendation = {
  approach: string;
  rationale: string;
  tradeoffs: string[];
  recommended: boolean;
  filesToModify: string[];
  buildSequence?: string[];
};

export type SkillReviewIssue = {
  severity: "critical" | "important" | "minor";
  confidence: number;
  description: string;
  file?: string;
  line?: number;
  suggestion?: string;
  guidelineRef?: string;
};

export type SkillWorkflowPhase = {
  id: string;
  name: string;
  goal: string;
  agents?: string[];
  allowedActions?: string[];
  humanGate?: boolean;
  transitions?: SkillTransition[];
};

export type SkillTransition = {
  targetPhase: string;
  when: string;
};

export type SkillSubAgentResult = {
  agentId: string;
  output: string;
  findings: SkillExplorationFinding[];
  executionTimeMs: number;
};

/** A single skill definition. */
export type SkillDefinition = {
  /** Unique identifier, e.g. "code-explorer", "feature-dev". */
  id: string;
  version: string;
  description: string;
  /** Human-readable name shown in UI. */
  displayName: string;
  /** What the agent calls to invoke this skill. */
  invocationPattern: string;
  /** Which protocols this skill can hand off to. */
  protocolHandoffs?: string[];
  /** Sub-agents this skill spawns. */
  subAgents?: SkillSubAgentDefinition[];
  /** Workflow phases if this is a multi-phase skill. */
  phases?: SkillWorkflowPhase[];
  /** Prompt template injected into the agent context when skill is active. */
  systemPrompt?: string;
  /** Tags for discovery / filtering. */
  tags?: string[];
};

/** A sub-agent spawned by a parent skill. */
export type SkillSubAgentDefinition = {
  id: string;
  name: string;
  focusArea: string;
  promptTemplate: string;
  maxIterations?: number;
  /** Lower = higher priority when running in parallel. */
  priority?: number;
};

/** A declared skill configuration, ready to be loaded. */
export type SkillDeclaration = {
  id: string;
  version: string;
  config?: Record<string, unknown>;
};

/** Active skill context for the current run. */
export type ActiveSkillContext = {
  skillId: string;
  phase: string;
  subAgentResults: SkillSubAgentResult[];
  humanConfirmations: HumanConfirmation[];
  outcome?: SkillOutcome;
  metadata: Record<string, unknown>;
};

export type HumanConfirmation = {
  id: string;
  prompt: string;
  options: string[];
  selectedOption?: string;
  timestamp: number;
};

/** Input for human confirmation. */
export type HumanConfirmationInput = {
  confirmationId: string;
  selectedOption: string;
  context?: string;
};

export type SkillContextFactory = (runContext: AgentRunContext) => SkillRunContext;

export type SkillRunContext = {
  runId: string;
  sessionId: string;
  userId: string;
  workspaceId?: string;
  pinnedPaths: string[];
  /** @ mention focus targets for this run. */
  mentioned: {
    files: string[];
    functions: string[];
    components: string[];
  };
};
