// apps/desktop/src/pet/persona.test.mjs
//
// Acceptance gate for AC-9: Persona JSON shape validated against §6.1 (Zod).

import { describe, it, expect } from "vitest";

import {
  PersonaSchema,
  parsePersona,
  tryParsePersona,
  validatePersonaDraft,
  MOODS,
  RESPONSE_LENGTHS,
} from "./persona.mjs";

const validBase = {
  id: "pet_abcd1234",
  name: "莫莫",
  archetype: "一个温暖且好奇的助手",
  mood: "warm",
  voice_tone: "轻柔、清晰、偶尔带一点鼻音",
  response_length: "short",
  reference_images: [],
  vlm_suggested: false,
  created_at: "2026-08-22T01:30:00Z",
  schema_version: 1,
};

describe("persona schema", () => {
  it("accepts the spec example", () => {
    const persona = parsePersona(validBase);
    expect(persona.name).toBe("莫莫");
    expect(persona.schema_version).toBe(1);
  });

  it("fills defaults when optional fields are absent", () => {
    const persona = parsePersona({
      ...validBase,
      archetype: undefined,
      mood: undefined,
      voice_tone: undefined,
      response_length: undefined,
      reference_images: undefined,
      vlm_suggested: undefined,
    });
    expect(persona.archetype).toBe("");
    expect(persona.mood).toBe("attentive");
    expect(persona.voice_tone).toBe("");
    expect(persona.response_length).toBe("short");
    expect(persona.reference_images).toEqual([]);
    expect(persona.vlm_suggested).toBe(false);
  });

  it("enforces 1-32 character names", () => {
    expect(() => parsePersona({ ...validBase, name: "" })).toThrow();
    expect(() => parsePersona({ ...validBase, name: "x".repeat(33) })).toThrow();
    expect(() =>
      parsePersona({ ...validBase, name: "has/slash" }),
    ).toThrow();
    expect(() =>
      parsePersona({ ...validBase, name: "has\ttab" }),
    ).toThrow();
  });

  it("limits reference_images to 4 with sha256 hashes", () => {
    const sha = (suffix) => `sha256:${"a".repeat(63)}${suffix}`;
    const four = [sha("1"), sha("2"), sha("3"), sha("4")];
    expect(() =>
      parsePersona({ ...validBase, reference_images: four }),
    ).not.toThrow();
    expect(() =>
      parsePersona({
        ...validBase,
        reference_images: [...four, sha("5")],
      }),
    ).toThrow();
    expect(() =>
      parsePersona({
        ...validBase,
        reference_images: ["sha256:bad"],
      }),
    ).toThrow();
    expect(() =>
      parsePersona({
        ...validBase,
        reference_images: ["notahash"],
      }),
    ).toThrow();
  });

  it("rejects unknown mood / response_length", () => {
    expect(() => parsePersona({ ...validBase, mood: "ecstatic" })).toThrow();
    expect(() =>
      parsePersona({ ...validBase, response_length: "novel" }),
    ).toThrow();
  });

  it("exposes the canonical mood and length lists", () => {
    expect(MOODS).toContain("attentive");
    expect(MOODS).toContain("warm");
    expect(RESPONSE_LENGTHS).toContain("one_sentence");
  });

  it("schema_version must be 1", () => {
    expect(() => parsePersona({ ...validBase, schema_version: 2 })).toThrow();
  });

  it("tryParsePersona returns null on failure", () => {
    expect(tryParsePersona({ ...validBase, name: "" })).toBeNull();
    expect(tryParsePersona(validBase)).not.toBeNull();
  });

  it("validatePersonaDraft returns empty list for valid drafts", () => {
    const errs = validatePersonaDraft({
      ...validBase,
      // builder UI won't have an id yet — supply a placeholder
      id: "draft",
    });
    expect(errs).toEqual([]);
  });

  it("validatePersonaDraft returns per-field errors for invalid drafts", () => {
    const errs = validatePersonaDraft({
      id: "draft",
      name: "",
      mood: "ecstatic",
      voice_tone: "x".repeat(201),
      reference_images: ["bad"],
      response_length: "novel",
    });
    expect(errs.length).toBeGreaterThan(0);
    const flat = errs.join("\n");
    expect(flat).toMatch(/name/);
    expect(flat).toMatch(/mood/);
    expect(flat).toMatch(/voice_tone/);
  });
});