import { asRecord, BaseToolObservationAdapter, pickFields } from "./base-tool-observation-adapter.js";

abstract class BaseProtocolRuntimeToolObservationAdapter extends BaseToolObservationAdapter {
  protected project(raw: unknown): unknown {
    const record = asRecord(raw);
    return {
      ...pickFields(record, [
        "status",
        "targetProtocolId",
        "targetProtocolVersion",
        "reasonCodes",
        "unresolvedGoals",
        "claims",
        "reportedClaims",
        "requirement_ids",
        "requirementIds",
        "isError",
        "error",
        "summary"
      ]),
      source: "mastra-protocol-runtime"
    };
  }
}

/**
 * Governs `protocol_handoff` outcomes. The tool returns the protocol runtime's
 * reducer snapshot (target protocol + reason codes + remaining unresolved goals).
 * Without this adapter the dispatcher refuses the tool at the governance edge.
 */
export class ProtocolHandoffToolObservationAdapter extends BaseProtocolRuntimeToolObservationAdapter {
  readonly toolName = "protocol_handoff";
  readonly resultType = "protocol-handoff";
}

/**
 * Governs `analysis_requirements_commit` outcomes. The tool returns the
 * data-analysis protocol's reported-claim snapshot. Without this adapter the
 * dispatcher refuses the tool at the governance edge.
 */
export class AnalysisRequirementsCommitToolObservationAdapter extends BaseProtocolRuntimeToolObservationAdapter {
  readonly toolName = "analysis_requirements_commit";
  readonly resultType = "analysis-requirements-commit";
}
