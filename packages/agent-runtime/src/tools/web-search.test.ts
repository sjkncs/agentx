import { afterEach, describe, expect, it, vi } from "vitest";

import { createWebSearchTool } from "./web-search.js";

type EmittedEvent = { type?: string; name?: string; value?: unknown };

type WebSearchResultShape = {
  provider: string;
  count: number;
  results: Array<{ title: string; url?: string; snippet: string }>;
};
type ExecutableTool = { execute: (i: unknown, c?: unknown) => Promise<WebSearchResultShape> };

function run(tool: unknown, input: unknown): Promise<WebSearchResultShape> {
  return (tool as unknown as ExecutableTool).execute(input, {});
}

function makeEmitter() {
  const events: EmittedEvent[] = [];
  return {
    events,
    emitter: { emit: (e: EmittedEvent) => events.push(e) } as never,
  };
}

const TAVILY_RESPONSE = {
  results: [
    { title: "Source A", url: "https://a.example", content: "snippet a" },
    { title: "Source B", url: "https://b.example", content: "snippet b" },
    { url: "https://no-title.example", content: "no title" },
  ],
};

const DDG_RESPONSE = {
  Heading: "Oladipo",
  AbstractText: "Victor Oladipo is a basketball player.",
  AbstractURL: "https://en.wikipedia.org/wiki/Victor_Oladipo",
  RelatedTopics: [
    { Text: "He played for the Heat.", FirstURL: "https://heat.example" },
    { Text: "no url topic" },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("web_search tool", () => {
  it("tavily provider parses results and emits web.search.results with indexed sources", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => TAVILY_RESPONSE,
      })),
    );
    const { emitter, events } = makeEmitter();
    const tool = createWebSearchTool({ emitter, provider: "tavily", apiKey: "tvly-test" });

    const result = await run(tool, { query: "oladipo 2026" });

    expect(result.provider).toBe("tavily");
    expect(result.count).toBe(3);
    // url-less / title fallback handled
    expect(result.results[2]?.title).toBe("https://no-title.example");

    const emitted = events.find((e) => e.name === "web.search.results");
    expect(emitted).toBeDefined();
    const value = emitted!.value as { sources: Array<{ index: number; url: string }> };
    expect(value.sources.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(value.sources[0]?.url).toBe("https://a.example");
  });

  it("duckduckgo provider parses abstract + related topics, dropping url-less entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => DDG_RESPONSE,
      })),
    );
    const { emitter, events } = makeEmitter();
    const tool = createWebSearchTool({ emitter, provider: "duckduckgo" });

    const result = await run(tool, { query: "oladipo" });

    expect(result.provider).toBe("duckduckgo");
    // abstract + 1 related topic with url (the url-less topic dropped)
    expect(result.count).toBe(2);
    expect(result.results[0]?.url).toBe("https://en.wikipedia.org/wiki/Victor_Oladipo");

    const emitted = events.find((e) => e.name === "web.search.results");
    expect(emitted).toBeDefined();
  });

  it("degrades to empty results on network failure instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    );
    const { emitter } = makeEmitter();
    const tool = createWebSearchTool({ emitter, provider: "duckduckgo" });

    const result = await run(tool, { query: "anything" });
    expect(result.count).toBe(0);
    expect(result.results).toEqual([]);
  });
});
