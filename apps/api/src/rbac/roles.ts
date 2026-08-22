import type { WorkspaceRole } from "@datafoundry/metadata";

/** Minimum role required to perform an action. Higher = more privileged. */
export const ROLE_PRIORITY: Record<WorkspaceRole, number> = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

export function hasAtLeast(
  actual: WorkspaceRole | null | undefined,
  required: WorkspaceRole,
): boolean {
  if (!actual) return false;
  return ROLE_PRIORITY[actual] >= ROLE_PRIORITY[required];
}

/** Permission names → minimum role required. */
export const ROLE_REQUIREMENTS: Record<string, WorkspaceRole> = {
  // Settings / RBAC
  "settings.read": "viewer",
  "settings.write": "admin",
  "members.invite": "admin",
  "members.role_change": "owner",
  "members.remove": "admin",
  "audit.read": "admin",
  "audit.export": "owner",
  "users.read": "admin",
  "users.disable": "owner",
  // Data
  "datasource.read": "viewer",
  "datasource.write": "member",
  "datasource.test": "member",
  "knowledge.read": "viewer",
  "knowledge.write": "member",
  // Resources
  "model.write": "admin",
  "skill.write": "admin",
  "mcp.write": "admin",
  // Runs
  "run.start": "member",
  "run.cancel": "member",
  "session.read": "viewer",
  "session.create": "member",
  "session.delete": "member",
  // Artifacts / data export
  "artifact.read": "viewer",
  "artifact.export": "member",
  "artifact.share": "member",
  // Datalink
  "datalink.read": "viewer",
  "datalink.write": "member",
};

export class RbacError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly requiredRole?: WorkspaceRole,
  ) {
    super(message);
    this.name = "RbacError";
  }
}

export function requirePermission(
  role: WorkspaceRole | null | undefined,
  permission: keyof typeof ROLE_REQUIREMENTS,
): void {
  const required = ROLE_REQUIREMENTS[permission];
  if (!required || !hasAtLeast(role, required)) {
    throw new RbacError(
      "FORBIDDEN",
      `Action requires ${required ?? "a higher"} role; current role is ${role ?? "none"}.`,
      required ?? "admin",
    );
  }
}
