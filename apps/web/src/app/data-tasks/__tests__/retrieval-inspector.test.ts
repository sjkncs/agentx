import { describe, expect, it } from "vitest";

import { extractRetrievalEntries, parseRetrievalResult } from "../retrieval-inspector";

describe("parseRetrievalResult", () => {
  it("parses web_search results into items with title/snippet/url", () => {
    const entry = parseRetrievalResult(
      "web_search",
      JSON.stringify({
        query: "oladipo",
        results: [
          { title: "A", url: "https://a.example", snippet: "sa" },
          { url: "https://b.example", snippet: "sb" },
        ],
      }),
    );
    expect(entry?.tool).toBe("web_search");
    expect(entry?.query).toBe("oladipo");
    expect(entry?.items).toHaveLength(2);
    expect(entry?.items[1]?.title).toBe("https://b.example"); // title falls back to url
  });

  it("parses retrieve_knowledge chunks", () => {
    const entry = parseRetrievalResult(
      "retrieve_knowledge",
      JSON.stringify({ chunks: [{ text: "chunk text", document_name: "doc1" }] }),
    );
    expect(entry?.tool).toBe("retrieve_knowledge");
    expect(entry?.items[0]?.title).toBe("doc1");
    expect(entry?.items[0]?.snippet).toBe("chunk text");
  });

  it("returns null for unrelated tools or invalid json", () => {
    expect(parseRetrievalResult("run_sql_readonly", "{}")).toBeNull();
    expect(parseRetrievalResult("web_search", "not json")).toBeNull();
    expect(parseRetrievalResult("web_search", undefined)).toBeNull();
  });
});

describe("extractRetrievalEntries", () => {
  it("collects only retrieval tool calls", () => {
    const entries = extractRetrievalEntries([
      { name: "run_sql_readonly", result: "{}" },
      { name: "web_search", result: JSON.stringify({ query: "q", results: [{ title: "t", url: "u" }] }) },
      { name: "retrieve_knowledge", result: JSON.stringify({ chunks: [{ text: "c" }] }) },
    ]);
    expect(entries.map((e) => e.tool)).toEqual(["web_search", "retrieve_knowledge"]);
  });
});
