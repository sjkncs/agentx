import type { ContextBudget } from "../../inventory/context-budget.js";
import type { ContextItem } from "../../inventory/context-item.js";
import {
  toolObservationProjectionToItems,
  type ToolObservationProjection
} from "../tool-observation-projection-items.js";
import type { ToolObservationAdapter } from "../tool-observation-adapter.js";

type WebSearchRawResult = {
  query?: unknown;
  provider?: unknown;
  count?: unknown;
  results?: unknown;
};

type WebSearchSource = {
  index: number;
  title: string;
  url: string;
  snippet: string;
};

/**
 * Governs `web_search` tool observations so each source list is bounded and
 * consistently projected into model/activity context layers. Without this
 * adapter the packager raises `CONTEXT_ADAPTER_REQUIRED:web_search`.
 */
export class WebSearchToolObservationAdapter implements ToolObservationAdapter {
  readonly toolName = "web_search";
  readonly resultType = "web-search";
  readonly sourceType = "tool-observation";

  toContextItems(raw: unknown, budget: ContextBudget): ContextItem[] {
    const projection = projectWebSearchToolObservation(raw, resolveWebSearchMaxChars(budget));
    return toolObservationProjectionToItems(projection, this.resultType, 10);
  }
}

const projectWebSearchToolObservation = (
  raw: unknown,
  maxChars: number
): ToolObservationProjection => {
  const normalized = normalizeWebSearchResult(raw);
  if (!normalized) {
    return createInvalidWebSearchProjection(raw);
  }

  const sources = normalized.sources;
  const limitedSources = limitSourcesToBudget(sources, maxChars);
  const omittedSources = Math.max(sources.length - limitedSources.length, 0);

  const truncation = omittedSources > 0
    ? [{
        sourceId: "web-search-results",
        truncated: true,
        reason: `Omitted ${omittedSources} web source(s) to fit ${maxChars} character budget`,
        originalSize: sources.length,
        returnedSize: limitedSources.length
      }]
    : [];

  const content = {
    query: normalized.query,
    provider: normalized.provider,
    count: sources.length,
    sources: limitedSources,
    ...(truncation[0] ? { context: { truncation: truncation[0] } } : {})
  };

  return {
    model: content,
    activity: content,
    artifactRefs: [],
    auditRefs: [],
    truncation
  };
};

const limitSourcesToBudget = (sources: WebSearchSource[], maxChars: number): WebSearchSource[] => {
  if (sources.length === 0) {
    return sources;
  }
  const reservedChars = 512;
  const allowedChars = Math.max(maxChars - reservedChars, 0);
  const kept: WebSearchSource[] = [];
  for (const source of sources) {
    const projected = [...kept, source];
    if (JSON.stringify(projected).length > allowedChars) {
      break;
    }
    kept.push(source);
  }
  return kept;
};

const resolveWebSearchMaxChars = (budget: ContextBudget): number => {
  const configured = budget.sourceLimits?.maxChars ?? budget.maxChars;
  return Math.max(1000, Math.min(32000, Math.floor(configured ?? 12000)));
};

const normalizeWebSearchResult = (raw: unknown): {
  query: string;
  provider: string;
  sources: WebSearchSource[];
} | undefined => {
  if (!isRecord(raw)) {
    return undefined;
  }

  const query = typeof raw.query === "string" ? raw.query : "";
  const provider = typeof raw.provider === "string" ? raw.provider : "unknown";
  const rawResults = Array.isArray(raw.results) ? raw.results : [];

  const sources: WebSearchSource[] = rawResults
    .map((entry, index) => normalizeSource(entry, index))
    .filter((entry): entry is WebSearchSource => entry !== null);

  return { query, provider, sources };
};

const normalizeSource = (entry: unknown, index: number): WebSearchSource | null => {
  if (!isRecord(entry)) {
    return null;
  }
  const url = typeof entry.url === "string" ? entry.url : "";
  if (!url) {
    return null;
  }
  const title = typeof entry.title === "string" && entry.title.length > 0 ? entry.title : url;
  const snippet = typeof entry.snippet === "string" ? entry.snippet : "";
  return { index: index + 1, title, url, snippet };
};

const createInvalidWebSearchProjection = (raw: unknown): ToolObservationProjection => {
  const serialized = safeSerialize(raw);
  const preview = serialized.slice(0, 4000);
  const content = {
    tool_result_invalid: true,
    tool_name: "web_search",
    reason: "Tool observation did not contain a web_search result payload.",
    preview
  };

  return {
    model: content,
    activity: content,
    artifactRefs: [],
    auditRefs: [],
    truncation: [{
      sourceId: "web-search-invalid",
      truncated: serialized.length > preview.length,
      reason: "Invalid web_search observation preview was bounded for model context.",
      originalSize: serialized.length,
      returnedSize: preview.length
    }]
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const safeSerialize = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

// Satisfy unused-type tooling while keeping the export for downstream consumers.
export type { WebSearchRawResult };
