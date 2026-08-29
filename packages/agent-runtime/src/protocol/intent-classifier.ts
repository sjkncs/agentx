/**
 * Intent Classifier — classifies user queries into AgentX protocol domains.
 *
 * This is the "Router Agent" in the reference architecture.
 * It classifies incoming queries into one of three protocol domains:
 *
 *   data-analysis  — schema/data questions, SQL, metrics, reports, analytics
 *   general-task  — code, documentation, general reasoning, planning
 *   research      — knowledge retrieval, web search, information gathering
 *
 * The classifier uses keyword matching + semantic scoring. It is NOT a separate
 * LLM call — it runs synchronously on the server to minimize latency.
 * When AGENTX_LLM_INTENT_CLASSIFIER=true, it falls back to an LLM call.
 */
import type { ProtocolClassifier, ProtocolRouteClassification, ProtocolIdentity } from "../protocol/protocol-router.js";

export const SUPPORTED_PROTOCOLS: ProtocolIdentity[] = [
  { protocolId: "data-analysis", protocolVersion: "1" },
  { protocolId: "general-task", protocolVersion: "2" },
];

// ---------------------------------------------------------------------------
// Keyword scoring weights
// ---------------------------------------------------------------------------

const DATA_ANALYSIS_KEYWORDS = [
  // Data operations
  "sql", "query", "select", "join", "aggregate", "group by", "filter",
  "schema", "table", "column", "datasource", "database", "metrics", "kpi",
  "report", "dashboard", "chart", "visualization", "trend", "analysis",
  "gmv", "revenue", "retention", "churn", "cohort", "funnel", "funnel",
  "etl", "pipeline", "aggregation", "count", "sum", "avg", "distinct",
  "pivot", "window function", "rank", "dense_rank", "lag", "lead",
  // Business
  "user", "customer", "order", "product", "session", "event", "log",
  "measure", "dimension", "fact", "cube", "olap",
  // Execution
  "run sql", "execute", "preview", "inspect schema", "sample data",
  "compare", "correlation", "distribution", "outlier", "anomaly",
];

const GENERAL_TASK_KEYWORDS = [
  // Code
  "code", "function", "class", "api", "endpoint", "refactor", "implement",
  "bug", "fix", "test", "lint", "format", "build", "deploy", "docker",
  "git", "commit", "pr", "review", "merge", "branch",
  // Documentation
  "readme", "docs", "comment", "specification", "design", "architecture",
  // General
  "explain", "summarize", "translate", "write", "create", "generate",
  "help me", "can you", "please", "how to", "what is",
  "plan", "estimate", "research", "compare", "evaluate",
];

const RESEARCH_KEYWORDS = [
  "search", "web", "look up", "find information", "what does",
  "definition", "meaning", "latest", "recent", "news",
  "wikipedia", "documentation", "manual", "guide",
];

// ---------------------------------------------------------------------------
// IntentClassifier
// ---------------------------------------------------------------------------

export class IntentClassifier {
  private readonly llmFallbackEnabled: boolean;

  constructor() {
    this.llmFallbackEnabled =
      process.env.AGENTX_LLM_INTENT_CLASSIFIER === "true";
  }

  /**
   * Classify a user query into a protocol.
   * Returns a ProtocolClassifier compatible result.
   */
  async classify(
    query: string,
    context?: {
      availableProtocols?: ProtocolIdentity[];
      previousMessages?: string[];
    },
  ): Promise<ProtocolRouteClassification> {
    const normalized = query.toLowerCase().trim();

    if (this.llmFallbackEnabled) {
      return this.classifyWithLLM(normalized, context);
    }

    return this.classifyByKeywords(normalized);
  }

  private classifyByKeywords(
    query: string,
  ): ProtocolRouteClassification {
    let dataScore = 0;
    let generalScore = 0;
    let researchScore = 0;

    for (const kw of DATA_ANALYSIS_KEYWORDS) {
      if (query.includes(kw)) dataScore += 1;
    }
    for (const kw of GENERAL_TASK_KEYWORDS) {
      if (query.includes(kw)) generalScore += 1;
    }
    for (const kw of RESEARCH_KEYWORDS) {
      if (query.includes(kw)) researchScore += 1;
    }

    // Boost for explicit data prefixes
    if (/^(analyze|query|sql|show me|list|how many|what are|which)\b/i.test(query)) {
      dataScore += 3;
    }

    const scores = [
      { protocolId: "data-analysis", protocolVersion: "1", score: dataScore, reason: "KEYWORD_DATA_ANALYSIS" },
      { protocolId: "general-task", protocolVersion: "2", score: generalScore, reason: "KEYWORD_GENERAL_TASK" },
      { protocolId: "research", protocolVersion: "1", score: researchScore, reason: "KEYWORD_RESEARCH" },
    ].filter((s) => s.score > 0);

    if (scores.length === 0) {
      return {
        protocolId: "general-task",
        protocolVersion: "2",
        confidence: 0.5,
        reasonCodes: ["FALLBACK_DEFAULT"],
      };
    }

    scores.sort((a, b) => b.score - a.score);
    const top = scores[0]!;
    const total = scores.reduce((sum, s) => sum + s.score, 0);
    const confidence = Math.min(0.95, 0.5 + (top.score / Math.max(total, 1)) * 0.45);

    return {
      protocolId: top.protocolId,
      protocolVersion: top.protocolVersion,
      confidence,
      reasonCodes: [top.reason, `score:${top.score}/${total}`],
    };
  }

  private async classifyWithLLM(
    query: string,
    context?: { previousMessages?: string[] },
  ): Promise<ProtocolRouteClassification> {
    // LLM fallback — for production, integrate with the model provider
    // This avoids adding a dependency here; caller should override this method
    console.warn("[IntentClassifier] LLM fallback not implemented — using keyword classifier");
    return this.classifyByKeywords(query);
  }
}

/**
 * Build a ProtocolClassifier function compatible with ProtocolRouter.
 */
export function createIntentClassifier(): ProtocolClassifier {
  const classifier = new IntentClassifier();

  return async ({ candidates, value }) => {
    const query = typeof value === "string"
      ? value
      : typeof value === "object" && value !== null
        ? String((value as Record<string, unknown>).query ?? "")
        : "";

    const result = await classifier.classify(query, { availableProtocols: candidates });

    // Filter to only authorized candidates
    const authorized = candidates.find(
      (c) =>
        c.protocolId === result.protocolId &&
        c.protocolVersion === result.protocolVersion,
    );

    if (!authorized) {
      // Fall back to highest-priority authorized candidate
      const fallback = candidates[0];
      if (!fallback) {
        throw new Error("NO_AUTHORIZED_PROTOCOL");
      }
      return {
        protocolId: fallback.protocolId,
        protocolVersion: fallback.protocolVersion,
        confidence: 0.3,
        reasonCodes: ["CLASSIFIER_FALLBACK"],
      };
    }

    return {
      protocolId: authorized.protocolId,
      protocolVersion: authorized.protocolVersion,
      confidence: result.confidence,
      reasonCodes: result.reasonCodes,
    };
  };
}
