import { describe, expect, it } from "vitest";

import { SkillRegistry, skillDefinitionKey } from "./skill-registry.js";
import { SkillExecutor } from "./skill-executor.js";
import { codeExplorerSkill } from "./anthropic/code-explorer.js";
import { codeArchitectSkill } from "./anthropic/code-architect.js";
import { codeReviewerSkill } from "./anthropic/code-reviewer.js";
import { featureDevSkill } from "./anthropic/feature-dev.js";
import type { SkillDefinition } from "./skill-types.js";

const SKILL_ID = "test-skill";
const RUN_ID = "run-1";

const makeTestSkill = (overrides: Partial<SkillDefinition> = {}): SkillDefinition => ({
  id: SKILL_ID,
  version: "1",
  displayName: "Test Skill",
  description: "A test skill",
  invocationPattern: "run test skill",
  phases: [
    { id: "phase-1", name: "Phase 1", goal: "Do first thing", humanGate: false,
      transitions: [{ targetPhase: "phase-2", when: "next" }] },
    { id: "phase-2", name: "Phase 2", goal: "Do second thing", humanGate: true,
      transitions: [{ targetPhase: "phase-3", when: "human_confirmed" }] },
    { id: "phase-3", name: "Phase 3", goal: "Done", humanGate: false, transitions: [] },
  ],
  ...overrides,
});

describe("skill-registry", () => {
  it("registers and retrieves a skill definition", () => {
    const registry = new SkillRegistry();
    registry.register(codeExplorerSkill);
    expect(registry.find("code-explorer")).toBe(codeExplorerSkill);
  });

  it("prevents duplicate registration", () => {
    const registry = new SkillRegistry();
    registry.register(codeExplorerSkill);
    expect(() => registry.register(codeExplorerSkill))
      .toThrow("SKILL_ALREADY_REGISTERED:code-explorer");
  });

  it("resolves declarations to full definitions", () => {
    const registry = new SkillRegistry();
    registry.register(codeExplorerSkill);
    registry.register(codeReviewerSkill);
    const resolved = registry.resolve([{ id: "code-explorer", version: "1" }]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.id).toBe("code-explorer");
  });

  it("throws when resolving an unknown skill", () => {
    const registry = new SkillRegistry();
    expect(() => registry.resolve([{ id: "does-not-exist", version: "1" }]))
      .toThrow("SKILL_NOT_FOUND:does-not-exist");
  });

  it("lists all registered skills", () => {
    const registry = new SkillRegistry();
    registry.register(codeExplorerSkill);
    registry.register(codeArchitectSkill);
    registry.register(codeReviewerSkill);
    registry.register(featureDevSkill);
    const all = registry.list();
    expect(all).toHaveLength(4);
  });

  it("lists skills filtered by tag", () => {
    const registry = new SkillRegistry();
    registry.register(codeExplorerSkill);
    registry.register(codeArchitectSkill);
    registry.register(featureDevSkill);
    const anthropicSkills = registry.listByTag("anthropic-pattern");
    expect(anthropicSkills).toHaveLength(3);
  });

  it("skillDefinitionKey formats correctly", () => {
    expect(skillDefinitionKey("code-explorer", "1")).toBe("code-explorer@1");
    expect(skillDefinitionKey("feature-dev", "1")).toBe("feature-dev@1");
  });
});

describe("skill-executor", () => {
  it("begins a skill and returns initial context", () => {
    const executor = new SkillExecutor();
    const skill = makeTestSkill();
    const ctx = executor.begin({ skillId: skill.id, skill, runId: RUN_ID });
    expect(ctx.skillId).toBe(SKILL_ID);
    expect(ctx.phase).toBe("phase-1");
    expect(ctx.subAgentResults).toHaveLength(0);
    expect(ctx.humanConfirmations).toHaveLength(0);
  });

  it("advances phase within a skill", () => {
    const executor = new SkillExecutor();
    const skill = makeTestSkill();
    executor.begin({ skillId: skill.id, skill, runId: RUN_ID });

    const advanced = executor.advancePhase({
      runId: RUN_ID, skillId: SKILL_ID, targetPhaseId: "phase-2"
    });
    expect(advanced.phase).toBe("phase-2");
  });

  it("records sub-agent results", () => {
    const executor = new SkillExecutor();
    const skill = makeTestSkill();
    executor.begin({ skillId: skill.id, skill, runId: RUN_ID });

    const updated = executor.recordSubAgentResults({
      runId: RUN_ID, skillId: SKILL_ID,
      results: [{
        agentId: "agent-1",
        output: "Found 3 entry points",
        findings: [{ category: "entry-points", summary: "Found 3" }],
        executionTimeMs: 1500,
      }]
    });
    expect(updated.subAgentResults).toHaveLength(1);
    expect(updated.subAgentResults[0]?.agentId).toBe("agent-1");
  });

  it("requests and resolves a human confirmation", () => {
    const executor = new SkillExecutor();
    const skill = makeTestSkill();
    executor.begin({ skillId: skill.id, skill, runId: RUN_ID });
    executor.advancePhase({ runId: RUN_ID, skillId: SKILL_ID, targetPhaseId: "phase-2" });

    const { confirmation } = executor.requestHumanConfirmation({
      runId: RUN_ID, skillId: SKILL_ID,
      prompt: "Proceed with implementation?",
      options: ["Proceed", "Cancel", "Modify"]
    });

    expect(confirmation.id).toMatch(/^hc-/);
    expect(confirmation.options).toEqual(["Proceed", "Cancel", "Modify"]);
    expect(confirmation.selectedOption).toBeUndefined();

    const resolved = executor.resolveHumanConfirmation({
      runId: RUN_ID, skillId: SKILL_ID,
      confirmationId: confirmation.id,
      selectedOption: "Proceed"
    });
    expect(resolved.humanConfirmations[0]?.selectedOption).toBe("Proceed");
  });

  it("throws when max human confirmations exceeded", () => {
    const executor = new SkillExecutor({ maxHumanConfirmations: 2 });
    const skill = makeTestSkill();
    executor.begin({ skillId: skill.id, skill, runId: RUN_ID });

    executor.requestHumanConfirmation({
      runId: RUN_ID, skillId: SKILL_ID, prompt: "Q1", options: ["A"]
    });
    executor.requestHumanConfirmation({
      runId: RUN_ID, skillId: SKILL_ID, prompt: "Q2", options: ["A"]
    });

    expect(() => executor.requestHumanConfirmation({
      runId: RUN_ID, skillId: SKILL_ID, prompt: "Q3", options: ["A"]
    })).toThrow("SKILL_HUMAN_CONFIRMATION_LIMIT:2");
  });

  it("completes a skill with an outcome", () => {
    const executor = new SkillExecutor();
    const skill = makeTestSkill();
    executor.begin({ skillId: skill.id, skill, runId: RUN_ID });

    const completed = executor.complete({
      runId: RUN_ID, skillId: SKILL_ID,
      outcome: { kind: "exploration", findings: [{ category: "test", summary: "Done" }] }
    });
    expect(completed.outcome?.kind).toBe("exploration");
    expect((completed.outcome as { findings: unknown[] }).findings).toHaveLength(1);
  });

  it("ends a skill context", () => {
    const executor = new SkillExecutor();
    const skill = makeTestSkill();
    executor.begin({ skillId: skill.id, skill, runId: RUN_ID });
    executor.end(RUN_ID, SKILL_ID);
    expect(executor.getActiveContext(RUN_ID, SKILL_ID)).toBeUndefined();
  });

  it("throws when advancing non-existent context", () => {
    const executor = new SkillExecutor();
    expect(() => executor.advancePhase({
      runId: "nonexistent", skillId: SKILL_ID, targetPhaseId: "phase-2"
    })).toThrow(`SKILL_CONTEXT_NOT_FOUND:nonexistent:${SKILL_ID}`);
  });

  it("detects pending human gate correctly", () => {
    const executor = new SkillExecutor();
    const skill = makeTestSkill();
    executor.begin({ skillId: skill.id, skill, runId: RUN_ID });
    executor.advancePhase({ runId: RUN_ID, skillId: SKILL_ID, targetPhaseId: "phase-2" });

    expect(executor.getNextHumanGate({ runId: RUN_ID, skillId: SKILL_ID, skill })).toBeUndefined();

    executor.requestHumanConfirmation({
      runId: RUN_ID, skillId: SKILL_ID, prompt: "Confirm?", options: ["OK"]
    });

    expect(executor.getNextHumanGate({ runId: RUN_ID, skillId: SKILL_ID, skill })).toBeDefined();
  });

  it("resolves human gate after confirmation", () => {
    const executor = new SkillExecutor();
    const skill = makeTestSkill();
    executor.begin({ skillId: skill.id, skill, runId: RUN_ID });
    executor.advancePhase({ runId: RUN_ID, skillId: SKILL_ID, targetPhaseId: "phase-2" });

    const { confirmation } = executor.requestHumanConfirmation({
      runId: RUN_ID, skillId: SKILL_ID, prompt: "Proceed?", options: ["OK"]
    });

    executor.resolveHumanConfirmation({
      runId: RUN_ID, skillId: SKILL_ID,
      confirmationId: confirmation.id, selectedOption: "OK"
    });

    const gate = executor.getNextHumanGate({ runId: RUN_ID, skillId: SKILL_ID, skill });
    expect(gate).toBeDefined();
    expect(gate!.selectedOption).toBe("OK");
  });
});

describe("anthropic skill definitions", () => {
  it("code-explorer has all 3 sub-agents", () => {
    expect(codeExplorerSkill.subAgents).toHaveLength(3);
    expect(codeExplorerSkill.subAgents!.map(s => s.id)).toEqual([
      "entry-point-tracer", "architecture-mapper", "pattern-analyst"
    ]);
    expect(codeExplorerSkill.tags).toContain("anthropic-pattern");
    expect(codeExplorerSkill.protocolHandoffs).toContain("general-task");
  });

  it("code-architect has all 3 sub-agents with priorities", () => {
    expect(codeArchitectSkill.subAgents).toHaveLength(3);
    const priorities = codeArchitectSkill.subAgents!.map(s => s.priority ?? 99);
    expect(priorities).toEqual([1, 2, 3]);
  });

  it("code-reviewer has confidence-based reporting in system prompt", () => {
    expect(codeReviewerSkill.systemPrompt!).toContain("confidence >= 80%");
    expect(codeReviewerSkill.systemPrompt!).toContain("critical");
    expect(codeReviewerSkill.systemPrompt!).toContain("important");
  });

  it("feature-dev has all 7 phases", () => {
    expect(featureDevSkill.phases).toHaveLength(7);
    expect(featureDevSkill.phases!.map(p => p.id)).toEqual([
      "discovery", "exploration", "clarifying_questions", "architecture_design",
      "implementation", "quality_review", "summary"
    ]);
  });

  it("feature-dev phases have correct human gates", () => {
    const phases = featureDevSkill.phases!;
    expect(phases.find(p => p.id === "clarifying_questions")!.humanGate).toBe(true);
    expect(phases.find(p => p.id === "architecture_design")!.humanGate).toBe(true);
    expect(phases.find(p => p.id === "implementation")!.humanGate).toBe(true);
    expect(phases.find(p => p.id === "quality_review")!.humanGate).toBe(true);
  });

  it("feature-dev phases have correct agents", () => {
    expect(featureDevSkill.phases!.find(p => p.id === "exploration")!.agents)
      .toEqual(["entry-point-tracer", "architecture-mapper", "pattern-analyst"]);
    expect(featureDevSkill.phases!.find(p => p.id === "architecture_design")!.agents)
      .toEqual(["minimal-changes-architect", "clean-architecture-architect", "pragmatic-architect"]);
    expect(featureDevSkill.phases!.find(p => p.id === "quality_review")!.agents)
      .toEqual(["quality-reviewer", "correctness-reviewer", "conventions-reviewer"]);
  });
});
