import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { featureDevSkill } from "./anthropic/feature-dev.js";
import {
  loadSkillFromDirectory,
  parseSkillMarkdown,
  registerMarkdownSkill,
  serializeSkillToMarkdown
} from "./markdown-skill.js";
import { SkillRegistry } from "./skill-registry.js";
import type { SkillDefinition } from "./skill-types.js";

const builtinFeatureDevDir = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..", "..", "..", "skills", "builtin", "feature-dev"
);

describe("markdown skill bridge", () => {
  it("round-trips the feature-dev skill through SKILL.md", () => {
    const markdown = serializeSkillToMarkdown(featureDevSkill);
    const { definition } = parseSkillMarkdown(markdown);
    expect(definition).toEqual(featureDevSkill);
    // Idempotent: serializing the parsed definition reproduces the same file.
    expect(serializeSkillToMarkdown(definition)).toBe(markdown);
  });

  it("round-trips a minimal skill definition", () => {
    const minimal: SkillDefinition = {
      id: "tiny",
      version: "1",
      description: "A tiny skill",
      displayName: "tiny",
      invocationPattern: "/tiny"
    };
    const { definition } = parseSkillMarkdown(serializeSkillToMarkdown(minimal));
    expect(definition).toEqual(minimal);
  });

  it("keeps human gates and transitions intact", () => {
    const { definition } = parseSkillMarkdown(serializeSkillToMarkdown(featureDevSkill));
    const gated = (definition.phases ?? []).filter((phase) => phase.humanGate).map((phase) => phase.id);
    expect(gated).toEqual([
      "clarifying_questions",
      "architecture_design",
      "implementation",
      "quality_review"
    ]);
    const review = definition.phases?.find((phase) => phase.id === "quality_review");
    expect(review?.transitions).toEqual([
      { targetPhase: "summary", when: "human_confirmed" },
      { targetPhase: "implementation", when: "human_requested_fixes" }
    ]);
  });

  it("rejects content without frontmatter", () => {
    expect(() => parseSkillMarkdown("# No frontmatter here")).toThrow("SKILL_FRONTMATTER_REQUIRED");
  });

  it("rejects frontmatter without name and description", () => {
    expect(() => parseSkillMarkdown("---\nname: only-name\n---\nBody")).toThrow(
      "SKILL_NAME_DESCRIPTION_REQUIRED"
    );
  });

  it("parses the builtin feature-dev SKILL.md shipped with packages/skills", () => {
    const content = readFileSync(resolve(builtinFeatureDevDir, "SKILL.md"), "utf8");
    const { definition } = parseSkillMarkdown(content);
    expect(definition.id).toBe("feature-dev");
    expect(definition.phases).toHaveLength(7);
    expect(definition.subAgents).toHaveLength(9);
    expect(definition.tags).toContain("anthropic-pattern");
    expect(definition.tags).toContain("功能开发");
    expect(definition.systemPrompt).toContain("PHASE 1 - DISCOVERY");
  });

  it("loads a skill directory and registers it into a registry", () => {
    const definition = loadSkillFromDirectory(builtinFeatureDevDir);
    expect(definition.id).toBe("feature-dev");

    const registry = new SkillRegistry();
    registerMarkdownSkill(registry, serializeSkillToMarkdown(definition));
    expect(registry.find("feature-dev")?.phases).toHaveLength(7);
    expect(() => registerMarkdownSkill(registry, serializeSkillToMarkdown(definition))).toThrow(
      "SKILL_ALREADY_REGISTERED:feature-dev"
    );
  });
});
