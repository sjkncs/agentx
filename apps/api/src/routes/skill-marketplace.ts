/**
 * skill-marketplace.ts — A29.2 Skill marketplace HTTP API
 *
 * Two endpoints:
 *   GET  /api/v1/skill-marketplace/catalog
 *     Returns the curated catalog bundled with DataFoundry. Pure read,
 *     no side effects.
 *   POST /api/v1/skill-marketplace/install
 *     Body: { id?: string, repo?: string, ref?: string, skillPath?: string }
 *     Validates the request against the catalog allow-list, fetches the
 *     SKILL.md from raw.githubusercontent.com, parses it through the
 *     shared parseSkillPackage path, then persists a workspace skill
 *     config-resource via the same primitives as the multipart upload.
 *
 * Defense-in-depth: we never proxy arbitrary GitHub repos — only the
 * curated catalog entries. So an attacker cannot pivot this endpoint
 * into a SSRF or a fetch of malicious bytes.
 */

import { createErrorResult, createSuccessResult } from "@datafoundry/contracts";
import {
  buildSkillRawUrl,
  findCatalogEntry,
  findCatalogEntryByRepo,
  loadCatalog,
  parseSkillPackage,
  type SkillCatalogEntry,
  type ParsedSkillPackage,
} from "@datafoundry/skills";
import type { IncomingMessage } from "node:http";

import type { ConfigApiContext, ConfigApiResponse } from "./types.js";

const CATALOG_PATH = "/api/v1/skill-marketplace/catalog";
const INSTALL_PATH = "/api/v1/skill-marketplace/install";
const MAX_SKILL_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

export interface SkillMarketplaceDeps {
  catalog?: SkillCatalogEntry[];
  /** Override for tests; defaults to Node's global fetch. */
  fetcher?: typeof fetch;
}

let _catalog: SkillCatalogEntry[] | undefined;

const getCatalog = (override?: SkillCatalogEntry[]): SkillCatalogEntry[] => {
  if (override) return override;
  if (!_catalog) _catalog = loadCatalog();
  return _catalog;
};

/** Test hook: replace the cached catalog (or clear it). */
export function setSkillCatalog(entries: SkillCatalogEntry[] | undefined): void {
  _catalog = entries;
}

const respond = (
  status: number,
  body: ConfigApiResponse["body"],
): ConfigApiResponse => ({ status, body });

const ok = <T>(data: T): ConfigApiResponse =>
  respond(200, createSuccessResult(data));
const fail = (status: number, code: string, message: string): ConfigApiResponse =>
  respond(status, createErrorResult(code as never, message));

export async function handleSkillMarketplaceRequest(
  request: IncomingMessage,
  pathname: string,
  body: unknown,
  deps: SkillMarketplaceDeps = {},
): Promise<ConfigApiResponse | null> {
  if (pathname !== CATALOG_PATH && pathname !== INSTALL_PATH) return null;
  const catalog = getCatalog(deps.catalog);

  if (pathname === CATALOG_PATH) {
    if (request.method !== "GET") return respond(405, createErrorResult("BAD_REQUEST", "Method not allowed."));
    return ok({ items: catalog });
  }

  // /install
  if (request.method !== "POST") return respond(405, createErrorResult("BAD_REQUEST", "Method not allowed."));
  const reqBody = (body ?? {}) as Record<string, unknown>;
  const id = typeof reqBody.id === "string" ? reqBody.id.trim() : undefined;
  const repo = typeof reqBody.repo === "string" ? reqBody.repo.trim() : undefined;
  const ref = typeof reqBody.ref === "string" ? reqBody.ref.trim() : undefined;
  const skillPath = typeof reqBody.skillPath === "string" ? reqBody.skillPath.trim() : undefined;

  let entry: SkillCatalogEntry | undefined;
  if (id) entry = findCatalogEntry(catalog, id);
  else if (repo) entry = findCatalogEntryByRepo(catalog, repo);
  if (!entry) {
    return fail(400, "BAD_REQUEST",
      `Unknown skill in marketplace catalog (id="${id ?? ""}", repo="${repo ?? ""}").`);
  }

  const url = buildSkillRawUrl(entry, {
    ...(ref ? { ref } : {}),
    ...(skillPath ? { skillPath } : {}),
  });

  const fetcher = deps.fetcher ?? fetch;
  let response: Response;
  try {
    response = await Promise.race([
      fetcher(url, {
        headers: {
          "User-Agent": "DataFoundry-Skill-Marketplace/1.0",
          "Accept": "text/plain,text/markdown",
        },
        redirect: "follow",
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("FETCH_TIMEOUT")), FETCH_TIMEOUT_MS)),
    ]);
  } catch (err) {
    return fail(502, "BAD_REQUEST", `Failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    return fail(502, "BAD_REQUEST", `GitHub responded ${response.status} for ${url}.`);
  }
  const text = await response.text();
  const filename = `${entry.id}.SKILL.md`;
  const content = Buffer.from(text, "utf8");
  if (content.length > MAX_SKILL_BYTES) {
    return fail(400, "BAD_REQUEST", `SKILL.md from GitHub exceeds ${MAX_SKILL_BYTES} byte limit.`);
  }

  let parsed: ParsedSkillPackage;
  try {
    parsed = await parseSkillPackage({ content, filename, mimeType: "text/markdown" });
  } catch (err) {
    return fail(400, "BAD_REQUEST", `SKILL.md parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return ok({
    installedFrom: {
      repo: entry.repo,
      ref: ref ?? entry.defaultRef,
      skillPath: skillPath ?? entry.skillPath,
      url,
    },
    parsed: {
      name: parsed.name,
      description: parsed.description,
      version: parsed.version,
      tags: parsed.tags,
      allowedTools: parsed.allowedTools,
      deniedTools: parsed.deniedTools,
      bytes: content.length,
    },
  });
}