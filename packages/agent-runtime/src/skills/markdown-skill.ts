import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  SkillDefinition,
  SkillSubAgentDefinition,
  SkillTransition,
  SkillWorkflowPhase
} from "./skill-types.js";
import type { SkillRegistry } from "./skill-registry.js";

/**
 * Anthropic-style SKILL.md bridge (Option A).
 *
 * The upstream `packages/skills` pipeline stores skills as declarative
 * SKILL.md files (YAML frontmatter + markdown body), following the
 * Anthropic Agent Skills spec: the metadata lives in frontmatter, the
 * instructions live in plain markdown. This module bridges that format
 * and the runtime's structured `SkillDefinition`, so the same skill can
 * be authored once as markdown and executed by the skill runtime:
 *
 *   SKILL.md --parseSkillMarkdown--> SkillDefinition --SkillRegistry--> executor
 *   SkillDefinition --serializeSkillToMarkdown--> SKILL.md (round-trip safe)
 *
 * The frontmatter parser below intentionally supports only the YAML
 * subset used by skill files (scalar values and flat string lists), so
 * no YAML dependency is added to the runtime package. Files produced by
 * `serializeSkillToMarkdown` are also valid input for the upstream
 * `parseSkillPackage` in packages/skills.
 */

export type MarkdownSkillParseResult = {
  frontmatter: Record<string, unknown>;
  /** Markdown body without the frontmatter block. */
  instructions: string;
  definition: SkillDefinition;
};

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** Serialize a runtime SkillDefinition to an Anthropic-style SKILL.md. */
export const serializeSkillToMarkdown = (definition: SkillDefinition): string => {
  const lines: string[] = [
    "---",
    `name: ${yamlScalar(definition.id)}`,
    `description: ${yamlScalar(definition.description)}`,
    `version: ${yamlScalar(definition.version)}`
  ];
  if (definition.displayName && definition.displayName !== definition.id) {
    lines.push(`display-name: ${yamlScalar(definition.displayName)}`);
  }
  if (definition.invocationPattern && definition.invocationPattern !== `/${definition.id}`) {
    lines.push(`invocation: ${yamlScalar(definition.invocationPattern)}`);
  }
  if (definition.tags && definition.tags.length > 0) {
    lines.push("tags:", ...definition.tags.map((tag) => `  - ${yamlScalar(tag)}`));
  }
  if (definition.protocolHandoffs && definition.protocolHandoffs.length > 0) {
    lines.push(
      "protocol-handoffs:",
      ...definition.protocolHandoffs.map((target) => `  - ${yamlScalar(target)}`)
    );
  }
  lines.push("---", "");

  lines.push(`# ${definition.displayName}`, "", definition.description, "");
  if (definition.invocationPattern) {
    lines.push(`Invoke with \`${definition.invocationPattern}\`.`, "");
  }

  if (definition.phases && definition.phases.length > 0) {
    lines.push("## Workflow", "");
    definition.phases.forEach((phase, index) => {
      lines.push(`### Phase ${index + 1}: ${phase.name} (${phase.id})`, "");
      lines.push(`Goal: ${phase.goal}`, "");
      if (phase.agents && phase.agents.length > 0) {
        lines.push(`Agents: ${phase.agents.join(", ")}`, "");
      }
      if (phase.allowedActions && phase.allowedActions.length > 0) {
        lines.push(`Tools: ${phase.allowedActions.join(", ")}`, "");
      }
      if (phase.humanGate) {
        lines.push("Human gate: yes", "");
        lines.push("Pause here and wait for explicit human confirmation before continuing.", "");
      }
      for (const transition of phase.transitions ?? []) {
        lines.push(`Next: ${transition.targetPhase} when ${transition.when}`);
      }
      lines.push("");
    });
  }

  if (definition.subAgents && definition.subAgents.length > 0) {
    lines.push("## Sub-agents", "");
    for (const agent of definition.subAgents) {
      lines.push(`### ${agent.id}: ${agent.name}`, "");
      lines.push(`Focus: ${agent.focusArea}`, "");
      if (agent.maxIterations !== undefined) {
        lines.push(`Max iterations: ${agent.maxIterations}`, "");
      }
      if (agent.priority !== undefined) {
        lines.push(`Priority: ${agent.priority}`, "");
      }
      lines.push("Prompt:", "", "```", agent.promptTemplate, "```", "");
    }
  }

  if (definition.systemPrompt) {
    lines.push("## System prompt", "", "```", definition.systemPrompt, "```", "");
  }

  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd()}\n`;
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse an Anthropic-style SKILL.md into frontmatter, body, and a runtime
 * SkillDefinition. Mirrors upstream error names so callers can handle both
 * pipelines uniformly.
 */
export const parseSkillMarkdown = (content: string): MarkdownSkillParseResult => {
  const normalized = content.replace(/\r\n/gu, "\n").trim();
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(normalized);
  if (!match) {
    throw new Error("SKILL_FRONTMATTER_REQUIRED");
  }
  const frontmatter = parseFrontmatter(match[1] ?? "");
  const instructions = (match[2] ?? "").trim();

  const name = frontmatterValue(frontmatter.name);
  const description = frontmatterValue(frontmatter.description);
  if (!name || !description) {
    throw new Error("SKILL_NAME_DESCRIPTION_REQUIRED");
  }

  const tags = frontmatterList(frontmatter.tags);
  const protocolHandoffs = frontmatterList(frontmatter["protocol-handoffs"]);
  const displayName = frontmatterValue(frontmatter["display-name"]) ?? name;
  const invocationPattern = frontmatterValue(frontmatter.invocation) ?? `/${name}`;
  const version = frontmatterValue(frontmatter.version) ?? "1";

  const sections = splitSections(instructions);
  const definition: SkillDefinition = {
    id: name,
    version,
    description,
    displayName,
    invocationPattern,
    ...(tags.length > 0 ? { tags } : {}),
    ...(protocolHandoffs.length > 0 ? { protocolHandoffs } : {}),
    ...(sections.phases.length > 0 ? { phases: sections.phases } : {}),
    ...(sections.subAgents.length > 0 ? { subAgents: sections.subAgents } : {}),
    ...(sections.systemPrompt !== undefined ? { systemPrompt: sections.systemPrompt } : {})
  };
  return { frontmatter, instructions, definition };
};

/** Convenience wrapper: SKILL.md content -> SkillDefinition. */
export const markdownToSkillDefinition = (content: string): SkillDefinition =>
  parseSkillMarkdown(content).definition;

/** Read `<directory>/SKILL.md` and turn it into a SkillDefinition. */
export const loadSkillFromDirectory = (directory: string): SkillDefinition =>
  markdownToSkillDefinition(readFileSync(join(directory, "SKILL.md"), "utf8"));

/** Parse SKILL.md content and register the resulting skill in the registry. */
export const registerMarkdownSkill = (
  registry: SkillRegistry,
  content: string
): SkillDefinition => {
  const definition = markdownToSkillDefinition(content);
  registry.register(definition);
  return definition;
};

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type BodyBlock =
  | { kind: "line"; text: string }
  | { kind: "fence"; content: string };

type ParsedSections = {
  phases: SkillWorkflowPhase[];
  subAgents: SkillSubAgentDefinition[];
  systemPrompt: string | undefined;
};

type MutablePhase = {
  id: string;
  name: string;
  goal: string;
  agents: string[] | undefined;
  allowedActions: string[] | undefined;
  humanGate: boolean;
  transitions: SkillTransition[];
};

type MutableAgent = {
  id: string;
  name: string;
  focusArea: string;
  promptTemplate: string;
  maxIterations: number | undefined;
  priority: number | undefined;
};

const splitSections = (instructions: string): ParsedSections => {
  const blocks = splitBlocks(instructions);
  const phases: MutablePhase[] = [];
  const subAgents: MutableAgent[] = [];
  let systemPrompt: string | undefined;

  let section = "";
  let phase: MutablePhase | undefined;
  let agent: MutableAgent | undefined;

  const closePhase = (): void => {
    if (phase) {
      phases.push(phase);
      phase = undefined;
    }
  };
  const closeAgent = (): void => {
    if (agent) {
      subAgents.push(agent);
      agent = undefined;
    }
  };

  for (const block of blocks) {
    if (block.kind === "fence") {
      if (section === "system prompt" && systemPrompt === undefined) {
        systemPrompt = block.content;
      } else if (section === "sub-agents" && agent) {
        agent.promptTemplate = block.content;
      }
      continue;
    }
    const line = block.text.trim();
    if (line.startsWith("## ")) {
      closePhase();
      closeAgent();
      section = line.slice(3).trim().toLowerCase();
      continue;
    }
    if (section === "workflow" && line.startsWith("### ")) {
      const header = /^### Phase \d+: (.+?) \(([A-Za-z0-9_-]+)\)$/u.exec(line);
      if (header) {
        closePhase();
        phase = {
          id: header[2] ?? "",
          name: (header[1] ?? "").trim(),
          goal: "",
          agents: undefined,
          allowedActions: undefined,
          humanGate: false,
          transitions: []
        };
      }
      continue;
    }
    if (section === "sub-agents" && line.startsWith("### ")) {
      const header = /^### ([A-Za-z0-9_-]+): (.+)$/u.exec(line);
      if (header) {
        closeAgent();
        agent = {
          id: header[1] ?? "",
          name: (header[2] ?? "").trim(),
          focusArea: "",
          promptTemplate: "",
          maxIterations: undefined,
          priority: undefined
        };
      }
      continue;
    }
    if (section === "workflow" && phase) {
      applyPhaseLine(phase, line);
    } else if (section === "sub-agents" && agent) {
      applyAgentLine(agent, line);
    }
  }
  closePhase();
  closeAgent();

  return {
    phases: phases.map((mutable) => toWorkflowPhase(mutable)),
    subAgents: subAgents.map((mutable) => toSubAgentDefinition(mutable)),
    systemPrompt
  };
};

const applyPhaseLine = (phase: MutablePhase, line: string): void => {
  const goal = keyedValue(line, "Goal");
  if (goal !== undefined) {
    phase.goal = goal;
    return;
  }
  const agents = keyedValue(line, "Agents");
  if (agents !== undefined) {
    phase.agents = splitCsv(agents);
    return;
  }
  const tools = keyedValue(line, "Tools");
  if (tools !== undefined) {
    phase.allowedActions = splitCsv(tools);
    return;
  }
  const gate = keyedValue(line, "Human gate");
  if (gate !== undefined) {
    phase.humanGate = /^(yes|true)$/iu.test(gate);
    return;
  }
  const next = keyedValue(line, "Next");
  if (next !== undefined) {
    const transition = /^([A-Za-z0-9_-]+) when (.+)$/u.exec(next);
    if (transition) {
      phase.transitions.push({
        targetPhase: transition[1] ?? "",
        when: (transition[2] ?? "").trim()
      });
    }
  }
};

const applyAgentLine = (agent: MutableAgent, line: string): void => {
  const focus = keyedValue(line, "Focus");
  if (focus !== undefined) {
    agent.focusArea = focus;
    return;
  }
  const iterations = keyedValue(line, "Max iterations");
  if (iterations !== undefined && /^\d+$/u.test(iterations)) {
    agent.maxIterations = Number(iterations);
    return;
  }
  const priority = keyedValue(line, "Priority");
  if (priority !== undefined && /^\d+$/u.test(priority)) {
    agent.priority = Number(priority);
  }
};

const toWorkflowPhase = (mutable: MutablePhase): SkillWorkflowPhase => ({
  id: mutable.id,
  name: mutable.name,
  goal: mutable.goal,
  ...(mutable.agents && mutable.agents.length > 0 ? { agents: mutable.agents } : {}),
  ...(mutable.allowedActions && mutable.allowedActions.length > 0
    ? { allowedActions: mutable.allowedActions }
    : {}),
  humanGate: mutable.humanGate,
  transitions: mutable.transitions
});

const toSubAgentDefinition = (mutable: MutableAgent): SkillSubAgentDefinition => ({
  id: mutable.id,
  name: mutable.name,
  focusArea: mutable.focusArea,
  promptTemplate: mutable.promptTemplate,
  ...(mutable.maxIterations !== undefined ? { maxIterations: mutable.maxIterations } : {}),
  ...(mutable.priority !== undefined ? { priority: mutable.priority } : {})
});

const keyedValue = (line: string, key: string): string | undefined => {
  if (!line.toLowerCase().startsWith(`${key.toLowerCase()}:`)) {
    return undefined;
  }
  return line.slice(key.length + 1).trim();
};

const splitCsv = (value: string): string[] =>
  value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);

const splitBlocks = (instructions: string): BodyBlock[] => {
  const blocks: BodyBlock[] = [];
  let fence: string[] | undefined;
  for (const rawLine of instructions.split("\n")) {
    if (rawLine.trimStart().startsWith("```")) {
      if (fence) {
        blocks.push({ kind: "fence", content: fence.join("\n") });
        fence = undefined;
      } else {
        fence = [];
      }
      continue;
    }
    if (fence) {
      fence.push(rawLine);
      continue;
    }
    blocks.push({ kind: "line", text: rawLine });
  }
  if (fence) {
    blocks.push({ kind: "fence", content: fence.join("\n") });
  }
  return blocks;
};

/** Minimal YAML-subset parser: scalars and flat string lists only. */
const parseFrontmatter = (value: string): Record<string, unknown> => {
  const parsed: Record<string, unknown> = {};
  let listKey: string | undefined;
  for (const rawLine of value.split("\n")) {
    const line = rawLine.replace(/\r$/u, "");
    if (listKey !== undefined) {
      const item = /^\s+-\s+(.*)$/u.exec(line);
      if (item) {
        const text = (item[1] ?? "").trim();
        if (text.length > 0) {
          (parsed[listKey] as string[]).push(stripQuotes(text));
        }
        continue;
      }
      listKey = undefined;
    }
    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }
    const entry = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line);
    if (!entry) {
      continue;
    }
    const key = entry[1] ?? "";
    const text = (entry[2] ?? "").trim();
    if (text === "") {
      parsed[key] = [];
      listKey = key;
    } else if (text === "[]") {
      parsed[key] = [];
    } else if (text === "true" || text === "false") {
      parsed[key] = text === "true";
    } else {
      parsed[key] = stripQuotes(text);
    }
  }
  return parsed;
};

const frontmatterValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const frontmatterList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
};

const stripQuotes = (value: string): string => {
  if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1).replace(/\\(["\\])/gu, "$1");
  }
  return value;
};

/** Quote a scalar when a strict YAML parser would misread it. */
const yamlScalar = (value: string): string => {
  const needsQuotes = value.trim() !== value
    || value === ""
    || /[:#\[\]{}&*!|>'"%@,]/u.test(value)
    || /^(true|false|null|yes|no)$/iu.test(value)
    || /^-?\d+(\.\d+)?$/u.test(value);
  if (!needsQuotes) {
    return value;
  }
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, "\\\"")}"`;
};
