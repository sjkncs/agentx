import type { SkillDefinition } from "../skill-types.js";

/** Code Explorer — mirrors Anthropic feature-dev code-explorer sub-agent.
 *
 * Launches with a focus area, deeply analyzes existing codebase features
 * by tracing execution paths, mapping architecture, and surfacing key files.
 *
 * Runs as a parallel sub-agent during feature-dev Phase 2 (Codebase Exploration)
 * and can be invoked standalone.
 */
export const codeExplorerSkill: SkillDefinition = {
  id: "code-explorer",
  version: "1",
  displayName: "Code Explorer",
  description:
    "Deeply analyzes existing codebase features by tracing execution paths, " +
    "mapping architecture layers, and surfacing entry points and key files.",
  invocationPattern: "Launch code-explorer to trace how {feature} works",
  tags: ["exploration", "analysis", "anthropic-pattern"],
  protocolHandoffs: ["general-task"],
  subAgents: [
    {
      id: "entry-point-tracer",
      name: "Entry Point Tracer",
      focusArea: "Entry points and call chains",
      promptTemplate:
        "You are an entry point tracer. Given the feature: {focusArea}.\n" +
        "Find all entry points (API routes, CLI entry, event handlers, etc.).\n" +
        "Trace the complete call chain from entry to key logic.\n" +
        "Return: file:line refs, step-by-step flow, key component responsibilities.",
      maxIterations: 5,
      priority: 1,
    },
    {
      id: "architecture-mapper",
      name: "Architecture Mapper",
      focusArea: "Architecture layers and patterns",
      promptTemplate:
        "You are an architecture mapper. Given the feature: {focusArea}.\n" +
        "Identify all architectural layers (data, domain, service, presentation).\n" +
        "Map dependencies and abstraction boundaries.\n" +
        "Return: layer diagram description, key interfaces, integration points.",
      maxIterations: 5,
      priority: 2,
    },
    {
      id: "pattern-analyst",
      name: "Pattern Analyst",
      focusArea: "Design patterns and conventions",
      promptTemplate:
        "You are a pattern analyst. Given the feature: {focusArea}.\n" +
        "Identify design patterns (factory, observer, strategy, etc.).\n" +
        "Note conventions for naming, error handling, and state management.\n" +
        "Return: patterns found, conventions list, code style notes.",
      maxIterations: 4,
      priority: 3,
    },
  ],
  systemPrompt:
    "You are a Code Explorer agent. Your mission is to deeply understand " +
    "the existing codebase before any changes are made.\n\n" +
    "Focus areas:\n" +
    "- Entry points and call chains\n" +
    "- Data flow and transformations\n" +
    "- Architecture layers and patterns\n" +
    "- Dependencies and integrations\n" +
    "- Implementation details\n\n" +
    "Output format:\n" +
    "- entry_points: Array<{file, line, description}>\n" +
    "- call_chain: string[]\n" +
    "- key_components: Array<{name, file, responsibility}>\n" +
    "- architecture_insights: string[]\n" +
    "- files_to_read: Array<{file, line, why}>\n\n" +
    "Be thorough. This analysis drives all downstream architecture decisions.",
};
