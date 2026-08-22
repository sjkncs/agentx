import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import {
  createErrorResult,
  createSuccessResult,
  type ApiResult,
} from "@datafoundry/contracts";
import type { AuditEventCategory, AuditEventRecord, MetadataStore, WorkspaceRole } from "@datafoundry/metadata";
import type { AuthService } from "../auth/service.js";
import {
  listPendingApprovals,
  listApprovals,
  getApproval,
  resolveApproval,
  approvalStats,
  type HumanApprovalRecord,
} from "../human-approval-queue.js";
import {
  evalSnapshot,
  promEvalMetrics,
  type EvalSnapshot,
} from "../agent-eval.js";
import { AuditService } from "./audit-service.js";
import { RbacError, hasAtLeast, requirePermission } from "./roles.js";
import { WorkspaceMembershipService } from "./membership-service.js";

export type AdminApiContext = {
  authService: AuthService;
  metadataStore: MetadataStore;
  response: ServerResponse;
};

export type AdminApiResponse =
  | { status: number; body: ApiResult<unknown> }
  | undefined;

const parseJsonBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
};

const ipFromRequest = (request: IncomingMessage): string | null => {
  const fwd = request.headers["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0]?.trim() ?? null;
  return request.socket.remoteAddress ?? null;
};

const userAgentFromRequest = (request: IncomingMessage): string | null => {
  const ua = request.headers["user-agent"];
  return typeof ua === "string" ? ua : null;
};

type SessionLike = {
  id: string;
  user_id: string;
  expires_at: string;
};

const requireAuthIdentity = async (
  request: IncomingMessage,
  context: AdminApiContext,
): Promise<{
  user_id: string;
  email: string;
  workspace_id: string;
  role: WorkspaceRole;
  display_name?: string;
}> => {
  const cookiesHeader = request.headers["cookie"];
  const cookieValue = Array.isArray(cookiesHeader)
    ? cookiesHeader.join("; ")
    : (typeof cookiesHeader === "string" ? cookiesHeader : "");
  const match = /(?:^|;\s*)df_session=([^;]+)/.exec(cookieValue);
  if (!match) {
    throw new RbacError("UNAUTHORIZED", "Missing session cookie.");
  }
  const sessionToken = decodeURIComponent(match[1] ?? "");
  const identity = context.authService.authenticateSession(sessionToken);
  const workspaceId = identity.workspace.id;
  let membership = context.metadataStore.workspaceMemberships.tryGet({
    workspace_id: workspaceId,
    user_id: identity.user.id,
  });
  if (!membership && identity.workspace.owner_user_id === identity.user.id) {
    membership = context.metadataStore.workspaceMemberships.upsertOwner({
      workspace_id: workspaceId,
      user_id: identity.user.id,
    });
  }
  if (!membership) {
    throw new RbacError("NOT_A_MEMBER", "Not a member of this workspace.");
  }
  return {
    user_id: identity.user.id,
    email: identity.user.email ?? "unknown@unknown",
    workspace_id: workspaceId,
    role: membership.role,
    ...(identity.user.display_name ? { display_name: identity.user.display_name } : {}),
  };
};

const sendJson = <T>(
  status: number,
  body: ApiResult<T>,
): { status: number; body: ApiResult<unknown> } => ({
  status,
  body: body as ApiResult<unknown>,
});

const ok = <T>(data: T): ApiResult<T> => createSuccessResult(data);
const fail = (code: string, message: string) =>
  createErrorResult(code as Parameters<typeof createErrorResult>[0], message);

const ROLE_VALUES = ["owner", "admin", "member", "viewer"] as const;

export async function handleAdminApiRequest(
  request: IncomingMessage,
  pathname: string,
  context: AdminApiContext,
): Promise<AdminApiResponse> {
  if (!pathname.startsWith("/api/v1/admin/")) return undefined;
  const res = context.response;
  const url = new URL(pathname, "http://x");
  const segments = pathname.slice("/api/v1/admin/".length).split("/").filter(Boolean);
  const root = segments[0];
  const rest = segments.slice(1);

  const membershipService = new WorkspaceMembershipService(context.metadataStore);
  const auditService = new AuditService(context.metadataStore);

  let actor: Awaited<ReturnType<typeof requireAuthIdentity>>;
  try {
    actor = await requireAuthIdentity(request, context);
  } catch (err) {
    if (err instanceof RbacError) {
      return sendJson(401, fail("UNAUTHORIZED", err.message));
    }
    throw err;
  }

  const auditCtx = {
    workspace_id: actor.workspace_id,
    actor_user_id: actor.user_id,
    actor_email: actor.email,
    ip_address: ipFromRequest(request),
    user_agent: userAgentFromRequest(request),
  };

  try {
    /* ----------------------------------------------------------------
     * Members
     * --------------------------------------------------------------- */
    if (root === "members" && request.method === "GET" && rest.length === 0) {
      requirePermission(actor.role, "members.invite");
      const records = membershipService.listMembers({ workspace_id: actor.workspace_id });
      const items = records.map((m) => {
        const user = context.metadataStore.users.getById({ user_id: m.user_id });
        return {
          user_id: m.user_id,
          email: user.email ?? null,
          display_name: user.display_name ?? null,
          role: m.role,
          created_at: m.created_at,
          is_self: m.user_id === actor.user_id,
          disabled: !!user.disabled_at,
        };
      });
      auditService.record({
        context: auditCtx,
        category: "member",
        action: "list",
        metadata: { count: items.length },
      });
      return sendJson(200, ok({ items, current_role: actor.role }));
    }

    if (root === "members" && request.method === "PATCH" && rest.length === 1) {
      const targetUserId = rest[0];
      if (!targetUserId) return sendJson(400, fail("VALIDATION", "user_id required."));
      const body = await parseJsonBody(request);
      const nextRole = body.role;
      if (typeof nextRole !== "string" || !ROLE_VALUES.includes(nextRole as WorkspaceRole)) {
        return sendJson(400, fail("VALIDATION", "role must be owner|admin|member|viewer"));
      }
      const updated = membershipService.changeRole({
        workspace_id: actor.workspace_id,
        user_id: targetUserId,
        new_role: nextRole as WorkspaceRole,
        actor_role: actor.role,
      });
      auditService.record({
        context: auditCtx,
        category: "member",
        action: "role_change",
        target_type: "user",
        target_id: targetUserId,
        metadata: { new_role: updated.role },
      });
      return sendJson(200, ok({ user_id: targetUserId, role: updated.role }));
    }

    if (root === "members" && request.method === "DELETE" && rest.length === 1) {
      const targetUserId = rest[0];
      if (!targetUserId) return sendJson(400, fail("VALIDATION", "user_id required."));
      membershipService.removeMember({
        workspace_id: actor.workspace_id,
        user_id: targetUserId,
        actor_user_id: actor.user_id,
        actor_role: actor.role,
      });
      auditService.record({
        context: auditCtx,
        category: "member",
        action: "remove",
        target_type: "user",
        target_id: targetUserId,
        severity: "warning",
      });
      return sendJson(200, ok({ removed: true }));
    }

    /* ----------------------------------------------------------------
     * Invitations
     * --------------------------------------------------------------- */
    if (root === "invitations" && request.method === "GET") {
      const items = membershipService.listInvitations({ workspace_id: actor.workspace_id });
      return sendJson(200, ok({ items }));
    }

    if (root === "invitations" && request.method === "POST" && rest.length === 0) {
      const body = await parseJsonBody(request);
      const email = typeof body.email === "string" ? body.email : "";
      const role = body.role;
      if (!email) return sendJson(400, fail("VALIDATION", "email required"));
      if (typeof role !== "string" || !ROLE_VALUES.includes(role as WorkspaceRole)) {
        return sendJson(400, fail("VALIDATION", "role invalid"));
      }
      const invitation = membershipService.createInvitation({
        workspace_id: actor.workspace_id,
        email,
        role: role as WorkspaceRole,
        invited_by_user_id: actor.user_id,
        actor_role: actor.role,
      });
      auditService.record({
        context: auditCtx,
        category: "member",
        action: "invite",
        metadata: { email, role },
      });
      return sendJson(200, ok(invitation));
    }

    if (root === "invitations" && request.method === "DELETE" && rest.length === 1) {
      const id = rest[0];
      if (!id) return sendJson(400, fail("VALIDATION", "id required"));
      membershipService.revokeInvitation({
        invitation_id: id,
        actor_role: actor.role,
      });
      auditService.record({
        context: auditCtx,
        category: "member",
        action: "revoke_invitation",
        target_id: id,
        severity: "warning",
      });
      return sendJson(200, ok({ revoked: true }));
    }

    if (root === "invitations" && request.method === "POST" && rest[0] === "accept") {
      const body = await parseJsonBody(request);
      const token = typeof body.token === "string" ? body.token : "";
      if (!token) return sendJson(400, fail("VALIDATION", "token required"));
      try {
        const membership = membershipService.acceptInvitation({
          token,
          accept_user_id: actor.user_id,
        });
        auditService.record({
          context: {
            ...auditCtx,
            workspace_id: membership.workspace_id,
          },
          category: "member",
          action: "accept_invitation",
          severity: "info",
        });
        return sendJson(200, ok({ workspace_id: membership.workspace_id, role: membership.role }));
      } catch (err) {
        if (err instanceof RbacError) {
          return sendJson(400, fail(err.code, err.message));
        }
        throw err;
      }
    }

    /* ----------------------------------------------------------------
     * Users (admin-facing listing)
     * --------------------------------------------------------------- */
    if (root === "users" && request.method === "GET" && rest.length === 0) {
      requirePermission(actor.role, "users.read");
      const all = context.metadataStore.users.list();
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "100"), 1), 500);
      const cursor = url.searchParams.get("cursor");
      const items = applyCursor(all, cursor).slice(0, limit).map((u) => ({
        id: u.id,
        email: u.email ?? null,
        display_name: u.display_name ?? null,
        email_verified_at: u.email_verified_at ?? null,
        disabled_at: u.disabled_at ?? null,
        created_at: u.created_at,
      }));
      auditService.record({
        context: auditCtx,
        category: "settings",
        action: "list_users",
        metadata: { count: items.length },
      });
      return sendJson(200, ok({ items }));
    }

    if (root === "users" && request.method === "PATCH" && rest.length === 1) {
      const targetId = rest[0];
      if (!targetId) return sendJson(400, fail("VALIDATION", "user_id required"));
      const body = await parseJsonBody(request);
      const updates: { display_name?: string; disabled_at?: string | null } = {};
      if (typeof body.display_name === "string") updates.display_name = body.display_name;
      if (typeof body.disabled === "boolean") {
        updates.disabled_at = body.disabled ? new Date().toISOString() : null;
        requirePermission(actor.role, "users.disable");
      }
      const updated = context.metadataStore.users.update({ user_id: targetId, ...updates });
      auditService.record({
        context: auditCtx,
        category: "settings",
        action: "update_user",
        target_type: "user",
        target_id: targetId,
        metadata: { changes: Object.keys(updates) },
        severity: "warning",
      });
      return sendJson(200, ok({ user_id: updated.id, display_name: updated.display_name, disabled_at: updated.disabled_at }));
    }

    /* ----------------------------------------------------------------
     * Audit
     * --------------------------------------------------------------- */
    if (root === "audit" && request.method === "GET" && rest.length === 0) {
      requirePermission(actor.role, "audit.read");
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50"), 1), 200);
      const cursor = url.searchParams.get("cursor");
      const categoryParam = url.searchParams.get("category");
      const severityParam = url.searchParams.get("severity");
      const categoryFilter = (AUDIT_CATEGORIES as readonly string[]).includes(categoryParam ?? "")
        ? (categoryParam as AuditEventCategory)
        : undefined;
      const severityFilter = (AUDIT_SEVERITIES as readonly string[]).includes(severityParam ?? "")
        ? (severityParam as "info" | "warning" | "critical")
        : undefined;
      const result = context.metadataStore.auditEvents.list({
        workspace_id: actor.workspace_id,
        limit,
        ...(cursor ? { cursor } : {}),
        ...(categoryFilter ? { category: categoryFilter } : {}),
        ...(severityFilter ? { severity: severityFilter } : {}),
      });
      const counts = context.metadataStore.auditEvents.countBySeverity({
        workspace_id: actor.workspace_id,
        since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const items = result.items.map(serializeAuditEvent);
      auditService.record({
        context: auditCtx,
        category: "settings",
        action: "view_audit_log",
        metadata: { count: items.length, filters: { categoryFilter, severityFilter } },
      });
      return sendJson(200, ok({ items, next_cursor: result.nextCursor, severity_counts_7d: counts }));
    }

    if (root === "audit" && request.method === "GET" && rest[0] === "export") {
      requirePermission(actor.role, "audit.export");
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "1000"), 1), 5000);
      const result = context.metadataStore.auditEvents.list({
        workspace_id: actor.workspace_id,
        limit,
      });
      const lines = ["id,created_at,category,action,severity,actor_email,target_type,target_id"];
      for (const e of result.items) {
        lines.push([
          e.id,
          e.created_at,
          e.category,
          e.action,
          e.severity,
          e.actor_email ?? "",
          e.target_type ?? "",
          e.target_id ?? "",
        ].map(csvEscape).join(","));
      }
      auditService.record({
        context: auditCtx,
        category: "export",
        action: "audit_csv_export",
        severity: "warning",
        metadata: { count: result.items.length },
      });
      const csv = lines.join("\n");
      return {
        status: 200,
        body: ok({
          filename: `audit-${actor.workspace_id}-${Date.now()}.csv`,
          mime_type: "text/csv",
          content_base64: Buffer.from(csv, "utf8").toString("base64"),
          row_count: result.items.length,
        }),
      };
    }

    /* ----------------------------------------------------------------
     * Human Approvals
     * --------------------------------------------------------------- */
    if (root === "approvals" && request.method === "GET" && rest.length === 0) {
      requirePermission(actor.role, "audit.read");
      const statusParam = url.searchParams.get("status");
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50"), 1), 200);
      const status: "pending" | "approved" | "rejected" | "revised" | undefined =
        statusParam === "pending"
          ? "pending"
          : statusParam === "approved"
            ? "approved"
            : statusParam === "rejected"
              ? "rejected"
              : statusParam === "revised"
                ? "revised"
                : undefined;
      const approvals = listApprovals({ ...(status !== undefined ? { status } : {}), limit });
      const stats = approvalStats();
      return sendJson(200, ok({ approvals, stats }));
    }

    if (root === "approvals" && request.method === "GET" && rest.length === 1) {
      requirePermission(actor.role, "audit.read");
      const id = rest[0]!;
      const approval = getApproval(id);
      if (!approval) return sendJson(404, fail("NOT_FOUND", "Approval not found."));
      return sendJson(200, ok(approval));
    }

    if (root === "approvals" && request.method === "POST" && rest.length === 2 && rest[1] === "resolve") {
      requirePermission(actor.role, "audit.read");
      const id = rest[0]!;
      const body = await parseJsonBody(request);
      const selected_option = typeof body.selected_option === "string" ? body.selected_option : "";
      const status = body.status === "approved" || body.status === "rejected" || body.status === "revised"
        ? body.status
        : "approved";
      if (!selected_option) return sendJson(400, fail("VALIDATION", "selected_option required."));
      const resolved = resolveApproval({ id, selected_option, status, resolved_by: actor.email });
      if (!resolved) return sendJson(404, fail("NOT_FOUND", "Approval not found or already resolved."));
      auditService.record({
        context: auditCtx,
        category: "run",
        action: "approval_resolved",
        target_type: "approval",
        target_id: id,
        severity: status === "rejected" ? "warning" : "info",
        metadata: { selected_option, status },
      });
      return sendJson(200, ok(resolved));
    }

    /* ----------------------------------------------------------------
     * Agent Evaluation
     * --------------------------------------------------------------- */
    if (root === "eval" && request.method === "GET" && rest.length === 0) {
      requirePermission(actor.role, "audit.read");
      const snapshot = evalSnapshot();
      return sendJson(200, ok(snapshot));
    }

    if (root === "eval" && request.method === "GET" && rest.length === 1 && rest[0] === "prometheus") {
      requirePermission(actor.role, "audit.read");
      const promText = promEvalMetrics();
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.writeHead(200);
      res.end(promText);
      return;
    }

    return sendJson(404, fail("RESOURCE_NOT_FOUND", `Unknown admin route: /admin/${root}/${rest.join("/")}`));
  } catch (err) {
    if (err instanceof RbacError) {
      return sendJson(
        err.code === "UNAUTHORIZED" ? 401 : err.code === "FORBIDDEN" ? 403 : 400,
        fail(err.code, err.message),
      );
    }
    throw err;
  }
}

const AUDIT_CATEGORIES = [
  "auth",
  "workspace",
  "member",
  "datasource",
  "model",
  "skill",
  "mcp",
  "knowledge",
  "session",
  "run",
  "artifact",
  "export",
  "settings",
] as const satisfies readonly AuditEventCategory[];

const AUDIT_SEVERITIES = ["info", "warning", "critical"] as const;

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function applyCursor<T extends { created_at: string }>(
  items: T[],
  cursor: string | null,
): T[] {
  if (!cursor) return items;
  const cursorTime = cursor;
  return items.filter((i) => i.created_at < cursorTime);
}

function serializeAuditEvent(e: AuditEventRecord) {
  let metadata: unknown = null;
  if (e.metadata_json) {
    try {
      metadata = JSON.parse(e.metadata_json);
    } catch {
      metadata = null;
    }
  }
  return {
    id: e.id,
    category: e.category,
    action: e.action,
    severity: e.severity,
    actor_user_id: e.actor_user_id,
    actor_email: e.actor_email,
    target_type: e.target_type,
    target_id: e.target_id,
    ip_address: e.ip_address,
    metadata,
    created_at: e.created_at,
  };
}

/** Whether the actor has enough privilege to read admin endpoints at all. */
export function isAdminActor(role: WorkspaceRole | null | undefined): boolean {
  return hasAtLeast(role, "admin");
}

export { randomUUID };
