/**
 * Human Approval Queue — server-side persistence and REST API surface.
 *
 * Wires into the existing InteractionRuntimeAdapter pipeline so that every
 * HITL interrupt (ask_user / submit_plan) is also registered in this queue.
 * Admin UI can then list/resolve approvals from /admin/approvals.
 *
 * The matching Supabase persistence in dfd_approvals is handled by
 * the hitl-approval sink in run-persistence-sinks.ts (subscribes to
 * `interaction.requested` / `interaction.resolved` events). Operator-driven
 * resolutions (which bypass the agent run) call writeApprovalResolution
 * here to mirror the change to dfd_approvals so both stores stay in sync.
 */
import { randomUUID } from "node:crypto";
import { supabase } from "@agentx/supabase-bridge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HumanApprovalRecord {
  id: string;
  run_id: string;
  session_id: string;
  user_id: string;
  user_email: string;
  tool_name: "submit_plan" | "ask_user";
  prompt: string;
  options: string[];
  selected_option: string | null;
  status: "pending" | "approved" | "rejected" | "revised";
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
  metadata: Record<string, unknown>;
}

export interface ApprovalStats {
  pending: number;
  approved_today: number;
  rejected_today: number;
  avg_resolution_time_ms: number;
}

// ---------------------------------------------------------------------------
// In-memory store (persisted to Supabase once key is available)
// ---------------------------------------------------------------------------

const _store = new Map<string, HumanApprovalRecord>();
const MAX_RECORDS = 500;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a new pending approval from an InteractionRuntimeAdapter interrupt.
 */
export function enqueueFromInterrupt(params: {
  run_id: string;
  session_id: string;
  user_id: string;
  user_email: string;
  tool_name: "ask_user" | "submit_plan";
  suspendPayload?: unknown;
}): HumanApprovalRecord {
  const payload = params.suspendPayload as Record<string, unknown> | undefined;
  const prompt =
    typeof payload?.question === "string"
      ? payload.question
      : typeof payload?.message === "string"
        ? payload.message
        : `Agent requested ${params.tool_name} — review required.`;
  const options = Array.isArray(payload?.options)
    ? (payload.options as string[]).filter((o): o is string => typeof o === "string")
    : params.tool_name === "submit_plan"
      ? ["approved", "rejected", "revised"]
      : ["yes", "no"];
  return enqueueApproval({
    run_id: params.run_id,
    session_id: params.session_id,
    user_id: params.user_id,
    user_email: params.user_email,
    tool_name: params.tool_name,
    prompt,
    options,
  });
}

/**
 * Register a new pending approval.
 * Called by InteractionRuntimeAdapter.capture() every time an HITL interrupt fires.
 */
export function enqueueApproval(params: {
  run_id: string;
  session_id: string;
  user_id: string;
  user_email: string;
  tool_name: "submit_plan" | "ask_user";
  prompt: string;
  options: string[];
  metadata?: Record<string, unknown>;
}): HumanApprovalRecord {
  // Idempotent: don't create duplicates for the same run
  const existing = [..._store.values()].find(
    (r) => r.run_id === params.run_id && r.status === "pending",
  );
  if (existing) return existing;

  const record: HumanApprovalRecord = {
    id: randomUUID(),
    run_id: params.run_id,
    session_id: params.session_id,
    user_id: params.user_id,
    user_email: params.user_email,
    tool_name: params.tool_name,
    prompt: params.prompt,
    options: params.options,
    selected_option: null,
    status: "pending",
    created_at: Date.now(),
    resolved_at: null,
    resolved_by: null,
    metadata: params.metadata ?? {},
  };

  _store.set(record.id, record);
  _evict();
  return record;
}

/**
 * Resolve a pending approval by id.
 * Called by the /api/v1/admin/approvals/:id/resolve endpoint.
 */
export function resolveApproval(params: {
  id: string;
  selected_option: string;
  status: "approved" | "rejected" | "revised";
  resolved_by: string;
}): HumanApprovalRecord | null {
  const record = _store.get(params.id);
  if (!record || record.status !== "pending") return null;

  record.selected_option = params.selected_option;
  record.status = params.status;
  record.resolved_at = Date.now();
  record.resolved_by = params.resolved_by;
  _store.set(record.id, record);

  // Mirror the resolution to dfd_approvals (Supabase). Non-blocking — operator
  // UI doesn't fail if Supabase is down; the next run's interaction.requested
  // will reconcile via the hitl-approval sink.
  void writeApprovalResolution({
    id: record.id,
    status: record.status,
    selected_option: record.selected_option,
    resolved_at: record.resolved_at,
    resolved_by: record.resolved_by
  });

  return record;
}

/** Patch the matching dfd_approvals row. No-op when Supabase is disabled. */
async function writeApprovalResolution(patch: {
  id: string;
  status: HumanApprovalRecord["status"];
  selected_option: HumanApprovalRecord["selected_option"];
  resolved_at: number;
  resolved_by: HumanApprovalRecord["resolved_by"];
}): Promise<void> {
  const client = supabase();
  if (!client.enabled) return;
  const dbStatus = patch.status === "approved" || patch.status === "rejected"
    ? patch.status
    : "auto_resolved";
  const updatePayload: Record<string, unknown> = {
    status: dbStatus,
    selected_option: patch.selected_option,
    resolved_at: new Date(patch.resolved_at).toISOString()
  };
  if (patch.resolved_by) {
    updatePayload["user_email"] = patch.resolved_by;
  }
  const res = await client.update<Record<string, unknown>>("dfd_approvals", updatePayload, {
    filter: `id=eq.${encodeURIComponent(patch.id)}`
  });
  if (res.error) {
    console.warn("[human-approval] dfd_approvals resolve error:", res.error.slice(0, 200));
  }
}

/** All pending approvals, oldest first. */
export function listPendingApprovals(): HumanApprovalRecord[] {
  return [..._store.values()]
    .filter((r) => r.status === "pending")
    .sort((a, b) => a.created_at - b.created_at);
}

/** All approvals with optional filters. */
export function listApprovals(params?: {
  status?: HumanApprovalRecord["status"];
  run_id?: string;
  session_id?: string;
  user_id?: string;
  limit?: number;
}): HumanApprovalRecord[] {
  let records = [..._store.values()];

  if (params?.status) records = records.filter((r) => r.status === params.status);
  if (params?.run_id) records = records.filter((r) => r.run_id === params.run_id);
  if (params?.session_id) records = records.filter((r) => r.session_id === params.session_id);
  if (params?.user_id) records = records.filter((r) => r.user_id === params.user_id);

  records.sort((a, b) => b.created_at - a.created_at);
  if (params?.limit) records = records.slice(0, params.limit);

  return records;
}

/** Single approval by id. */
export function getApproval(id: string): HumanApprovalRecord | undefined {
  return _store.get(id);
}

/** Check if a run has a pending approval. */
export function hasPendingApproval(runId: string): boolean {
  return [..._store.values()].some(
    (r) => r.run_id === runId && r.status === "pending",
  );
}

/** Pending approval for a run (if any). */
export function getPendingApprovalForRun(
  runId: string,
): HumanApprovalRecord | undefined {
  return [..._store.values()].find(
    (r) => r.run_id === runId && r.status === "pending",
  );
}

/** Dashboard stats. */
export function approvalStats(): ApprovalStats {
  const now = Date.now();
  const dayMs = 86_400_000;
  const records = [..._store.values()];

  const pending = records.filter((r) => r.status === "pending").length;

  const todayResolved = records.filter(
    (r) => r.resolved_at !== null && r.resolved_at > now - dayMs,
  );

  const approved_today = todayResolved.filter(
    (r) => r.status === "approved",
  ).length;
  const rejected_today = todayResolved.filter(
    (r) => r.status === "rejected",
  ).length;

  const timed = todayResolved.filter((r) => r.resolved_at !== null);
  const avg_resolution_time_ms =
    timed.length > 0
      ? timed.reduce((s, r) => s + (r.resolved_at! - r.created_at), 0) /
        timed.length
      : 0;

  return { pending, approved_today, rejected_today, avg_resolution_time_ms };
}

// ---------------------------------------------------------------------------
// Wire into InteractionRuntimeAdapter (called externally)
// ---------------------------------------------------------------------------

/**
 * Convenience: given the interrupt payload from InteractionRuntimeAdapter,
 * register it in the queue and return the queue record.
 */
export function registerInterruptFromAdapter(params: {
  run_id: string;
  session_id: string;
  user_id: string;
  user_email: string;
  tool_name: "submit_plan" | "ask_user";
  suspendPayload?: unknown;
}): HumanApprovalRecord {
  const payload = params.suspendPayload as Record<string, unknown> | undefined;
  const prompt =
    typeof payload?.question === "string"
      ? payload.question
      : typeof payload?.message === "string"
        ? payload.message
        : `Agent requested ${params.tool_name} — review required.`;
  const options = Array.isArray(payload?.options)
    ? (payload.options as string[]).filter((o): o is string => typeof o === "string")
    : params.tool_name === "submit_plan"
      ? ["approved", "rejected", "revised"]
      : ["yes", "no"];

  return enqueueApproval({
    run_id: params.run_id,
    session_id: params.session_id,
    user_id: params.user_id,
    user_email: params.user_email,
    tool_name: params.tool_name,
    prompt,
    options,
    metadata: { suspendPayload: payload },
  });
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function _evict(): void {
  if (_store.size <= MAX_RECORDS) return;
  const resolved = [..._store.entries()]
    .filter(([, r]) => r.status !== "pending")
    .sort(([, a], [, b]) => a.created_at - b.created_at);
  const toRemove = _store.size - MAX_RECORDS;
  for (let i = 0; i < Math.min(toRemove, resolved.length); i++) {
    _store.delete(resolved[i]![0]);
  }
  if (_store.size > MAX_RECORDS) {
    const pending = [..._store.entries()]
      .filter(([, r]) => r.status === "pending")
      .sort(([, a], [, b]) => a.created_at - b.created_at);
    const remaining = _store.size - MAX_RECORDS;
    for (let i = 0; i < remaining; i++) {
      _store.delete(pending[i]![0]);
    }
  }
}
