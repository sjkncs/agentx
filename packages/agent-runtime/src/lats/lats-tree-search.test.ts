import { describe, expect, it } from "vitest";

import {
  backpropagateValueUpdates,
  createMultiPathTrajectory,
  selectNextBranchUCB,
  type AgentState,
  type MultiPathTrajectory,
  type TrajectoryBranch,
} from "./multi-path-trajectory.js";
import {
  DEFAULT_FAILURE_MODES,
  generateReflexionForFailure,
  matchFailureMode,
  MockLLM,
} from "./reflexion-generator.js";

const makeState = (): AgentState => ({
  conversationHistory: [{ role: "user", content: "query sales data" }],
  attachments: [],
});

describe("MultiPathTrajectory", () => {
  it("creates a root node with empty history and zero depth", () => {
    const trajectory = createMultiPathTrajectory(makeState());
    expect(trajectory.root.depth).toBe(0);
    expect(trajectory.root.history).toHaveLength(0);
    expect(trajectory.root.parentId).toBeNull();
    expect(trajectory.nodes.size).toBe(1);
    expect(trajectory.maxBranchingFactor).toBe(3);
  });

  it("defaults to ReAct-compatible single branch when maxBranchingFactor is 1", () => {
    const trajectory = createMultiPathTrajectory(makeState(), { maxBranchingFactor: 1 });
    expect(trajectory.maxBranchingFactor).toBe(1);
  });

  it("selectNextBranchUCB returns null when no children exist", () => {
    const trajectory = createMultiPathTrajectory(makeState());
    expect(selectNextBranchUCB(trajectory, 1.4)).toBeNull();
  });

  it("selectNextBranchUCB picks the child with highest UCB and increments visits", () => {
    const trajectory = createMultiPathTrajectory(makeState());
    const root = trajectory.root;
    root.visits = 4;

    const childA = addSyntheticChild(trajectory, root, "a", { score: 0.9, visits: 1 });
    const childB = addSyntheticChild(trajectory, root, "b", { score: 0.2, visits: 1 });
    root.children.add(childA.nodeId);
    root.children.add(childB.nodeId);

    const selected = selectNextBranchUCB(trajectory, 1.4);
    expect(selected).toBe(childA.nodeId);
    expect(childA.visits).toBe(2);
  });

  it("backpropagateValueUpdates accumulates scores up the ancestry chain", () => {
    const trajectory = createMultiPathTrajectory(makeState());
    const root = trajectory.root;
    const child = addSyntheticChild(trajectory, root, "child", { score: 0.8, visits: 1 });
    root.children.add(child.nodeId);

    backpropagateValueUpdates(trajectory, child);

    expect(root.valueSum).toBeCloseTo(0.8);
    expect(root.visits).toBe(1);
  });
});

describe("Reflexion generator", () => {
  it("matches a SQL syntax error to the seeded failure mode", () => {
    const matched = matchFailureMode("Syntax error near SELECT", DEFAULT_FAILURE_MODES);
    expect(matched?.category).toBe("sql_syntax_error");
  });

  it("matches rate-limit errors by HTTP status symptom", () => {
    const matched = matchFailureMode("HTTP 429 too many requests", DEFAULT_FAILURE_MODES);
    expect(matched?.category).toBe("rate_limit");
  });

  it("returns undefined when no symptom matches", () => {
    expect(matchFailureMode("totally novel failure", DEFAULT_FAILURE_MODES)).toBeUndefined();
  });

  it("generates reflection text via MockLLM and strips sensitive args", async () => {
    const llm = new MockLLM();
    const failedBranch = {
      history: [
        {
          stepIndex: 0,
          thought: "run query",
          action: { name: "run_sql_readonly", args: { sql: "SELECT 1", password: "hunter2" } },
          result: { error: "syntax error near SELECT" },
          timestamp: Date.now(),
        },
      ],
      failureReason: "syntax error near SELECT",
    };

    const reflection = await generateReflexionForFailure(failedBranch, llm, DEFAULT_FAILURE_MODES);
    expect(reflection).toContain("Avoid making assumptions");
    // Sensitive password arg must not leak into the prompt-driven output
    expect(reflection).not.toContain("hunter2");
  });

  it("increments recoveredCount when a failure mode is matched", async () => {
    const llm = new MockLLM();
    const modes = DEFAULT_FAILURE_MODES.map((m) => ({ ...m, recoveredCount: 0 }));
    await generateReflexionForFailure(
      { history: [], failureReason: "syntax error near FROM" },
      llm,
      modes,
    );
    const sqlMode = modes.find((m) => m.category === "sql_syntax_error");
    expect(sqlMode?.recoveredCount).toBe(1);
    expect(sqlMode?.lastMatchedAt).toBeInstanceOf(Date);
  });
});

/** Helper: attach a synthetic child branch for UCB/backprop tests. */
function addSyntheticChild(
  trajectory: MultiPathTrajectory,
  parent: TrajectoryBranch,
  suffix: string,
  opts: { score: number; visits: number },
): TrajectoryBranch {
  const child: TrajectoryBranch = {
    nodeId: `${parent.nodeId}/${suffix}`,
    parentId: parent.nodeId,
    history: [],
    currentState: parent.currentState,
    score: opts.score,
    reflection: null,
    children: new Set(),
    depth: parent.depth + 1,
    visits: opts.visits,
    valueSum: opts.score,
  };
  trajectory.nodes.set(child.nodeId, child);
  return child;
}
