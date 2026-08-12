import type { SkillDefinition } from "../skill-types.js";

/** Code Reviewer — mirrors Anthropic feature-dev code-reviewer sub-agent.
 *
 * Reviews code for bugs, quality issues, and project convention compliance.
 * Only reports high-confidence issues (>= 80%) to avoid noise.
 *
 * Runs as a parallel sub-agent during feature-dev Phase 6 (Quality Review).
 */
export const codeReviewerSkill: SkillDefinition = {
  id: "code-reviewer",
  version: "1",
  displayName: "Code Reviewer",
  description:
    "Reviews code for bugs, quality issues, and project convention compliance. " +
    "Only reports high-confidence issues to avoid noise.",
  invocationPattern:
    "Launch code-reviewer to check my recent changes",
  tags: ["review", "quality", "anthropic-pattern"],
  protocolHandoffs: ["general-task"],
  subAgents: [
    {
      id: "quality-reviewer",
      name: "Quality Reviewer",
      focusArea: "Simplicity, DRY, elegance",
      promptTemplate:
        "Review for code quality: {focusArea}\n" +
        "Focus: DRY violations, unnecessary complexity, missing abstractions, " +
        "error handling gaps, resource leaks.\n" +
        "Only report if confidence >= 80%.\n" +
        "Return: Array<{severity, confidence, description, file, line, suggestion}>",
      maxIterations: 4,
      priority: 1,
    },
    {
      id: "correctness-reviewer",
      name: "Correctness Reviewer",
      focusArea: "Bugs and functional correctness",
      promptTemplate:
        "Review for correctness: {focusArea}\n" +
        "Focus: logic errors, off-by-one bugs, null/undefined handling, " +
        "race conditions, edge cases, security issues.\n" +
        "Only report if confidence >= 80%.\n" +
        "Return: Array<{severity, confidence, description, file, line, suggestion}>",
      maxIterations: 4,
      priority: 2,
    },
    {
      id: "conventions-reviewer",
      name: "Conventions Reviewer",
      focusArea: "Project standards and patterns",
      promptTemplate:
        "Review for convention compliance: {focusArea}\n" +
        "Check against: CLAUDE.md guidelines, naming conventions, " +
        "import ordering, test coverage expectations, documentation standards.\n" +
        "Only report if confidence >= 80%.\n" +
        "Return: Array<{severity, confidence, description, file, line, guideline_ref}>",
      maxIterations: 3,
      priority: 3,
    },
  ],
  systemPrompt:
    "You are a Code Reviewer agent. Your mission is to catch issues " +
    "before they reach production.\n\n" +
    "Key principle: only report findings with confidence >= 80%.\n" +
    "Low-confidence concerns waste developer time and erode trust.\n\n" +
    "Severity levels:\n" +
    "- critical (confidence 90-100): Security vulnerabilities, data corruption, crashes\n" +
    "- important (confidence 80-89): Logic bugs, missing error handling, performance issues\n" +
    "- minor (confidence < 80): Style preferences, optional improvements\n\n" +
    "Output format:\n" +
    "- critical_issues: Array<{confidence, description, file, line, suggestion, guideline_ref?}>\n" +
    "- important_issues: Array<...>\n" +
    "- summary: overall assessment\n\n" +
    "If all checks pass with high confidence, report: status=PASS, findings=[]",
};
