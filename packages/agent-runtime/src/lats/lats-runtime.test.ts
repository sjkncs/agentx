import { describe, expect, it } from "vitest";

import { LatsRuntime } from "./lats-runtime.js";
import { MockLLM } from "./reflexion-generator.js";
import type { AgUiEventEmitter } from "../types.js";

/** Minimal recording emitter capturing emitted AG-UI events. */
function createRecordingEmitter() {
  const events: Array<{ name?: string; value?: unknown; type?: string }> = [];
  const emitter = {
    emit: (event: unknown) => {
      events.push(event as { name?: string; value?: unknown; type?: string });
    },
  } as unknown as AgUiEventEmitter;
  return { emitter, events };
}

const names = (events: Array<{ name?: string }>) =>
  events.map((e) => e.name).filter((n): n is string => Boolean(n));

describe("LatsRuntime", () => {
  it("is a no-op when disabled (ReAct mode) — emits nothing", async () => {
    const { emitter, events } = createRecordingEmitter();
    const lats = new LatsRuntime({ enabled: false, emitter });

    lats.recordStep({ toolName: "run_sql_readonly", rawResult: { ok: true } });
    await lats.recordFailure({ toolName: "run_sql_readonly", error: new Error("boom") });

    expect(lats.isActive).toBe(false);
    expect(events).toHaveLength(0);
    expect(lats.snapshot()).toBeNull();
  });

  it("records successful steps and emits tree.snapshot", () => {
    const { emitter, events } = createRecordingEmitter();
    const lats = new LatsRuntime({ enabled: true, emitter });

    lats.recordStep({ toolName: "inspect_schema", rawResult: { tables: [] } });

    expect(names(events)).toContain("tree.snapshot");
    const snapshot = lats.snapshot();
    expect(snapshot).not.toBeNull();
    // Root node should have one recorded action.
    const root = snapshot?.nodes.find((n) => n.parentId === null);
    expect(root?.actions).toContain("inspect_schema");
  });

  it("on failure marks branch failed, generates reflexion, and opens a recovery child", async () => {
    const { emitter, events } = createRecordingEmitter();
    const lats = new LatsRuntime({ enabled: true, emitter, llm: new MockLLM() });

    lats.recordStep({ toolName: "run_sql_readonly", rawResult: {} });
    await lats.recordFailure({
      toolName: "run_sql_readonly",
      error: new Error("syntax error near SELECT"),
    });

    const emitted = names(events);
    expect(emitted).toContain("tree.branch.failed");
    expect(emitted).toContain("tree.reflexion");
    expect(emitted).toContain("tree.branch.created");
    expect(emitted).toContain("tree.branch.selected");

    const snapshot = lats.snapshot();
    expect(snapshot).not.toBeNull();
    const failed = snapshot?.nodes.find((n) => n.status === "failed");
    expect(failed).toBeDefined();
    expect(failed?.reflection).toContain("Avoid making assumptions");
    // A recovery child should exist and be the current node.
    const recovery = snapshot?.nodes.find((n) => n.parentId === failed?.nodeId);
    expect(recovery).toBeDefined();
    expect(snapshot?.currentNodeId).toBe(recovery?.nodeId);
  });

  it("serializes trajectory deterministically sorted by depth then id", () => {
    const { emitter } = createRecordingEmitter();
    const lats = new LatsRuntime({ enabled: true, emitter });
    lats.recordStep({ toolName: "a" });

    const pub = lats.snapshot();
    expect(pub).not.toBeNull();
    const depths = (pub?.nodes ?? []).map((n) => n.depth);
    const sorted = [...depths].sort((a, b) => a - b);
    expect(depths).toEqual(sorted);
  });
});
