import { describe, expect, it } from "vitest";

import { buildAgentInstructions } from "./agent-instructions.js";
import { createDataAnalysisProtocol } from "./protocol/protocols/data-analysis.js";
import { createGeneralTaskProtocol } from "./protocol/protocols/general-task.js";
import type { AgentRunContext } from "./types.js";

const runContext: AgentRunContext = {
  user_id: "user-1",
  session_id: "session-1",
  run_id: "run-1",
  user_input: "summarize this",
  chat_mode: "agent"
};

const baseInput = {
  runContext,
  commandExecutionEnabled: false,
  collaborationToolsEnabled: false,
  pythonRuntimeAvailable: false,
  selectedSkills: [],
  taskToolsEnabled: false,
  toolNames: [] as string[],
  mcpToolNames: [] as string[],
  protocolId: "general-task",
  protocolVersion: "2",
  protocolPhase: "understand",
  analysisRequirements: [],
  workspaceAttachments: []
};

describe("buildAgentInstructions phase guidance (Anthropic-style steering)", () => {
  it("injects the current phase guidance into the system prompt", () => {
    const protocol = createGeneralTaskProtocol([]);
    const guidance = protocol.phases.understand?.guidance;
    expect(guidance).toBeTruthy();
    const instructions = buildAgentInstructions({
      ...baseInput,
      protocolId: "general-task",
      protocolVersion: "2",
      protocolPhase: "understand",
      ...(guidance ? { phaseGuidance: guidance } : {})
    });
    expect(instructions).toContain("Current protocol phase: understand");
    expect(instructions).toContain("Phase guidance:");
    expect(instructions).toContain("the protocol runtime still enforces the hard gates");
  });

  it("omits the guidance block when a phase has no guidance text", () => {
    const instructions = buildAgentInstructions({ ...baseInput, protocolPhase: "understand" });
    expect(instructions).not.toContain("Current protocol phase");
  });

  it("defines natural-language guidance for every general-task phase", () => {
    const protocol = createGeneralTaskProtocol([]);
    for (const [phaseId, phase] of Object.entries(protocol.phases)) {
      expect(phase.guidance, `general-task phase ${phaseId}`).toBeTruthy();
    }
  });

  it("defines natural-language guidance for every data-analysis phase", () => {
    const protocol = createDataAnalysisProtocol([]);
    for (const [phaseId, phase] of Object.entries(protocol.phases)) {
      expect(phase.guidance, `data-analysis phase ${phaseId}`).toBeTruthy();
    }
  });

  it("names the governed protocol with its resolved version", () => {
    const instructions = buildAgentInstructions({
      ...baseInput,
      protocolId: "data-analysis",
      protocolVersion: "1",
      protocolPhase: "scope"
    });
    expect(instructions).toContain("governed by data-analysis@1");
  });
});
