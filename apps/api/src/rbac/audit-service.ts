import { randomUUID } from "node:crypto";
import type {
  AuditEventCategory,
  AuditEventRecord,
  AuditEventSeverity,
  MetadataStore,
  WorkspaceRole,
} from "@datafoundry/metadata";

export type AuditContext = {
  workspace_id?: string | null;
  actor_user_id?: string | null;
  actor_email?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
};

export class AuditService {
  constructor(private readonly metadataStore: MetadataStore) {}

  /**
   * Append an audit event. Best-effort: never throws — failures are logged
   * but never block the originating request.
   */
  record(input: {
    context: AuditContext;
    category: AuditEventCategory;
    action: string;
    severity?: AuditEventSeverity;
    target_type?: string;
    target_id?: string;
    metadata?: unknown;
  }): AuditEventRecord | null {
    try {
      return this.metadataStore.auditEvents.append({
        id: randomUUID(),
        workspace_id: input.context.workspace_id ?? null,
        actor_user_id: input.context.actor_user_id ?? null,
        actor_email: input.context.actor_email ?? null,
        category: input.category,
        action: input.action,
        severity: input.severity ?? "info",
        target_type: input.target_type ?? null,
        target_id: input.target_id ?? null,
        ip_address: input.context.ip_address ?? null,
        user_agent: input.context.user_agent ?? null,
        metadata: input.metadata,
      });
    } catch (error) {
      // Audit is best-effort; never block the request.
      console.warn("[audit] failed to record event", input.category, input.action, error);
      return null;
    }
  }
}

export const SYSTEM_USER_EMAIL = "system@datafoundry.internal";

export const SYSTEM_ACTOR: AuditContext = {
  actor_user_id: null,
  actor_email: SYSTEM_USER_EMAIL,
};
