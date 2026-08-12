import type { SkillDefinition } from "../skill-types.js";

/** Code Architect — mirrors Anthropic feature-dev code-architect sub-agent.
 *
 * Designs feature architectures and implementation blueprints.
 * Produces multiple approaches with trade-offs, then recommends the best fit.
 *
 * Runs as a parallel sub-agent during feature-dev Phase 4 (Architecture Design).
 */
export const codeArchitectSkill: SkillDefinition = {
  id: "code-architect",
  version: "1",
  displayName: "Code Architect",
  description:
    "Designs feature architectures and implementation blueprints. " +
    "Analyzes codebase patterns, produces multiple approaches with trade-offs, " +
    "and recommends the best fit for the given context.",
  invocationPattern:
    "Launch code-architect to design the {component} layer",
  tags: ["architecture", "design", "anthropic-pattern"],
  protocolHandoffs: ["general-task", "data-analysis"],
  subAgents: [
    {
      id: "minimal-changes-architect",
      name: "Minimal Changes Architect",
      focusArea: "Smallest change, maximum reuse",
      promptTemplate:
        "Design an approach for: {focusArea}\n" +
        "Goal: minimize the diff. Extend existing code where possible.\n" +
        "Return: approach name, pros/cons, files affected, risk assessment.",
      maxIterations: 3,
      priority: 1,
    },
    {
      id: "clean-architecture-architect",
      name: "Clean Architecture Architect",
      focusArea: "Maintainability and elegant abstractions",
      promptTemplate:
        "Design an approach for: {focusArea}\n" +
        "Goal: maximize separation of concerns, testability, and long-term maintainability.\n" +
        "Return: architecture diagram, new files, refactoring needed, trade-off analysis.",
      maxIterations: 3,
      priority: 2,
    },
    {
      id: "pragmatic-architect",
      name: "Pragmatic Balance Architect",
      focusArea: "Speed and quality balance",
      promptTemplate:
        "Design an approach for: {focusArea}\n" +
        "Goal: balanced complexity — clean enough without over-engineering.\n" +
        "Return: practical approach, compromise points, build sequence, risk profile.",
      maxIterations: 3,
      priority: 3,
    },
  ],
  systemPrompt:
    "You are a Code Architect agent. Your mission is to design the best " +
    "implementation approach for a new feature.\n\n" +
    "Before designing, you MUST:\n" +
    "1. Read the relevant files from the codebase exploration phase\n" +
    "2. Understand the existing architecture patterns in use\n" +
    "3. Identify integration points and constraints\n\n" +
    "Output format for each approach:\n" +
    "- approach_name: string\n" +
    "- rationale: why this approach fits\n" +
    "- new_files: string[]\n" +
    "- modified_files: string[]\n" +
    "- pros: string[]\n" +
    "- cons: string[]\n" +
    "- build_sequence: string[]\n" +
    "- risk: 'low' | 'medium' | 'high'\n" +
    "- recommended: boolean\n\n" +
    "After presenting all approaches, recommend ONE approach with clear reasoning.\n" +
    "Consider: codebase conventions, team familiarity, integration complexity, time constraints.",
};
