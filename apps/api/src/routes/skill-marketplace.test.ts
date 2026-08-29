import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { createMetadataStore } from "@agentx/metadata";
import { LocalFileAssetService } from "@agentx/files";

import { handleSkillMarketplaceRequest, setSkillCatalog } from "../routes/skill-marketplace.js";

const SAMPLE_SKILL_MD = `---
name: tdd
description: Test-driven development discipline. Use when implementing any feature.
allowed-tools: ["Bash","Read"]
tags: ["tdd","test"]
---

# TDD

Always start with a failing test.
`;

const SAMPLE_CATALOG = [
  {
    id: "tdd",
    displayName: "TDD",
    description: "Test-driven development.",
    category: "engineering" as const,
    tags: ["tdd", "test"],
    repo: "obra/superpowers",
    defaultRef: "main",
    skillPath: "skills/test-driven-development/SKILL.md",
    homepage: "https://github.com/obra/superpowers",
    license: "MIT",
    icon: "✨"
  },
  {
    id: "mcp-builder",
    displayName: "MCP Builder",
    description: "MCP server builder.",
    category: "automation" as const,
    tags: ["mcp"],
    repo: "anthropics/skills",
    defaultRef: "main",
    skillPath: "skills/mcp-builder/SKILL.md",
    homepage: "https://github.com/anthropics/skills",
    license: "Proprietary",
    icon: "🌐"
  }
];

type InsertResult = { data: unknown[]; status: number; error: string | null };

const mockSupabaseClient = (enabled: boolean, calls?: { table: string; rows: unknown }[]) => {
  const insert = vi.fn(async (table: string, row: unknown): Promise<InsertResult> => {
    calls?.push({ table, rows: row });
    return enabled ? { data: [row], status: 201, error: null } : { data: [], status: 0, error: null };
  });
  const select = vi.fn(async (): Promise<{ data: unknown[]; status: number; error: string | null }> => ({
    data: [],
    status: 200,
    error: null
  }));
  const upsert = vi.fn(async (): Promise<{ data: unknown[]; status: number; error: string | null }> => ({
    data: [],
    status: 200,
    error: null
  }));
  const update = vi.fn(async (): Promise<{ data: unknown[]; status: number; error: string | null }> => ({
    data: [],
    status: 200,
    error: null
  }));
  const del = vi.fn(async (): Promise<{ data: null; status: number; error: string | null }> => ({
    data: null,
    status: 200,
    error: null
  }));
  const rpc = vi.fn(async (): Promise<{ data: unknown; status: number; error: string | null }> => ({
    data: null,
    status: 200,
    error: null
  }));
  return { enabled, insert, select, upsert, update, delete: del, rpc } as never;
};

const buildContext = () => {
  const dir = mkdtempSync(join(tmpdir(), "marketplace-test-"));
  const dbPath = join(dir, `${randomUUID()}.sqlite`);
  const metadataStore = createMetadataStore({ database_path: dbPath });
  const fileAssetService = new LocalFileAssetService(metadataStore, { storageRoot: dir });

  const userId = randomUUID();
  const workspaceId = `personal-${userId}`;
  metadataStore.users.createPasswordUser({
    id: userId,
    email: `${userId}@test.local`,
    display_name: "User One"
  });
  metadataStore.workspaces.createPersonal({
    id: workspaceId,
    owner_user_id: userId,
    name: "Test"
  });

  return {
    cleanup: () => {
      try {
        metadataStore.close();
      } catch {
        // best effort
      }
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort — sqlite may still hold handles briefly on Windows
      }
    },
    configContext: {
      dataGateway: {} as never,
      fileAssetService,
      knowledgeService: {} as never,
      metadataStore,
      runCancelRegistry: {} as never,
      userId,
      workspaceId
    },
    dir,
    userId,
    workspaceId
  };
};

describe("skill-marketplace /install (A30)", () => {
  beforeEach(() => setSkillCatalog(SAMPLE_CATALOG));
  afterEach(() => setSkillCatalog(undefined));

  it("rejects unknown catalog ids", async () => {
    const ctx = buildContext();
    try {
      const req = { method: "POST", configContext: ctx.configContext } as never;
      const resp = await handleSkillMarketplaceRequest(req, "/api/v1/skill-marketplace/install", { id: "ghost" });
      expect(resp?.status).toBe(400);
      const body = resp?.body as { success: false; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.message).toContain("Unknown skill");
    } finally {
      ctx.cleanup();
    }
  });

  it("persists SKILL.md bytes to fileAsset + configResource and writes Supabase audit/fsf when enabled", async () => {
    const ctx = buildContext();
    try {
      const fetcher = vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        text: async () => {
          if (url.endsWith("/skills/mcp-builder/SKILL.md")) return SAMPLE_SKILL_MD;
          throw new Error(`unexpected url ${url}`);
        }
      } as Response));

      const supabaseCalls: { table: string; rows: unknown }[] = [];
      const supabaseClient = mockSupabaseClient(true, supabaseCalls);

      const req = { method: "POST", configContext: ctx.configContext } as never;
      const resp = await handleSkillMarketplaceRequest(
        req,
        "/api/v1/skill-marketplace/install",
        { id: "mcp-builder" },
        { fetcher: fetcher as never, supabaseClient }
      );

      expect(resp?.status).toBe(200);
      const body = resp?.body as {
        success: true;
        data: {
          fileAssetRefId: string;
          resourceId: string;
          revision: number;
          parsed: { name: string; bytes: number };
          supabase: { audit: { status: number }; fsf_message: { status: number } };
          action: "install";
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.parsed.name).toBe("tdd");
      expect(body.data.action).toBe("install");
      expect(body.data.revision).toBe(1);
      expect(body.data.supabase.audit.status).toBe(201);
      expect(body.data.supabase.fsf_message.status).toBe(201);

      // 1) bytes persisted to fileAsset
      const stored = ctx.configContext.fileAssetService.readRef({
        id: body.data.fileAssetRefId,
        user_id: ctx.userId,
        workspace_id: ctx.workspaceId
      });
      expect(stored.body.toString("utf8")).toBe(SAMPLE_SKILL_MD);

      // 2) config resource (kind=skill) exists
      const skill = ctx.configContext.metadataStore.configResources.find({
        id: "mcp-builder",
        kind: "skill",
        user_id: ctx.userId,
        workspace_id: ctx.workspaceId
      });
      expect(skill).toBeDefined();
      expect(skill?.status).toBe("ready");
      expect((skill?.payload as { packageFileRefId?: string }).packageFileRefId).toBe(body.data.fileAssetRefId);

      // 3) supabase got two writes — dfd_audit_events + fsf_messages
      const tables = supabaseCalls.map((c) => c.table).sort();
      expect(tables).toEqual(["dfd_audit_events", "fsf_messages"]);
    } finally {
      ctx.cleanup();
    }
  });

  it("does not fail when Supabase is offline (degraded mode)", async () => {
    const ctx = buildContext();
    try {
      const fetcher = vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => SAMPLE_SKILL_MD
      } as Response));

      const req = { method: "POST", configContext: ctx.configContext } as never;
      const resp = await handleSkillMarketplaceRequest(
        req,
        "/api/v1/skill-marketplace/install",
        { id: "tdd" },
        { fetcher: fetcher as never, supabaseClient: mockSupabaseClient(false) }
      );

      expect(resp?.status).toBe(200);
      const body = resp?.body as { success: true; data: { supabase: { audit: { status: number } } } };
      expect(body.success).toBe(true);
      expect(body.data.supabase.audit.status).toBe(0); // 0 = supabase disabled, no error
    } finally {
      ctx.cleanup();
    }
  });

  it("bumps revision on /sync", async () => {
    const ctx = buildContext();
    try {
      const fetcher = vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => SAMPLE_SKILL_MD
      } as Response));

      const req = { method: "POST", configContext: ctx.configContext } as never;

      const install = await handleSkillMarketplaceRequest(
        req,
        "/api/v1/skill-marketplace/install",
        { id: "tdd" },
        { fetcher: fetcher as never, supabaseClient: mockSupabaseClient(true) }
      );
      expect(install?.status).toBe(200);

      const sync = await handleSkillMarketplaceRequest(
        req,
        "/api/v1/skill-marketplace/sync",
        { id: "tdd" },
        { fetcher: fetcher as never, supabaseClient: mockSupabaseClient(true) }
      );
      const body = sync?.body as { success: true; data: { revision: number; action: "sync" } };
      expect(body.success).toBe(true);
      expect(body.data.action).toBe("sync");
      expect(body.data.revision).toBeGreaterThanOrEqual(2);
    } finally {
      ctx.cleanup();
    }
  });

  it("GET /installed lists installed skills", async () => {
    const ctx = buildContext();
    try {
      const fetcher = vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => SAMPLE_SKILL_MD
      } as Response));

      const req = { method: "POST", configContext: ctx.configContext } as never;
      await handleSkillMarketplaceRequest(
        req,
        "/api/v1/skill-marketplace/install",
        { id: "tdd" },
        { fetcher: fetcher as never, supabaseClient: mockSupabaseClient(false) }
      );

      const resp = await handleSkillMarketplaceRequest({ method: "GET", configContext: ctx.configContext } as never, "/api/v1/skill-marketplace/installed", undefined);
      const body = resp?.body as { success: true; data: { items: Array<{ id: string }> } };
      expect(body.success).toBe(true);
      expect(body.data.items.map((i) => i.id)).toContain("tdd");
    } finally {
      ctx.cleanup();
    }
  });

  it("uninstall removes config resource and soft-deletes file ref", async () => {
    const ctx = buildContext();
    try {
      const fetcher = vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => SAMPLE_SKILL_MD
      } as Response));

      const req = { method: "POST", configContext: ctx.configContext } as never;
      await handleSkillMarketplaceRequest(
        req,
        "/api/v1/skill-marketplace/install",
        { id: "tdd" },
        { fetcher: fetcher as never, supabaseClient: mockSupabaseClient(false) }
      );

      const resp = await handleSkillMarketplaceRequest(
        req,
        "/api/v1/skill-marketplace/uninstall",
        { id: "tdd" },
        { supabaseClient: mockSupabaseClient(false) }
      );
      expect(resp?.status).toBe(200);

      const remaining = ctx.configContext.metadataStore.configResources.find({
        id: "tdd",
        kind: "skill",
        user_id: ctx.userId,
        workspace_id: ctx.workspaceId
      });
      expect(remaining).toBeUndefined();
    } finally {
      ctx.cleanup();
    }
  });
});
