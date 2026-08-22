// apps/desktop/src/pet/persona-to-prompt.test.mjs
//
// Acceptance gates for A32.7 (companion-mode guardrails):
//   - personaToSystemPrompt must inject the legal disclaimer in companion mode;
//   - personaToSystemPrompt must NOT inject the disclaimer in work mode;
//   - stripToolsForCompanion must drop every entry in COMPANION_FORBIDDEN_TOOLS;
//   - buildCompanionRunPayload must compose both correctly.

import { describe, it, expect } from "vitest";

import {
  COMPANION_DISCLAIMER,
  COMPANION_FORBIDDEN_TOOLS,
  COMPANION_ALLOWED_TOOLS,
  stripToolsForCompanion,
  renderPersonaHeader,
  personaToSystemPrompt,
  buildCompanionRunPayload,
} from "./persona-to-prompt.mjs";

const samplePersona = {
  id: "pet_test123",
  name: "莫莫",
  archetype: "一个温暖且好奇的助手",
  mood: "warm",
  voice_tone: "轻柔",
  response_length: "short",
  reference_images: [],
  vlm_suggested: false,
  created_at: "2026-08-22T01:30:00Z",
  schema_version: 1,
};

describe("companion-mode guardrails", () => {
  it("injects the disclaimer in companion mode", () => {
    const prefix = personaToSystemPrompt(samplePersona, "companion");
    expect(prefix).toContain(COMPANION_DISCLAIMER);
    expect(prefix).toContain("Persona: 莫莫.");
    expect(prefix).toContain("Archetype: 一个温暖且好奇的助手.");
  });

  it("does NOT inject the disclaimer in work mode", () => {
    const prefix = personaToSystemPrompt(samplePersona, "work");
    expect(prefix).not.toContain(COMPANION_DISCLAIMER);
    expect(prefix).toContain("Persona: 莫莫.");
  });

  it("disclaimer block names the prohibited domains explicitly", () => {
    expect(COMPANION_DISCLAIMER).toMatch(/medical/i);
    expect(COMPANION_DISCLAIMER).toMatch(/legal/i);
    expect(COMPANION_DISCLAIMER).toMatch(/virtual companion/i);
    expect(COMPANION_DISCLAIMER).toContain("END COMPLIANCE BOUNDARY");
  });

  it("stripToolsForCompanion drops every forbidden tool", () => {
    const all = [...COMPANION_FORBIDDEN_TOOLS, "search_documents", "read_workspace_doc"];
    const stripped = stripToolsForCompanion(all);
    for (const forbidden of COMPANION_FORBIDDEN_TOOLS) {
      expect(stripped).not.toContain(forbidden);
    }
    expect(stripped).toContain("search_documents");
    expect(stripped).toContain("read_workspace_doc");
  });

  it("stripToolsForCompanion returns safe defaults when given a non-array", () => {
    const stripped = stripToolsForCompanion(null);
    expect(Array.isArray(stripped)).toBe(true);
    for (const t of stripped) {
      expect(COMPANION_FORBIDDEN_TOOLS).not.toContain(t);
    }
    expect(stripped.length).toBeGreaterThan(0);
  });

  it("stripToolsForCompanion adds the safe defaults when not already present", () => {
    const stripped = stripToolsForCompanion(["custom_tool"]);
    for (const safe of COMPANION_ALLOWED_TOOLS) {
      expect(stripped).toContain(safe);
    }
    expect(stripped).toContain("custom_tool");
  });

  it("buildCompanionRunPayload composes both guardrails correctly", () => {
    const payload = buildCompanionRunPayload(samplePersona, "companion", [
      ...COMPANION_FORBIDDEN_TOOLS,
      "search_documents",
    ]);
    expect(payload.systemPromptPrefix).toContain(COMPANION_DISCLAIMER);
    expect(payload.allowedTools).not.toContain("submit_plan");
    expect(payload.allowedTools).toContain("search_documents");
    expect(payload.allowedTools).toContain("read_workspace_doc");
  });

  it("buildCompanionRunPayload keeps work-mode tools unchanged", () => {
    const payload = buildCompanionRunPayload(
      samplePersona,
      "work",
      [...COMPANION_FORBIDDEN_TOOLS, "custom_tool"],
    );
    expect(payload.systemPromptPrefix).not.toContain(COMPANION_DISCLAIMER);
    expect(payload.allowedTools).toEqual([...COMPANION_FORBIDDEN_TOOLS, "custom_tool"]);
  });

  it("renderPersonaHeader is stable for the same persona and varies with mood", () => {
    const a = renderPersonaHeader(samplePersona);
    const b = renderPersonaHeader(samplePersona);
    expect(a).toBe(b);
    const c = renderPersonaHeader({ ...samplePersona, mood: "playful" });
    expect(c).not.toBe(a);
    expect(c).toContain("playful");
  });

  it("renderPersonaHeader strips control characters from user-supplied fields", () => {
    const dirty = {
      ...samplePersona,
      name: "莫\u0000莫\u0007莫",
      archetype: "archetype\u0001\u0002",
    };
    const header = renderPersonaHeader(dirty);
    // The structural newlines we add ourselves are fine; only the
    // user-supplied fields should be free of C0 control chars.
    const personaLine = header.split("\n").find((l) => l.startsWith("Persona:")) ?? "";
    const archetypeLine = header.split("\n").find((l) => l.startsWith("Archetype:")) ?? "";
    expect(personaLine).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
    expect(archetypeLine).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
    // Sanitised field values pass through into the rendered prefix.
    expect(personaLine).toContain("莫莫莫");
    expect(archetypeLine).toContain("archetype");
  });
});