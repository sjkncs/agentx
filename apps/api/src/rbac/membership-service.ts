import { createHash, randomBytes } from "node:crypto";
import type {
  MetadataStore,
  WorkspaceMembershipRecord,
  WorkspaceRole,
  WorkspaceRecord,
} from "@datafoundry/metadata";
import { RbacError, hasAtLeast } from "./roles.js";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const findWorkspace = (
  metadataStore: MetadataStore,
  workspace_id: string,
): WorkspaceRecord | null => {
  const row = metadataStore.db
    .prepare("SELECT * FROM workspaces WHERE id = ?")
    .get(workspace_id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    kind: row.kind as WorkspaceRecord["kind"],
    owner_user_id: String(row.owner_user_id),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
};

export class WorkspaceMembershipService {
  constructor(private readonly metadataStore: MetadataStore) {}

  /**
   * Resolve a user's role in a workspace, creating an owner membership if
   * the workspace has no other members and the user is the workspace owner.
   */
  ensureMembership(input: {
    workspace_id: string;
    user_id: string;
  }): WorkspaceMembershipRecord {
    const existing = this.metadataStore.workspaceMemberships.tryGet(input);
    if (existing) return existing;
    const workspace = findWorkspace(this.metadataStore, input.workspace_id);
    if (workspace && workspace.owner_user_id === input.user_id) {
      return this.metadataStore.workspaceMemberships.upsertOwner(input);
    }
    throw new RbacError(
      "NOT_A_MEMBER",
      `User ${input.user_id} is not a member of workspace ${input.workspace_id}.`,
    );
  }

  listMembers(input: { workspace_id: string }): WorkspaceMembershipRecord[] {
    return this.metadataStore.workspaceMemberships.listByWorkspace(input);
  }

  /**
   * Update an existing member's role. Only owners can promote to admin or
   * demote other admins; admins can change member/viewer roles.
   */
  changeRole(input: {
    workspace_id: string;
    user_id: string;
    new_role: WorkspaceRole;
    actor_role: WorkspaceRole;
  }): WorkspaceMembershipRecord {
    if (input.new_role === "owner") {
      throw new RbacError(
        "INVALID_ROLE",
        "Cannot assign owner role directly; ownership transfer is a separate flow.",
      );
    }
    if (input.new_role === "admin" && input.actor_role !== "owner") {
      throw new RbacError(
        "FORBIDDEN",
        "Only owners can promote members to admin.",
      );
    }
    if (input.actor_role === "viewer" || input.actor_role === "member") {
      throw new RbacError(
        "FORBIDDEN",
        "You do not have permission to change member roles.",
      );
    }
    return this.metadataStore.workspaceMemberships.setRole({
      workspace_id: input.workspace_id,
      user_id: input.user_id,
      role: input.new_role,
    });
  }

  removeMember(input: {
    workspace_id: string;
    user_id: string;
    actor_user_id: string;
    actor_role: WorkspaceRole;
  }): boolean {
    if (input.user_id === input.actor_user_id) {
      throw new RbacError(
        "FORBIDDEN",
        "Cannot remove yourself from a workspace. Transfer ownership first.",
      );
    }
    if (input.actor_role !== "owner" && input.actor_role !== "admin") {
      throw new RbacError(
        "FORBIDDEN",
        "Only owners and admins can remove members.",
      );
    }
    return this.metadataStore.workspaceMemberships.remove({
      workspace_id: input.workspace_id,
      user_id: input.user_id,
    });
  }

  createInvitation(input: {
    workspace_id: string;
    email: string;
    role: WorkspaceRole;
    invited_by_user_id: string;
    actor_role: WorkspaceRole;
  }): { id: string; token: string; expires_at: string } {
    if (!hasAtLeast(input.actor_role, "admin")) {
      throw new RbacError(
        "FORBIDDEN",
        "Only admins and owners can invite new members.",
      );
    }
    if (input.role === "owner") {
      throw new RbacError("INVALID_ROLE", "Cannot invite as owner.");
    }
    const token = randomBytes(32).toString("base64url");
    const token_hash = createHash("sha256").update(token).digest("base64url");
    const expires_at = new Date(Date.now() + INVITATION_TTL_MS).toISOString();
    const record = this.metadataStore.workspaceInvitations.create({
      id: randomBytes(16).toString("hex"),
      workspace_id: input.workspace_id,
      email: input.email,
      role: input.role,
      token_hash,
      invited_by_user_id: input.invited_by_user_id,
      expires_at,
    });
    return { id: record.id, token, expires_at };
  }

  acceptInvitation(input: {
    token: string;
    accept_user_id: string;
  }): WorkspaceMembershipRecord {
    const token_hash = createHash("sha256").update(input.token).digest("base64url");
    const invitation = this.metadataStore.workspaceInvitations.findByTokenHash({
      token_hash,
    });
    if (!invitation) {
      throw new RbacError("INVITATION_NOT_FOUND", "Invitation not found or already used.");
    }
    if (new Date(invitation.expires_at).getTime() < Date.now()) {
      throw new RbacError("INVITATION_EXPIRED", "Invitation has expired.");
    }
    if (invitation.accepted_at) {
      throw new RbacError("INVITATION_ALREADY_ACCEPTED", "Invitation was already accepted.");
    }
    const membership = this.metadataStore.workspaceMemberships.setRole({
      workspace_id: invitation.workspace_id,
      user_id: input.accept_user_id,
      role: invitation.role,
    });
    this.metadataStore.workspaceInvitations.markAccepted({ id: invitation.id });
    return membership;
  }

  revokeInvitation(input: {
    invitation_id: string;
    actor_role: WorkspaceRole;
  }): void {
    if (!hasAtLeast(input.actor_role, "admin")) {
      throw new RbacError("FORBIDDEN", "Only admins and owners can revoke invitations.");
    }
    this.metadataStore.workspaceInvitations.revoke({ id: input.invitation_id });
  }

  listInvitations(input: { workspace_id: string }): Array<{
    id: string;
    email: string;
    role: WorkspaceRole;
    invited_by_user_id: string;
    expires_at: string;
    accepted_at: string | null;
    revoked_at: string | null;
    created_at: string;
  }> {
    return this.metadataStore.workspaceInvitations
      .listByWorkspace(input)
      .map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        invited_by_user_id: i.invited_by_user_id,
        expires_at: i.expires_at,
        accepted_at: i.accepted_at ?? null,
        revoked_at: i.revoked_at ?? null,
        created_at: i.created_at,
      }));
  }
}
