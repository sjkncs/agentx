import { describe, expect, it } from "vitest";

import { createToolObservationBoundary } from "./tool-observation-boundary.js";
import { ToolObservationDispatcher } from "./tool-observation-dispatcher.js";
import { WebSearchToolObservationAdapter } from "./adapters/web-search-tool-observation-adapter.js";

const RUN_SCOPE = {
  modelName: "test",
  resourceId: "user-1",
  runId: "run-1",
  sessionId: "session-1"
};

describe("web_search tool observation", () => {
  it("registers an exact adapter through the default boundary", () => {
    const boundary = createToolObservationBoundary({
      identity: RUN_SCOPE
    });
    const dispatcher = new ToolObservationDispatcher(boundary.packager, RUN_SCOPE);
    expect(() => dispatcher.assertAdapterRegistered("web_search")).not.toThrow();
  });

  it("projects source lists and truncates them to the configured budget", () => {
    const adapter = new WebSearchToolObservationAdapter();
    const sources = Array.from({ length: 20 }, (_, i) => ({
      index: i + 1,
      title: `Source ${i + 1}`,
      url: `https://example.com/source-${i + 1}`,
      snippet: `Snippet ${i + 1} `.repeat(40)
    }));
    const raw = { query: "agent runtimes", provider: "tavily", count: sources.length, results: sources };

    const items = adapter.toContextItems(raw, { maxChars: 1500 });
    const modelItem = items.find((item) => item.id === "web-search-model");
    const activityItem = items.find((item) => item.id === "web-search-activity");

    expect(modelItem).toBeDefined();
    expect(activityItem).toBeDefined();
    expect(modelItem?.content).toEqual(activityItem?.content);

    const content = modelItem?.content as {
      query: string;
      provider: string;
      count: number;
      sources: Array<{ index: number }>;
      context?: { truncation: { truncated: boolean; originalSize: number; returnedSize: number } };
    };
    expect(content.query).toBe("agent runtimes");
    expect(content.provider).toBe("tavily");
    expect(content.count).toBe(sources.length);
    expect(content.sources.length).toBeLessThan(sources.length);
    expect(content.context?.truncation.truncated).toBe(true);
    expect(content.context?.truncation.originalSize).toBe(sources.length);
    expect(content.context?.truncation.returnedSize).toBe(content.sources.length);

    const truncationItem = items.find((item) => item.id === "web-search-truncation-0");
    expect(truncationItem).toBeDefined();
  });

  it("drops url-less sources while keeping indexed ordering", () => {
    const adapter = new WebSearchToolObservationAdapter();
    const raw = {
      query: "q",
      provider: "duckduckgo",
      count: 4,
      results: [
        { index: 1, title: "A", url: "https://a.example", snippet: "alpha" },
        { index: 2, title: "B", url: "", snippet: "no url" },
        { index: 3, title: "C", url: "https://c.example", snippet: "gamma" },
        { index: 4, title: "D", url: undefined as unknown as string, snippet: "missing" }
      ]
    };

    const items = adapter.toContextItems(raw, { maxChars: 12000 });
    const content = items.find((item) => item.id === "web-search-model")?.content as {
      sources: Array<{ index: number; url: string; title: string }>;
    };
    expect(content.sources.map((s) => s.index)).toEqual([1, 3]);
    expect(content.sources[0]?.url).toBe("https://a.example");
  });

  it("falls back to the invalid-result projection when the payload is malformed", () => {
    const adapter = new WebSearchToolObservationAdapter();
    const items = adapter.toContextItems("not a payload", { maxChars: 12000 });
    const modelItem = items.find((item) => item.id === "web-search-model");
    const content = modelItem?.content as {
      tool_result_invalid: boolean;
      tool_name: string;
      reason: string;
      preview: string;
    };
    expect(content.tool_result_invalid).toBe(true);
    expect(content.tool_name).toBe("web_search");
    expect(content.reason).toMatch(/web_search/);
    expect(typeof content.preview).toBe("string");

    const truncationItem = items.find((item) => item.id === "web-search-truncation-0");
    expect(truncationItem).toBeDefined();
  });
});
