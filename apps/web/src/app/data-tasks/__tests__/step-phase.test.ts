import { describe, expect, it } from "vitest";

import { stepPhase, stepPhaseForTool } from "../step-phase";

describe("stepPhaseForTool", () => {
  it("classifies retrieval tools as search", () => {
    expect(stepPhaseForTool("web_search")).toBe("search");
    expect(stepPhaseForTool("retrieve_knowledge")).toBe("search");
    expect(stepPhaseForTool("inspect_schema")).toBe("search");
    expect(stepPhaseForTool("list_data_sources")).toBe("search");
  });

  it("classifies action tools as tool", () => {
    expect(stepPhaseForTool("run_sql_readonly")).toBe("tool");
    expect(stepPhaseForTool("execute_command")).toBe("tool");
    expect(stepPhaseForTool("write_file")).toBe("tool");
  });

  it("classifies reasoning tools and no-tool as think", () => {
    expect(stepPhaseForTool("think")).toBe("think");
    expect(stepPhaseForTool(null)).toBe("think");
    expect(stepPhaseForTool(undefined)).toBe("think");
  });
});

describe("stepPhase", () => {
  it("returns think when there is no tool call", () => {
    expect(stepPhase(false, "run_sql_readonly")).toBe("think");
  });
  it("delegates to tool classification when a tool call exists", () => {
    expect(stepPhase(true, "web_search")).toBe("search");
    expect(stepPhase(true, "run_sql_readonly")).toBe("tool");
  });
});
