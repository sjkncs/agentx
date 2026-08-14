/**
 * DSH-style step phase classification: every ReAct step is tagged as
 * Search (retrieval), Think (reasoning / no tool), or Tool (action).
 * Pure and testable; rendered as a badge next to each step.
 */
export type StepPhase = "search" | "think" | "tool";

/** Classify a step by its tool name (or lack of one => think). */
export function stepPhaseForTool(toolName?: string | null): StepPhase {
  if (!toolName) return "think";
  const n = toolName.toLowerCase();
  // Retrieval / grounding oriented.
  if (/search|knowledge|retrieve|inspect|list_data|schema|preview/i.test(n)) {
    return "search";
  }
  // Pure reasoning / answering tools (no external action).
  if (/think|reason|answer|plan|reflect/i.test(n)) return "think";
  // Everything else is an action/tool.
  return "tool";
}

/** Classify a whole step that may or may not carry a tool call. */
export function stepPhase(hasToolCall: boolean, toolName?: string | null): StepPhase {
  if (!hasToolCall) return "think";
  return stepPhaseForTool(toolName);
}
