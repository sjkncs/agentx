/**
 * Pure extraction of retrieval entries (web_search / retrieve_knowledge tool
 * results) from a run, for the expandable retrieval inspector.
 */

export interface RetrievalEntry {
  tool: "web_search" | "retrieve_knowledge";
  query: string;
  items: Array<{ title: string; snippet: string; url?: string }>;
}

export function parseRetrievalResult(
  toolName: string,
  result: string | undefined,
): RetrievalEntry | null {
  if (!result) return null;
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(result) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  if (toolName === "web_search") {
    const results = Array.isArray(parsed.results) ? (parsed.results as unknown[]) : [];
    const items = results
      .map((r) => {
        const rec = r as Record<string, unknown>;
        const url = typeof rec.url === "string" ? rec.url : undefined;
        return {
          title: typeof rec.title === "string" ? rec.title : url ?? "",
          snippet: typeof rec.snippet === "string" ? rec.snippet : "",
          ...(url ? { url } : {}),
        };
      })
      .filter((i) => i.title || i.snippet);
    return {
      tool: "web_search",
      query: typeof parsed.query === "string" ? parsed.query : "",
      items,
    };
  }

  if (toolName === "retrieve_knowledge") {
    const chunks = Array.isArray(parsed.chunks) ? (parsed.chunks as unknown[]) : [];
    const items = chunks
      .map((c) => {
        const rec = c as Record<string, unknown>;
        return {
          title:
            typeof rec.title === "string"
              ? rec.title
              : typeof rec.document_name === "string"
                ? rec.document_name
                : "chunk",
          snippet: typeof rec.text === "string" ? rec.text : typeof rec.content === "string" ? rec.content : "",
        };
      })
      .filter((i) => i.snippet || i.title !== "chunk");
    return {
      tool: "retrieve_knowledge",
      query: typeof parsed.query === "string" ? parsed.query : "",
      items,
    };
  }

  return null;
}

/** Scan a list of tool calls (name + raw result) and return retrieval entries. */
export function extractRetrievalEntries(
  toolCalls: Array<{ name: string; result?: string }>,
): RetrievalEntry[] {
  const out: RetrievalEntry[] = [];
  for (const call of toolCalls) {
    if (call.name !== "web_search" && call.name !== "retrieve_knowledge") continue;
    const entry = parseRetrievalResult(call.name, call.result);
    if (entry) out.push(entry);
  }
  return out;
}
