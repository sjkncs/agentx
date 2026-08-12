import type { SkillDefinition } from "../skill-types.js";
import { codeExplorerSkill } from "./code-explorer.js";
import { codeArchitectSkill } from "./code-architect.js";
import { codeReviewerSkill } from "./code-reviewer.js";

/** Feature Development Skill — mirrors Anthropic feature-dev plugin.
 *
 * Provides a 7-phase structured workflow:
 *   1. Discovery        — clarify what needs to be built
 *   2. Exploration       — launch code-explorer sub-agents in parallel
 *   3. Clarifying Q's    — human answers ambiguity before design
 *   4. Architecture      — launch code-architect sub-agents, human chooses
 *   5. Implementation    — human approves before writing code
 *   6. Quality Review    — launch code-reviewer sub-agents in parallel
 *   7. Summary           — document what was accomplished
 *
 * Each phase with humanGate: true pauses and waits for human input
 * before the agent proceeds. This is the key difference from pure FSM
 * protocols: natural-language confirmation gates, not rigid guards.
 */
export const featureDevSkill: SkillDefinition = {
  id: "feature-dev",
  version: "1",
  displayName: "Feature Development",
  description:
    "A 7-phase guided workflow for building features: " +
    "Discovery → Exploration → Clarifying Questions → Architecture Design → " +
    "Implementation → Quality Review → Summary. " +
    "Injects Anthropic Claude Code patterns via human-gated phases.",
  invocationPattern: "/feature-dev {feature_request}",
  tags: ["workflow", "anthropic-pattern", "human-in-the-loop"],
  protocolHandoffs: ["general-task", "data-analysis"],
  subAgents: [
    ...(codeExplorerSkill.subAgents ?? []),
    ...(codeArchitectSkill.subAgents ?? []),
    ...(codeReviewerSkill.subAgents ?? []),
  ],
  phases: [
    {
      id: "discovery",
      name: "Discovery",
      goal: "Understand what needs to be built by clarifying the feature request",
      humanGate: false,
      transitions: [{ targetPhase: "exploration", when: "feature_clarified" }],
    },
    {
      id: "exploration",
      name: "Codebase Exploration",
      goal:
        "Launch code-explorer sub-agents in parallel to understand existing code. " +
        "Agents: Entry Point Tracer, Architecture Mapper, Pattern Analyst.",
      agents: ["entry-point-tracer", "architecture-mapper", "pattern-analyst"],
      humanGate: false,
      transitions: [{ targetPhase: "clarifying_questions", when: "exploration_complete" }],
    },
    {
      id: "clarifying_questions",
      name: "Clarifying Questions",
      goal:
        "Fill in gaps and resolve all ambiguities. Present questions to human " +
        "and wait for answers before proceeding to design.",
      humanGate: true,
      transitions: [
        { targetPhase: "architecture_design", when: "human_confirmed" },
      ],
    },
    {
      id: "architecture_design",
      name: "Architecture Design",
      goal:
        "Launch code-architect sub-agents in parallel to design multiple approaches. " +
        "Present comparison with trade-offs and recommendation to human. " +
        "Wait for human to choose an approach.",
      agents: [
        "minimal-changes-architect",
        "clean-architecture-architect",
        "pragmatic-architect",
      ],
      humanGate: true,
      transitions: [
        { targetPhase: "implementation", when: "human_option_selected" },
      ],
    },
    {
      id: "implementation",
      name: "Implementation",
      goal:
        "Read all relevant files identified in previous phases. " +
        "Implement following chosen architecture. Wait for human approval " +
        "before starting.",
      allowedActions: [
        "read_file",
        "write_file",
        "edit_file",
        "delete_file",
        "list_directory",
        "search_files",
        "run_terminal_command",
      ],
      humanGate: true,
      transitions: [{ targetPhase: "quality_review", when: "implementation_complete" }],
    },
    {
      id: "quality_review",
      name: "Quality Review",
      goal:
        "Launch code-reviewer sub-agents in parallel. " +
        "Agents: Quality Reviewer, Correctness Reviewer, Conventions Reviewer. " +
        "Present findings to human and ask what to do: fix now / fix later / proceed.",
      agents: ["quality-reviewer", "correctness-reviewer", "conventions-reviewer"],
      humanGate: true,
      transitions: [
        { targetPhase: "summary", when: "human_confirmed" },
        { targetPhase: "implementation", when: "human_requested_fixes" },
      ],
    },
    {
      id: "summary",
      name: "Summary",
      goal: "Mark all todos complete and summarize what was accomplished",
      humanGate: false,
      transitions: [],
    },
  ],
  systemPrompt:
    "You are running the Feature Development workflow. Follow each phase precisely.\n\n" +
    "PHASE 1 - DISCOVERY:\n" +
    "- Clarify the feature request if it's unclear\n" +
    "- Ask: what problem are we solving? What are the constraints?\n" +
    "- Summarize your understanding and confirm with the user\n\n" +
    "PHASE 2 - EXPLORATION:\n" +
    "- Launch 3 code-explorer sub-agents in parallel:\n" +
    "  1. Entry Point Tracer — find all entry points and trace call chains\n" +
    "  2. Architecture Mapper — identify layers and abstraction boundaries\n" +
    "  3. Pattern Analyst — find design patterns and conventions\n" +
    "- Wait for all agents to complete\n" +
    "- Read the key files they identified\n" +
    "- Present a comprehensive summary of findings\n\n" +
    "PHASE 3 - CLARIFYING QUESTIONS:\n" +
    "- Review findings from Phase 2 and the feature request\n" +
    "- Identify all underspecified aspects: edge cases, error handling,\n" +
    "  integration points, backward compatibility, performance needs\n" +
    "- Present ALL questions in an organized list\n" +
    "- **WAIT for human answers before proceeding**\n\n" +
    "PHASE 4 - ARCHITECTURE DESIGN:\n" +
    "- Launch 3 code-architect sub-agents in parallel:\n" +
    "  1. Minimal Changes — smallest diff, maximum reuse\n" +
    "  2. Clean Architecture — max maintainability and abstraction\n" +
    "  3. Pragmatic Balance — speed + quality\n" +
    "- Review all approaches and form a recommendation\n" +
    "- Present comparison with trade-offs\n" +
    "- **WAIT for human to choose an approach**\n\n" +
    "PHASE 5 - IMPLEMENTATION:\n" +
    "- **Wait for explicit human approval before starting**\n" +
    "- Read all relevant files from Phase 2\n" +
    "- Implement following chosen architecture\n" +
    "- Follow codebase conventions strictly\n" +
    "- Track progress with todos\n\n" +
    "PHASE 6 - QUALITY REVIEW:\n" +
    "- Launch 3 code-reviewer sub-agents in parallel:\n" +
    "  1. Quality Reviewer — DRY, complexity, error handling\n" +
    "  2. Correctness Reviewer — bugs, logic errors, edge cases\n" +
    "  3. Conventions Reviewer — project standards and patterns\n" +
    "- Consolidate findings, identify highest severity\n" +
    "- **Ask human: Fix now / Fix later / Proceed as-is**\n\n" +
    "PHASE 7 - SUMMARY:\n" +
    "- Mark all todos complete\n" +
    "- Summarize: what was built, key decisions, files modified, next steps",
};
