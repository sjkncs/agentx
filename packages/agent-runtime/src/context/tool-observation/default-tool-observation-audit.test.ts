import { describe, expect, it } from "vitest";

import { createToolObservationBoundary } from "./tool-observation-boundary.js";
import { ToolObservationDispatcher } from "./tool-observation-dispatcher.js";
import {
  AnalysisRequirementsCommitToolObservationAdapter,
  ProtocolHandoffToolObservationAdapter
} from "./adapters/protocol-runtime-tool-observation-adapters.js";

const RUN_SCOPE = {
  modelName: "test",
  resourceId: "user-1",
  runId: "run-1",
  sessionId: "session-1"
};

describe("default adapter coverage audit", () => {
  it("protocol_handoff is registered in the default boundary", () => {
    const boundary = createToolObservationBoundary({ identity: RUN_SCOPE });
    const dispatcher = new ToolObservationDispatcher(boundary.packager, RUN_SCOPE);
    expect(() => dispatcher.assertAdapterRegistered("protocol_handoff")).not.toThrow();
  });

  it("analysis_requirements_commit is registered in the default boundary", () => {
    const boundary = createToolObservationBoundary({ identity: RUN_SCOPE });
    const dispatcher = new ToolObservationDispatcher(boundary.packager, RUN_SCOPE);
    expect(() => dispatcher.assertAdapterRegistered("analysis_requirements_commit")).not.toThrow();
  });

  it("web_search remains registered via the default boundary", () => {
    const boundary = createToolObservationBoundary({ identity: RUN_SCOPE });
    const dispatcher = new ToolObservationDispatcher(boundary.packager, RUN_SCOPE);
    expect(() => dispatcher.assertAdapterRegistered("web_search")).not.toThrow();
  });
});

describe("protocol_handoff tool observation", () => {
  it("projects target protocol, reason codes, and unresolved goals into model context", () => {
    const adapter = new ProtocolHandoffToolObservationAdapter();
    const raw = {
      status: "handoff.proposed",
      targetProtocolId: "data-analysis",
      targetProtocolVersion: "1",
      reasonCodes: ["ANALYTIC_INTENT"],
      unresolvedGoals: ["summarize Q2 revenue"]
    };

    const items = adapter.toContextItems(raw, { maxChars: 12000 });
    const modelItem = items.find((item) => item.id === "protocol-handoff-model");
    const activityItem = items.find((item) => item.id === "protocol-handoff-activity");

    expect(modelItem).toBeDefined();
    expect(activityItem).toBeDefined();
    const content = modelItem?.content as Record<string, unknown>;
    expect(content.targetProtocolId).toBe("data-analysis");
    expect(content.targetProtocolVersion).toBe("1");
    expect(content.reasonCodes).toEqual(["ANALYTIC_INTENT"]);
    expect(content.unresolvedGoals).toEqual(["summarize Q2 revenue"]);
    expect(content.source).toBe("mastra-protocol-runtime");
  });
});

describe("analysis_requirements_commit tool observation", () => {
  it("projects reported claims and requirement summary into model context", () => {
    const adapter = new AnalysisRequirementsCommitToolObservationAdapter();
    const raw = {
      status: "commited",
      reportedClaims: [
        {
          requirement_id: "R1",
          claim: "新增利润为 7100.60 元",
          values: [{ name: "profit", value: 7100.6, unit: "CNY" }],
          evidence_binding_ids: ["E1"]
        }
      ]
    };

    const items = adapter.toContextItems(raw, { maxChars: 12000 });
    const modelItem = items.find((item) => item.id === "analysis-requirements-commit-model");
    const activityItem = items.find((item) => item.id === "analysis-requirements-commit-activity");

    expect(modelItem).toBeDefined();
    expect(activityItem).toBeDefined();
    const content = modelItem?.content as Record<string, unknown>;
    expect(content.reportedClaims).toEqual(raw.reportedClaims);
    expect(content.source).toBe("mastra-protocol-runtime");
  });
});
