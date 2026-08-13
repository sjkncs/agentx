import { describe, expect, it } from "vitest";

import {
  createInitialLiveRun,
  reduceLiveRunEvent,
} from "../live-run-state";

describe("live-run-state awareness (memory events)", () => {
  it("populates memoryEvents from memory.long-term.extracted", () => {
    const state = reduceLiveRunEvent(createInitialLiveRun(), {
      type: "CUSTOM",
      name: "memory.long-term.extracted",
      value: { count: 2, memory_ids: ["m1", "m2"], source: "completed-run" },
    });
    expect(state.memoryEvents).toHaveLength(1);
    expect(state.memoryEvents?.[0]?.count).toBe(2);
    expect(state.memoryEvents?.[0]?.memoryIds).toEqual(["m1", "m2"]);
    expect(state.memoryEvents?.[0]?.source).toBe("completed-run");
  });

  it("caps memoryEvents at 20", () => {
    let state = createInitialLiveRun();
    for (let i = 0; i < 25; i++) {
      state = reduceLiveRunEvent(state, {
        type: "CUSTOM",
        name: "memory.long-term.extracted",
        value: { count: 1, memory_ids: [`m${i}`] },
      });
    }
    expect(state.memoryEvents?.length).toBe(20);
  });
});

describe("live-run-state web sources (citation tracing)", () => {
  it("populates webSources from web.search.results, dropping url-less entries", () => {
    const state = reduceLiveRunEvent(createInitialLiveRun(), {
      type: "CUSTOM",
      name: "web.search.results",
      value: {
        query: "q",
        provider: "duckduckgo",
        sources: [
          { index: 1, title: "A", url: "https://a.example", snippet: "sa" },
          { index: 2, title: "B", snippet: "no-url" },
          { index: 3, title: "C", url: "https://c.example", snippet: "sc" },
        ],
      },
    });
    expect(state.webSources?.map((s) => s.index)).toEqual([1, 3]);
    expect(state.webSources?.[0]?.url).toBe("https://a.example");
  });

  it("leaves webSources undefined when no valid sources", () => {
    const state = reduceLiveRunEvent(createInitialLiveRun(), {
      type: "CUSTOM",
      name: "web.search.results",
      value: { sources: [] },
    });
    expect(state.webSources).toBeUndefined();
  });
});

/**
 * Mirrors the exact AG-UI CUSTOM event shape produced by the backend
 * `createCustomEvent("tree.snapshot", snapshot)` (see packages/agent-runtime
 * events.ts) and asserts the frontend reducer populates `state.trajectory`.
 */
const treeSnapshotEvent = {
  type: "CUSTOM",
  name: "tree.snapshot",
  value: {
    currentNodeId: "root/recovery/0",
    nodes: [
      {
        nodeId: "root",
        parentId: null,
        depth: 0,
        status: "failed",
        score: 0.4,
        reflection: "Avoid assumptions",
        actions: ["run_sql_readonly"],
        failureReason: "syntax error near SELECT",
      },
      {
        nodeId: "root/recovery/0",
        parentId: "root",
        depth: 1,
        status: "active",
        score: null,
        reflection: "Avoid assumptions",
        actions: ["run_sql_readonly"],
      },
    ],
  },
  timestamp: Date.now(),
};

describe("live-run-state trajectory reduction", () => {
  it("populates state.trajectory from a backend tree.snapshot CUSTOM event", () => {
    const state = reduceLiveRunEvent(createInitialLiveRun(), treeSnapshotEvent);

    expect(state.trajectory).toBeDefined();
    expect(state.trajectory?.currentNodeId).toBe("root/recovery/0");
    expect(state.trajectory?.nodes).toHaveLength(2);

    const failed = state.trajectory?.nodes.find((n) => n.status === "failed");
    expect(failed?.failureReason).toBe("syntax error near SELECT");
    expect(failed?.reflection).toBe("Avoid assumptions");

    const active = state.trajectory?.nodes.find((n) => n.status === "active");
    expect(active?.nodeId).toBe("root/recovery/0");
  });

  it("ignores malformed tree.snapshot payloads", () => {
    const state = reduceLiveRunEvent(createInitialLiveRun(), {
      type: "CUSTOM",
      name: "tree.snapshot",
      value: { nodes: [] },
    });
    expect(state.trajectory).toBeUndefined();
  });
});
