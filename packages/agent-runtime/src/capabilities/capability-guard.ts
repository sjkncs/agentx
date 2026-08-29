/**
 * Agent Capability Guard — evaluates capability tokens for tool access control.
 *
 * Inspired by the "capability tokens" layer in the reference architecture.
 *
 * Usage:
 *   const canPerform = capabilityGuard.evaluate({
 *     tool: "mcp_stripe.refund",
 *     userRole: "member",
 *     value: 250,
 *   });
 */
import type { WorkspaceRole } from "@agentx/metadata";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CapabilityId =
  | "data:export"
  | "data:write"
  | "datasource:connect"
  | "datasource:disconnect"
  | "workspace:member_invite"
  | "workspace:member_remove"
  | "workspace:config_write"
  | "mcp:stdio"
  | "mcp:http"
  | "mcp:high_value_action"   // Stripe refunds, data deletions, etc.
  | "notebook:cell_write"
  | "artifact:promote"
  | "skill:install"
  | "skill:uninstall";

export interface CapabilityPolicy {
  /** Capabilities that require admin/owner role regardless of token. */
  adminOnly: CapabilityId[];
  /** Capabilities that require explicit user opt-in. */
  userOptIn: CapabilityId[];
  /** Capabilities disabled entirely for this workspace. */
  disabled: CapabilityId[];
  /** Capabilities that require human approval before execution. */
  requiresApproval: CapabilityId[];
  /** Capabilities with a value threshold (e.g., refund > $100 requires approval). */
  valueThresholds?: Array<{ capability: CapabilityId; threshold: number; unit: string }>;
}

export interface CapabilityEvaluationResult {
  permitted: boolean;
  reason: string;
  requiresApproval: boolean;
  approvalReason?: string;
}

export interface CapabilityEvaluationInput {
  toolName: string;
  userRole: WorkspaceRole;
  policy: CapabilityPolicy;
  /** For value-threshold checks (e.g., refund amount). */
  value?: number;
}

// ---------------------------------------------------------------------------
// Tool → Capability mapping
// ---------------------------------------------------------------------------

const TOOL_CAPABILITY_MAP: Record<string, CapabilityId | CapabilityId[]> = {
  // MCP tools
  "mcp_": "mcp:stdio",           // prefix match
  "mcp_stripe_refund": "mcp:high_value_action",
  "mcp_stripe_charge": "mcp:high_value_action",
  "mcp_shopify_delete": "mcp:high_value_action",
  "mcp_shopify_refund": "mcp:high_value_action",
  // Datasource
  "datasource_connect": "datasource:connect",
  "datasource_disconnect": "datasource:disconnect",
  // Notebook
  "notebook_cell_write": "notebook:cell_write",
  "notebook_cell_delete": "notebook:cell_write",
  // Artifacts
  "artifact_promote": "artifact:promote",
  // Workspace
  "workspace_invite_member": "workspace:member_invite",
  "workspace_remove_member": "workspace:member_remove",
  "workspace_update_config": "workspace:config_write",
  // Skills
  "skill_install": "skill:install",
  "skill_uninstall": "skill:uninstall",
  // Data
  "data_export": "data:export",
  "data_write": "data:write",
};

const HIGH_IMPACT_MCP_PATTERNS = [
  "stripe_refund",
  "stripe_charge",
  "stripe_dispute",
  "shopify_delete",
  "shopify_refund",
  "salesforce_delete",
  "hubspot_delete",
  "gcp_delete",
  "aws_delete",
];

// ---------------------------------------------------------------------------
// CapabilityGuard
// ---------------------------------------------------------------------------

export class CapabilityGuard {
  constructor(private readonly _policy: CapabilityPolicy) {}

  evaluate(input: Omit<CapabilityEvaluationInput, "policy">): CapabilityEvaluationResult {
    const { toolName, userRole, value } = input;
    const policy = this._policy;

    // 1. Check if capability is explicitly disabled
    const capability = this.resolveCapability(toolName);
    if (!capability) {
      return { permitted: true, reason: "UNMAPPED_TOOL", requiresApproval: false };
    }
    const capabilities = Array.isArray(capability) ? capability : [capability];

    for (const cap of capabilities) {
      if (policy.disabled.includes(cap)) {
        return {
          permitted: false,
          reason: `CAPABILITY_DISABLED:${cap}`,
          requiresApproval: false,
        };
      }

      // 2. Admin-only check
      if (policy.adminOnly.includes(cap) && userRole !== "admin" && userRole !== "owner") {
        return {
          permitted: false,
          reason: `ADMIN_ONLY:${cap}`,
          requiresApproval: false,
        };
      }

      // 3. Value threshold check (e.g., refunds > $100)
      const thresholdRule = policy.valueThresholds?.find((r) => r.capability === cap);
      if (thresholdRule && value !== undefined && value > thresholdRule.threshold) {
        return {
          permitted: false,
          reason: `VALUE_THRESHOLD:${cap}:${value}:${thresholdRule.threshold}`,
          requiresApproval: true,
          approvalReason: `${cap} exceeds threshold (${value} ${thresholdRule.unit} > ${thresholdRule.threshold} ${thresholdRule.unit})`,
        };
      }

      // 4. Requires approval check
      if (policy.requiresApproval.includes(cap)) {
        return {
          permitted: true,
          reason: `APPROVAL_REQUIRED:${cap}`,
          requiresApproval: true,
          approvalReason: `Action requires explicit approval: ${cap}`,
        };
      }
    }

    return {
      permitted: true,
      reason: `OK:${capabilities.join(",")}`,
      requiresApproval: false,
    };
  }

  /**
   * Get all capability IDs that require human approval for a given tool.
   */
  getRequiredApprovals(toolName: string, policy: CapabilityPolicy): CapabilityId[] {
    const capability = this.resolveCapability(toolName);
    if (!capability) return [];
    const capabilities = Array.isArray(capability) ? capability : [capability];
    return capabilities.filter((cap) => policy.requiresApproval.includes(cap));
  }

  /**
   * Check if a tool is considered high-impact.
   */
  isHighImpact(toolName: string): boolean {
    for (const pattern of HIGH_IMPACT_MCP_PATTERNS) {
      if (toolName.toLowerCase().includes(pattern)) return true;
    }
    return false;
  }

  /**
   * Default capability policy for a new workspace.
   */
  static defaultPolicy(): CapabilityPolicy {
    return {
      adminOnly: [
        "workspace:member_invite",
        "workspace:member_remove",
        "workspace:config_write",
        "skill:install",
        "skill:uninstall",
      ],
      userOptIn: ["mcp:stdio", "mcp:http"],
      disabled: [],
      requiresApproval: [
        "mcp:high_value_action",
        "data:export",
        "data:write",
        "notebook:cell_write",
        "artifact:promote",
      ],
      valueThresholds: [
        { capability: "mcp:high_value_action", threshold: 100, unit: "USD" },
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private resolveCapability(toolName: string): CapabilityId | CapabilityId[] | undefined {
    // Exact match
    if (toolName in TOOL_CAPABILITY_MAP) {
      return TOOL_CAPABILITY_MAP[toolName] as CapabilityId | CapabilityId[];
    }
    // Prefix match (e.g., "mcp_" → "mcp:stdio")
    for (const [prefix, cap] of Object.entries(TOOL_CAPABILITY_MAP)) {
      if (prefix.endsWith("_") && toolName.startsWith(prefix.slice(0, -1))) {
        return cap as CapabilityId | CapabilityId[];
      }
      if (toolName.startsWith(prefix)) {
        return cap as CapabilityId | CapabilityId[];
      }
    }
    return undefined;
  }
}
