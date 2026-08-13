import { z } from "zod";
import { createTool } from "@mastra/core/tools";

import { createCustomEvent } from "../events.js";
import type { AgUiEventEmitter } from "../types.js";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOptions {
  emitter?: AgUiEventEmitter | undefined;
  /** Search provider: "duckduckgo" (keyless default) or "tavily" (needs key). */
  provider?: string | undefined;
  apiKey?: string | undefined;
  maxResults?: number | undefined;
}

/**
 * Read-only external web search tool. Gives the agent open-domain retrieval so it
 * can ground answers in external sources (multi-source summarization with citations).
 *
 * Providers:
 *  - "duckduckgo" (default, no API key): DuckDuckGo Instant Answer API.
 *  - "tavily": Tavily search API (requires WEB_SEARCH_API_KEY).
 *
 * Emits a `web.search.results` AG-UI custom event carrying the source list so the
 * frontend can render citation tracing (click-to-source).
 */
export function createWebSearchTool(options: WebSearchOptions = {}) {
  const maxResults = options.maxResults ?? 6;

  return createTool({
    id: "web_search",
    description:
      "Search the open web for current / external information and return a ranked list of sources (title, url, snippet). Use to ground answers in external evidence; cite results as [source:n].",
    inputSchema: z.object({
      query: z.string().min(1),
      max_results: z.number().int().min(1).max(10).optional(),
    }),
    execute: async (toolInput) => {
      const limit = toolInput.max_results ?? maxResults;
      const provider = (options.provider ?? process.env.WEB_SEARCH_PROVIDER ?? "duckduckgo")
        .toLowerCase();
      const results =
        provider === "tavily"
          ? await searchTavily(toolInput.query, limit, options.apiKey ?? process.env.WEB_SEARCH_API_KEY)
          : await searchDuckDuckGo(toolInput.query, limit);

      // Emit sources for frontend citation tracing.
      try {
        options.emitter?.emit(
          createCustomEvent("web.search.results", {
            query: toolInput.query,
            provider,
            sources: results.map((r, i) => ({ index: i + 1, ...r })),
          }),
        );
      } catch {
        // Never break the run on emit failure.
      }

      return { query: toolInput.query, provider, count: results.length, results };
    },
  });
}

/** Keyless DuckDuckGo Instant Answer API. */
async function searchDuckDuckGo(query: string, limit: number): Promise<WebSearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data) return [];

  const out: WebSearchResult[] = [];
  const abstractText = typeof data.AbstractText === "string" ? data.AbstractText : "";
  const abstractUrl = typeof data.AbstractURL === "string" ? data.AbstractURL : "";
  const heading = typeof data.Heading === "string" ? data.Heading : "";
  if (abstractText && abstractUrl) {
    out.push({ title: heading || query, url: abstractUrl, snippet: abstractText });
  }
  const topics = Array.isArray(data.RelatedTopics) ? (data.RelatedTopics as unknown[]) : [];
  for (const topic of topics) {
    if (out.length >= limit) break;
    const t = topic as Record<string, unknown>;
    const text = typeof t.Text === "string" ? t.Text : "";
    const firstUrl = typeof t.FirstURL === "string" ? t.FirstURL : "";
    if (text && firstUrl) out.push({ title: text.slice(0, 80), url: firstUrl, snippet: text });
  }
  return out.slice(0, limit);
}

/** Tavily search API (requires key). */
async function searchTavily(query: string, limit: number, apiKey?: string): Promise<WebSearchResult[]> {
  if (!apiKey) return searchDuckDuckGo(query, limit);
  let res: Response;
  try {
    res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, max_results: limit }),
    });
  } catch {
    return searchDuckDuckGo(query, limit);
  }
  if (!res.ok) return searchDuckDuckGo(query, limit);
  const data = (await res.json().catch(() => null)) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  } | null;
  return (data?.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({ title: r.title ?? r.url!, url: r.url!, snippet: r.content ?? "" }))
    .slice(0, limit);
}
