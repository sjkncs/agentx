/**
 * skill-marketplace.ts — curated catalog of installable skills
 *
 * The catalog lives in packages/skills/builtin/skill-catalog.json (committed
 * seed). At install time the API proxy fetches the repo's SKILL.md from
 * raw.githubusercontent.com and runs it through the same parseSkillPackage
 * path as an upload — there is no second validator to keep in sync.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type SkillCatalogEntry = {
  /** Stable id used by the marketplace UI (matches `skill.id` once installed). */
  id: string;
  /** Human-readable display name shown in cards. */
  displayName: string;
  /** One-paragraph description. */
  description: string;
  /** Coarse grouping for filter chips. */
  category:
    | "automation"
    | "creative"
    | "design"
    | "documents"
    | "engineering"
    | "research"
    | "science"
    | "vertical"
    | "writing"
    | "other";
  /** Tags consumed by `selectSkillsForRun` for ranking. */
  tags: string[];
  /** GitHub `owner/name`. */
  repo: string;
  /** Branch or tag; defaults to `main`. */
  defaultRef: string;
  /** Path inside the repo to the SKILL.md file. */
  skillPath: string;
  /** Optional homepage. */
  homepage?: string;
  /** SPDX license id (e.g. MIT, Apache-2.0). */
  license?: string;
  /** Emoji for the card. */
  icon?: string;
  /** Marks entries that ship with AgentX itself. */
  builtin?: boolean;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CATALOG_PATH = resolve(__dirname, "..", "builtin", "skill-catalog.json");

/** Load the bundled catalog from disk. Throws on malformed JSON. */
export const loadCatalog = (path: string = DEFAULT_CATALOG_PATH): SkillCatalogEntry[] => {
  const raw = readFileSync(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("SKILL_CATALOG_INVALID: expected JSON array");
  }
  return parsed.map((entry, index) => normalizeEntry(entry, index));
};

const normalizeEntry = (entry: unknown, index: number): SkillCatalogEntry => {
  if (typeof entry !== "object" || entry === null) {
    throw new Error(`SKILL_CATALOG_INVALID: entry ${index} is not an object`);
  }
  const record = entry as Record<string, unknown>;
  const id = stringRequired(record.id, `entry ${index}.id`);
  const repo = stringRequired(record.repo, `entry ${index}.repo`);
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u.test(repo)) {
    throw new Error(`SKILL_CATALOG_INVALID: entry ${id}.repo must be owner/name`);
  }
  return {
    id,
    displayName: stringRequired(record.displayName ?? record.id, `entry ${index}.displayName`),
    description: stringRequired(record.description, `entry ${index}.description`),
    category: stringRequired(record.category, `entry ${index}.category`) as SkillCatalogEntry["category"],
    tags: stringList(record.tags),
    repo,
    defaultRef: stringValue(record.defaultRef) ?? "main",
    skillPath: stringValue(record.skillPath) ?? "SKILL.md",
    ...(stringValue(record.homepage) ? { homepage: stringValue(record.homepage)! } : {}),
    ...(stringValue(record.license) ? { license: stringValue(record.license)! } : {}),
    ...(stringValue(record.icon) ? { icon: stringValue(record.icon)! } : {}),
    ...(typeof record.builtin === "boolean" ? { builtin: record.builtin } : {}),
  };
};

const stringRequired = (value: unknown, label: string): string => {
  const trimmed = stringValue(value);
  if (!trimmed) throw new Error(`SKILL_CATALOG_INVALID: ${label} required`);
  return trimmed;
};

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const stringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
};

/** Build the GitHub raw URL for a catalog entry's SKILL.md. */
export const buildSkillRawUrl = (
  entry: SkillCatalogEntry,
  overrides: { ref?: string; skillPath?: string } = {},
): string => {
  const ref = overrides.ref ?? entry.defaultRef;
  const skillPath = overrides.skillPath ?? entry.skillPath;
  return `https://raw.githubusercontent.com/${entry.repo}/${ref}/${skillPath}`;
};

/** Find a catalog entry by id. */
export const findCatalogEntry = (
  catalog: SkillCatalogEntry[],
  id: string,
): SkillCatalogEntry | undefined => catalog.find((entry) => entry.id === id);

/** Find a catalog entry by repo string (`owner/name`). */
export const findCatalogEntryByRepo = (
  catalog: SkillCatalogEntry[],
  repo: string,
): SkillCatalogEntry | undefined =>
  catalog.find((entry) => entry.repo.toLowerCase() === repo.toLowerCase());

// Re-export the resolved default catalog path so callers (server tests)
// can confirm where the file lives.
export const __catalogPath = (): string => DEFAULT_CATALOG_PATH;
export const __catalogResolvedFrom = (source: string): string => join(dirname(source), "builtin", "skill-catalog.json");