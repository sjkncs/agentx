import { describe, expect, it } from "vitest";

import { STATIC_AGENT_TOOL_NAMES } from "../../index.js";
import { createToolObservationBoundary } from "./tool-observation-boundary.js";
import { ToolObservationDispatcher } from "./tool-observation-dispatcher.js";

const RUN_SCOPE = {
  modelName: "test",
  resourceId: "user-1",
  runId: "run-1",
  sessionId: "session-1"
} as const;

/**
 * Every tool that the runtime hands to `governedToolFactory.governTools()`
 * must have an exact observation adapter registered in the default boundary,
 * otherwise the dispatcher's `assertAdapterRegistered` raises
 * `CONTEXT_ADAPTER_REQUIRED:<tool>` at run time. This guard test prevents the
 * regression we saw with `web_search` and catches any future additions.
 *
 * `web_search` is dynamically attached via `alwaysAllowTools` (not part of
 * STATIC_AGENT_TOOL_NAMES) but still flows through `governTools`, so it is
 * asserted alongside the static list.
 *
 * `retrieve_knowledge` lives in STATIC_AGENT_TOOL_NAMES but its Adapter is
 * only registered when `includeKnowledge: true`. That is the same flag the
 * runtime uses to decide whether to attach the tool itself, so the boundary
 * default of `includeKnowledge: true` is the right coverage baseline here.
 */
const GOVERNABLE_TOOL_NAMES: readonly string[] = [
  ...STATIC_AGENT_TOOL_NAMES,
  "web_search"
];

describe("default tool observation registry coverage", () => {
  it("registers an exact adapter for every governed tool name", () => {
    const boundary = createToolObservationBoundary({
      identity: RUN_SCOPE,
      includeKnowledge: true
    });
    const dispatcher = new ToolObservationDispatcher(boundary.packager, RUN_SCOPE);

    for (const toolName of GOVERNABLE_TOOL_NAMES) {
      expect(
        () => dispatcher.assertAdapterRegistered(toolName),
        `missing ToolObservationAdapter for governed tool: ${toolName}`
      ).not.toThrow();
    }
  });

  it("omits the knowledge adapter when the boundary is created without KB support", () => {
    const boundary = createToolObservationBoundary({ identity: RUN_SCOPE });
    const dispatcher = new ToolObservationDispatcher(boundary.packager, RUN_SCOPE);

    expect(() => dispatcher.assertAdapterRegistered("retrieve_knowledge"))
      .toThrow("CONTEXT_ADAPTER_REQUIRED:retrieve_knowledge");
  });
});
