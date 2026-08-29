/**
 * skill-marketplace.ts — A30 Skill marketplace HTTP API (full persistence)
 *
 * Endpoints:
 *   GET  /api/v1/skill-marketplace/catalog
 *     Returns the curated catalog bundled with AgentX. Pure read.
 *
 *   POST /api/v1/skill-marketplace/install
 *     Body: { id?: string, repo?: string, ref?: string, skillPath?: string,
 *             scope?: "workspace" | "user" }
 *     Validates the request against the catalog allow-list, fetches the
 *     SKILL.md from raw.githubusercontent.com, parses it through the shared
 *     parseSkillPackage path, then PERSISTS into the data plane:
 *       - fileAssetService.createRef (source="skill-package")
 *       - metadataStore.configResources.upsert (kind="skill")
 *       - Supabase dfd_audit_events (category="skill-marketplace", action="install")
 *       - Supabase fsf_messages (conversation_id="marketplace", role="system")
 *         so downstream Inngest can pick the install event up.
 *
 *   POST /api/v1/skill-marketplace/sync
 *     Body: { id?: string, repo?: string, ref?: string }
 *     Re-fetches SKILL.md from GitHub and updates an already-installed skill
 *     (revision bump, file ref replaced, audit + fsf message).
 *
 *   GET  /api/v1/skill-marketplace/installed
 *     Lists installed skills (kind="skill") for the current workspace/user.
 *
 *   POST /api/v1/skill-marketplace/uninstall
 *     Body: { id: string }
 *     Removes the workspace skill config + soft-deletes the file ref.
 *
 * Defense-in-depth: we never proxy arbitrary GitHub repos — only the
 * curated catalog entries. So an attacker cannot pivot this endpoint
 * into a SSRF or a fetch of malicious bytes.
 */

import { createErrorResult, createSuccessResult } from "@agentx/contracts";
import {
  buildSkillRawUrl,
  buildSkillResourcePayload,
  configResourceToSkillRecord,
  findCatalogEntry,
  findCatalogEntryByRepo,
  loadCatalog,
  parseSkillPackage,
  type SkillCatalogEntry,
  type ParsedSkillPackage,
} from "@agentx/skills";
import { supabase } from "@agentx/supabase-bridge";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

import type { ConfigApiContext, ConfigApiResponse } from "./types.js";

const CATALOG_PATH = "/api/v1/skill-marketplace/catalog";
const INSTALL_PATH = "/api/v1/skill-marketplace/install";
const SYNC_PATH = "/api/v1/skill-marketplace/sync";
const INSTALLED_PATH = "/api/v1/skill-marketplace/installed";
const UNINSTALL_PATH = "/api/v1/skill-marketplace/uninstall";

const MAX_SKILL_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const MARKETPLACE_CONVERSATION_ID = "marketplace";

export interface SkillMarketplaceDeps {
  catalog?: SkillCatalogEntry[];
  fetcher?: typeof fetch;
  /** Override for tests; defaults to the singleton SupabaseClient. */
  supabaseClient?: ReturnType<typeof supabase>;
}

let _catalog: SkillCatalogEntry[] | undefined;

const getCatalog = (override?: SkillCatalogEntry[]): SkillCatalogEntry[] => {
  if (override) return override;
  if (!_catalog) _catalog = loadCatalog();
  return _catalog;
};

export function setSkillCatalog(entries: SkillCatalogEntry[] | undefined): void {
  _catalog = entries;
}

const respond = (status: number, body: ConfigApiResponse["body"]): ConfigApiResponse => ({
  status,
  body
});

const ok = <T>(data: T): ConfigApiResponse => respond(200, createSuccessResult(data));
const fail = (status: number, code: string, message: string): ConfigApiResponse =>
  respond(status, createErrorResult(code as never, message));

type WorkspaceScope = { workspace_id: string; user_id: string };

const resolveScope = (ctx: ConfigApiContext): WorkspaceScope => ({
  user_id: ctx.userId,
  workspace_id: ctx.workspaceId ?? "default"
});

/**
 * Fire-and-best-effort audit + fsf_message writes. We never fail the
 * marketplace install because Supabase is offline — local metadata is the
 * source of truth; Supabase is the durability mirror.
 */
const emitInstallAudit = async (
  deps: SkillMarketplaceDeps,
  scope: WorkspaceScope,
  record: {
    catalogId: string;
    repo: string;
    ref: string;
    skillPath: string;
    skillName: string;
    fileAssetRefId: string;
    action: "install" | "sync" | "uninstall";
  }
): Promise<{ audit: { status: number; error: string | null }; fsf: { status: number; error: string | null } }> => {
  const client = deps.supabaseClient ?? supabase();
  const nowIso = new Date().toISOString();
  const eventId = randomUUID();

  const auditPayload = {
    marketplace_event_id: eventId,
    catalog_id: record.catalogId,
    repo: record.repo,
    ref: record.ref,
    skill_path: record.skillPath,
    skill_name: record.skillName,
    file_asset_ref_id: record.fileAssetRefId,
    actor_user_id: scope.user_id,
    workspace_id: scope.workspace_id,
    installed_at: nowIso
  };

  const auditRes = await client.insert("dfd_audit_events", {
    workspace_id: scope.workspace_id,
    actor_id: scope.user_id,
    category: "skill-marketplace",
    severity: "info",
    action: record.action,
    target: record.catalogId,
    payload: auditPayload
  });

  const fsfRes = await client.insert("fsf_messages", {
    conversation_id: MARKETPLACE_CONVERSATION_ID,
    role: "system",
    content: `skill-marketplace:${record.action}:${record.catalogId}@${record.repo}#${record.ref}`,
    intent: "skill_marketplace",
    sub_intent: record.action,
    risk_level: "low",
    audit_status: "pass",
    audit_violations: [],
    metadata: {
      ...auditPayload,
      marketplace_event_id: eventId
    }
  });

  return {
    audit: { status: auditRes.status, error: auditRes.error },
    fsf: { status: fsfRes.status, error: fsfRes.error }
  };
};

/** Fetch a SKILL.md from GitHub raw, with timeout + size guard. */
const fetchSkillFromGithub = async (
  entry: SkillCatalogEntry,
  overrides: { ref?: string; skillPath?: string },
  fetcher: typeof fetch
): Promise<{ buffer: Buffer; filename: string; url: string; effectiveRef: string; effectivePath: string }> => {
  const effectiveRef = overrides.ref ?? entry.defaultRef;
  const effectivePath = overrides.skillPath ?? entry.skillPath;
  const url = buildSkillRawUrl(entry, {
    ref: effectiveRef,
    skillPath: effectivePath
  });

  let response: Response;
  try {
    response = await Promise.race([
      fetcher(url, {
        headers: {
          "User-Agent": "AgentX-Skill-Marketplace/1.0",
          Accept: "text/plain,text/markdown"
        },
        redirect: "follow"
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("FETCH_TIMEOUT")), FETCH_TIMEOUT_MS))
    ]);
  } catch (err) {
    throw new Error(`FETCH_FAILED:${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    throw new Error(`GITHUB_HTTP_${response.status}`);
  }
  const text = await response.text();
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length > MAX_SKILL_BYTES) {
    throw new Error(`SKILL_MD_TOO_LARGE:${buffer.length}`);
  }
  return { buffer, filename: `${entry.id}.SKILL.md`, url, effectiveRef, effectivePath };
};

/** Persist a parsed SKILL.md to fileAsset + configResource (one transactional unit). */
const persistSkillPackage = (input: {
  ctx: ConfigApiContext;
  entry: SkillCatalogEntry;
  buffer: Buffer;
  filename: string;
  effectiveRef: string;
  effectivePath: string;
  parsed: ParsedSkillPackage;
  scope?: "workspace" | "user";
  expectedRevision?: number;
}) => {
  const { ctx, entry, buffer, filename, effectiveRef, effectivePath, parsed } = input;
  const scope = input.scope ?? "workspace";
  const ws = resolveScope(ctx);

  // 1) write bytes to file asset store (content-addressed dedupe)
  const { ref: fileRef } = ctx.fileAssetService.createRef({
    user_id: ws.user_id,
    workspace_id: ws.workspace_id,
    filename,
    content: buffer,
    declared_mime_type: "text/markdown",
    source: "skill-package",
    metadata: {
      catalog_id: entry.id,
      repo: entry.repo,
      ref: effectiveRef,
      skill_path: effectivePath,
      parsed_name: parsed.name,
      parsed_version: parsed.version
    }
  });

  // 2) build config-resource payload (same as multipart upload path)
  const payload = buildSkillResourcePayload({
    fields: {
      scope,
      tags: entry.tags.join(","),
      packageSource: `github:${entry.repo}@${effectiveRef}:${effectivePath}`
    },
    packageFileRefId: fileRef.id,
    parsed
  });

  // 3) upsert workspace skill
  const record = ctx.metadataStore.configResources.upsert({
    id: entry.id,
    workspace_id: ws.workspace_id,
    user_id: ws.user_id,
    kind: "skill",
    name: parsed.name,
    description: parsed.description,
    payload,
    default_enabled: true,
    builtin: false,
    status: "ready",
    ...(input.expectedRevision !== undefined ? { expected_revision: input.expectedRevision } : {})
  });

  return { fileRef, record };
};

export async function handleSkillMarketplaceRequest(
  request: IncomingMessage,
  pathname: string,
  body: unknown,
  deps: SkillMarketplaceDeps = {}
): Promise<ConfigApiResponse | null> {
  const ctx = (request as IncomingMessage & { configContext?: ConfigApiContext }).configContext;
  if (!ctx) return null;
  const catalog = getCatalog(deps.catalog);

  if (pathname === CATALOG_PATH) {
    if (request.method !== "GET") return respond(405, createErrorResult("BAD_REQUEST", "Method not allowed."));
    return ok({ items: catalog });
  }

  if (pathname === INSTALLED_PATH) {
    if (request.method !== "GET") return respond(405, createErrorResult("BAD_REQUEST", "Method not allowed."));
    const ws = resolveScope(ctx);
    const records = ctx.metadataStore.configResources
      .list({ workspace_id: ws.workspace_id, user_id: ws.user_id, kind: "skill" })
      .map(configResourceToSkillRecord);
    return ok({
      items: records.map((record) => ({
        id: record.id,
        name: record.name,
        description: record.description,
        tags: record.tags,
        version: record.version,
        builtin: record.builtin,
        defaultEnabled: record.defaultEnabled,
        status: record.status,
        packageFileRefId: record.packageFileRefId ?? null,
        revision: record.revision,
        updatedAt: ctx.metadataStore.configResources
          .find({
            id: record.id,
            workspace_id: ws.workspace_id,
            user_id: ws.user_id,
            kind: "skill"
          })
          ?.updated_at ?? null
      }))
    });
  }

  if (pathname === INSTALL_PATH || pathname === SYNC_PATH) {
    if (request.method !== "POST") return respond(405, createErrorResult("BAD_REQUEST", "Method not allowed."));
    const reqBody = (body ?? {}) as Record<string, unknown>;
    const id = typeof reqBody.id === "string" ? reqBody.id.trim() : undefined;
    const repo = typeof reqBody.repo === "string" ? reqBody.repo.trim() : undefined;
    const ref = typeof reqBody.ref === "string" ? reqBody.ref.trim() : undefined;
    const skillPath = typeof reqBody.skillPath === "string" ? reqBody.skillPath.trim() : undefined;
    const scope = reqBody.scope === "user" ? "user" : "workspace";

    const entry = id ? findCatalogEntry(catalog, id) : repo ? findCatalogEntryByRepo(catalog, repo) : undefined;
    if (!entry) {
      return fail(400, "BAD_REQUEST", `Unknown skill in marketplace catalog (id="${id ?? ""}", repo="${repo ?? ""}").`);
    }

    const fetcher = deps.fetcher ?? fetch;
    let fetchResult: Awaited<ReturnType<typeof fetchSkillFromGithub>>;
    try {
      fetchResult = await fetchSkillFromGithub(entry, { ...(ref ? { ref } : {}), ...(skillPath ? { skillPath } : {}) }, fetcher);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.startsWith("GITHUB_HTTP_") ? 502 : 502;
      return fail(status, "BAD_REQUEST", `GitHub fetch failed: ${msg}`);
    }

    let parsed: ParsedSkillPackage;
    try {
      parsed = await parseSkillPackage({
        content: fetchResult.buffer,
        filename: fetchResult.filename,
        mimeType: "text/markdown"
      });
    } catch (err) {
      return fail(400, "BAD_REQUEST", `SKILL.md parse failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const ws = resolveScope(ctx);
    const existing = ctx.metadataStore.configResources.find({
      id: entry.id,
      workspace_id: ws.workspace_id,
      user_id: ws.user_id,
      kind: "skill"
    });

    let fileRef: ReturnType<ConfigApiContext["fileAssetService"]["createRef"]>["ref"];
    let record: ReturnType<ConfigApiContext["metadataStore"]["configResources"]["upsert"]>;
    try {
      const persisted = persistSkillPackage({
        ctx,
        entry,
        buffer: fetchResult.buffer,
        filename: fetchResult.filename,
        effectiveRef: fetchResult.effectiveRef,
        effectivePath: fetchResult.effectivePath,
        parsed,
        scope,
        ...(existing ? { expectedRevision: existing.revision } : {})
      });
      fileRef = persisted.fileRef;
      record = persisted.record;
    } catch (err) {
      return fail(500, "BAD_REQUEST", `Persistence failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const action: "install" | "sync" = pathname === SYNC_PATH ? "sync" : "install";
    const supabaseResult = await emitInstallAudit(deps, ws, {
      catalogId: entry.id,
      repo: entry.repo,
      ref: fetchResult.effectiveRef,
      skillPath: fetchResult.effectivePath,
      skillName: parsed.name,
      fileAssetRefId: fileRef.id,
      action
    });

    return ok({
      installedFrom: {
        repo: entry.repo,
        ref: fetchResult.effectiveRef,
        skillPath: fetchResult.effectivePath,
        url: fetchResult.url
      },
      fileAssetRefId: fileRef.id,
      resourceId: record.id,
      revision: record.revision,
      parsed: {
        name: parsed.name,
        description: parsed.description,
        version: parsed.version,
        tags: parsed.tags,
        allowedTools: parsed.allowedTools,
        deniedTools: parsed.deniedTools,
        bytes: fetchResult.buffer.length
      },
      supabase: {
        audit: supabaseResult.audit,
        fsf_message: supabaseResult.fsf
      },
      action
    });
  }

  if (pathname === UNINSTALL_PATH) {
    if (request.method !== "POST") return respond(405, createErrorResult("BAD_REQUEST", "Method not allowed."));
    const reqBody = (body ?? {}) as Record<string, unknown>;
    const id = typeof reqBody.id === "string" ? reqBody.id.trim() : undefined;
    if (!id) return fail(400, "BAD_REQUEST", "id required");
    const ws = resolveScope(ctx);
    const existing = ctx.metadataStore.configResources.find({
      id,
      workspace_id: ws.workspace_id,
      user_id: ws.user_id,
      kind: "skill"
    });
    if (!existing) return fail(404, "BAD_REQUEST", `Skill not installed: ${id}`);
    if (existing.builtin) return fail(403, "BAD_REQUEST", `Built-in skill is read-only: ${id}`);

    try {
      ctx.metadataStore.configResources.delete({
        id,
        workspace_id: ws.workspace_id,
        user_id: ws.user_id,
        kind: "skill"
      });
      if (typeof (existing.payload as { packageFileRefId?: string }).packageFileRefId === "string") {
        try {
          ctx.fileAssetService.deleteRef({
            id: (existing.payload as { packageFileRefId: string }).packageFileRefId,
            user_id: ws.user_id,
            workspace_id: ws.workspace_id
          });
        } catch {
          // best effort
        }
      }
    } catch (err) {
      return fail(500, "BAD_REQUEST", `Uninstall failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const supabaseResult = await emitInstallAudit(deps, ws, {
      catalogId: id,
      repo: String((existing.payload as { packageSource?: string }).packageSource ?? ""),
      ref: "n/a",
      skillPath: "n/a",
      skillName: existing.name,
      fileAssetRefId: "",
      action: "uninstall"
    });

    return ok({ uninstalled: id, supabase: supabaseResult });
  }

  return null;
}
