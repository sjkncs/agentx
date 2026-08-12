import { describe, expect, it } from "vitest";

import {
  createInitialLiveRun,
  reduceLiveRunEvent,
} from "../live-run-state";

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
