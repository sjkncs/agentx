/**
 * Reflexion: Automated failure reflection generator for LATS tree search.
 * 
 * Design rationale:
 * - When a branch fails (e.g., invalid tool parameters, SQL syntax error), generate human-readable lesson
 * - Inject this text into next round of action expansion via prompt context
 * - Similar to Reflexion paper "Reflexion: Language Agents with Verbal Reinforcement Learning"
 * - Supports category-based template reuse (failureModes database lookup)
 * 
 * Integration points:
 * - Called from expandBranch() when failedBranch.failureReason is set
 * - Stored on TrajectoryBranch.reflection field for downstream display
 * - Admin dashboard tracks top failure modes by frequency
 */

export type FailureCategory =
  | "invalid_parameters"
  | "sql_syntax_error"
  | "timeout"
  | "rate_limit"
  | "authentication_failed"
  | "schema_mismatch"
  | "tool_not_found"
  | "phase_violation"
  | "budget_exhausted";

export interface FailureMode {
  /** Unique identifier */
  id: string;
  /** Category name */
  category: FailureCategory;
  /** Error message patterns for matching (regex or substring) */
  symptoms: string[];
  /** Auto-reflection prompt template (injection point: {{ERROR}}) */
  reflexionTemplate: string;
  /** #times successfully re-routed after reflection */
  recoveredCount: number;
  /** Last matched timestamp */
  lastMatchedAt?: Date;
}

/**
 * Generate automated reflection text for a failed trajectory branch.
 * Falls back to generic LLM call if no matching failure mode exists.
 */
export async function generateReflexionForFailure(
  failedBranch: { history: AgentStep[]; failureReason: string },
  llm: LLMAPI,
  failureModes?: FailureMode[],
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  const matchedMode = matchFailureMode(failedBranch.failureReason, failureModes);
  
  let prompt: string;
  if (matchedMode) {
    // Use pre-optimized template from DB
    prompt = matchedMode.reflexionTemplate.replace("{{ERROR}}", failedBranch.failureReason);
  } else {
    // Fallback to generic LLM generation
    const trajectoryStr = formatTrajectoryHistory(failedBranch.history);
    prompt = `You are an AI agent debugging system. The following execution failed:\n\n${trajectoryStr}\n\nError: ${failedBranch.failureReason}\n\nGenerate 3 specific lessons learned in one-sentence bullet points.`;
  }

  const reflection = await llm.call(prompt, {
    temperature: options?.temperature ?? 0.7,
    maxTokens: options?.maxTokens ?? 512,
  });

  // Update failure mode stats if matched
  if (matchedMode) {
    matchedMode.lastMatchedAt = new Date();
    matchedMode.recoveredCount += 1;
  }

  return reflection;
}

/**
 * Match incoming error to known failure mode (symptom pattern matching).
 * Returns best match or undefined if no match found.
 */
export function matchFailureMode(errorText: string, failureModes: FailureMode[] = []): FailureMode | undefined {
  const lowerError = errorText.toLowerCase();
  
  // Simple substring match (upgrade to regex scoring later)
  for (const mode of failureModes) {
    const hasMatch = mode.symptoms.some((symptom) => lowerError.includes(symptom.toLowerCase()));
    if (hasMatch) return mode;
  }

  return undefined;
}

/**
 * Format trajectory history for reflection prompt.
 * Strips sensitive info (tokens, secrets) before sending to LLM.
 */
function formatTrajectoryHistory(history: AgentStep[]): string {
  return history.map((step) => {
    const safeArgs = stripSensitiveInfo(step.action.args);
    return `
Thought: ${truncate(step.thought, 200)}
Action: ${step.action.name}(args=${JSON.stringify(safeArgs)})
Result: ${truncate(JSON.stringify(step.result), 500)}
`.trim();
  }).join("\n");
}

/**
 * Strip sensitive information from tool arguments before sending to LLM.
 * Prevents token leakage in reflection prompts.
 */
function stripSensitiveInfo(args: unknown): unknown {
  if (typeof args !== "object" || args === null) return args;

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes("password") || lowerKey.includes("secret") || lowerKey.includes("token")) {
      continue; // skip sensitive fields
    }
    cleaned[key] = value;
  }

  return cleaned;
}

/**
 * Truncate string to max length without breaking JSON/Markdown.
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

/**
 * Pre-defined failure mode catalog (insert into SQLite via migration).
 * This is seed data; runtime can add new entries via admin dashboard.
 */
export const DEFAULT_FAILURE_MODES: FailureMode[] = [
  {
    id: "sql-syntax-error",
    category: "sql_syntax_error",
    symptoms: ["syntax error near", "unexpected token", "parse error"],
    reflexionTemplate: `Analyze this SQL syntax error: {{ERROR}}
What specific part of the query caused the problem? Suggest exactly how to fix it while preserving read-only constraint.`,
    recoveredCount: 0,
  },
  {
    id: "invalid-tool-params",
    category: "invalid_parameters",
    symptoms: ["required field missing", "validation failed", "type mismatch"],
    reflexionTemplate: `The agent attempted to call a tool with invalid parameters: {{ERROR}}
Which parameters were wrong? What correct format should they be in? Consider parameter constraints from schema.`,
    recoveredCount: 0,
  },
  {
    id: "rate-limit-hit",
    category: "rate_limit",
    symptoms: ["429", "too many requests", "rate limit exceeded"],
    reflexionTemplate: `The agent hit a rate limit: {{ERROR}}
When encountering rate limits, always implement exponential backoff retry logic with max retries = 3. Suggest revised timing strategy.`,
    recoveredCount: 0,
  },
  {
    id: "phase-gated-violation",
    category: "phase_violation",
    symptoms: ["action not allowed in phase", "protocol guard rejected"],
    reflexionTemplate: `The agent tried to execute "{{TOOL_NAME}}" outside allowed protocol phases: {{ERROR}}
List which phases allow this tool and suggest earlier preparation steps needed.`,
    recoveredCount: 0,
  },
];

/**
 * AgentStep type definition (local copy for standalone usage).
 */
interface AgentStep {
  stepIndex: number;
  thought: string;
  action: { name: string; args: unknown };
  result: unknown;
  timestamp: number;
}

/**
 * LLMAPI interface (mock implementation provided for testing).
 */
export interface LLMAPI {
  call(prompt: string, options?: { temperature?: number; maxTokens?: number }): Promise<string>;
}

/**
 * Mock LLM API for unit tests.
 */
export class MockLLM implements LLMAPI {
  constructor(private responseOverride?: string) {}

  async call(prompt: string): Promise<string> {
    if (this.responseOverride) return this.responseOverride;
    
    // Default reflexion template for testing
    return `- Avoid making assumptions about schema structure without explicit inspection
- Always validate tool arguments against documented constraints before calling
- Implement fallback mechanisms for common errors like rate limits and timeouts`;
  }
}
