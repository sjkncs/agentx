/**
 * Run Persistence Sinks — Eval / HITL / Memory Bank.
 *
 * Registers three new sinks on the global EventBus, parallel to the existing
 * event-log / run-lifecycle / human-approval sinks in supabase-sinks.ts.
 *
 *   1. eval-pipeline sink          — accumulates token_usage CUSTOM events per run,
 *                                    writes per-step rows to dfd_token_usage on
 *                                    each event and aggregates to dfd_runs on
 *                                    RUN_FINISHED.
 *   2. hitl-approval sink          — on `interaction.requested` CUSTOM events,
 *                                    upserts a row in dfd_approvals with status
 *                                    pending; on the matching `interaction.resolved`
 *                                    event, updates status / selected_option /
 *                                    resolved_at.
 *   3. memory-bank sink            — on TEXT_MESSAGE_END events, persists each
 *                                    finalized user/assistant message to
 *                                    dfd_messages (typed row) so cross-session
 *                                    retrieval works.
 *
 * All sinks are no-op when Supabase is not configured (SupabaseClient.enabled).
 */
import { EventType, type BaseEvent } from "@ag-ui/core";
import { supabase } from "@datafoundry/supabase-bridge";

import { registerSink } from "./event-bus.js";

// =============================================================================
// Shared types (snake_case matching the SQL columns in 012_run_persistence_schema.sql)
// =============================================================================

type DfdTokenUsageRow = {
  run_id: string;
  session_id: string;
  user_id: string | null;
  step_number: number;
  model: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number | null;
  finished_at: string;
};

type DfdMessageRow = {
  session_id: string;
  run_id: string | null;
  user_id: string | null;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  content_type: "text" | "tool_call" | "tool_result";
  tool_call_id: string | null;
  tool_name: string | null;
};

// =============================================================================
// 1. Eval Pipeline — token_usage → dfd_token_usage + dfd_runs aggregation
// =============================================================================

/** Per-run in-memory aggregation. Reset on RUN_STARTED. */
interface RunTokenAggregate {
  runId: string;
  sessionId: string;
  userId: string | null;
  totalInput: number;
  totalOutput: number;
  startedAt: number;
}

const tokenAggregates = new Map<string, RunTokenAggregate>();
const MAX_AGGREGATES = 256;

function rememberAggregate(agg: RunTokenAggregate): void {
  tokenAggregates.set(agg.runId, agg);
  if (tokenAggregates.size > MAX_AGGREGATES) {
    const oldest = tokenAggregates.keys().next().value;
    if (oldest) tokenAggregates.delete(oldest);
  }
}

function dropAggregate(runId: string): void {
  tokenAggregates.delete(runId);
}

function registerEvalPipelineSink(): void {
  registerSink({
    name: "eval-pipeline",
    accept(event: BaseEvent & { _sessionId?: string; _runId?: string }) {
      const e = event as BaseEvent & {
        _sessionId?: string;
        _runId?: string;
        type: string;
        name?: string;
        value?: unknown;
      };
      const client = supabase();
      if (!client.enabled) return;
      const runId = e._runId;
      if (!runId) return;

      if (e.type === EventType.CUSTOM && e.name === "token_usage") {
        const value = (e.value ?? {}) as {
          input_tokens?: number;
          output_tokens?: number;
          total_tokens?: number;
          step_number?: number;
          model?: string;
          tool_call_id?: string;
          tool_name?: string;
        };
        const sessionId = e._sessionId ?? "";
        const input = numberOrZero(value.input_tokens);
        const output = numberOrZero(value.output_tokens);
        const total =
          typeof value.total_tokens === "number" ? value.total_tokens : input + output;

        let agg = tokenAggregates.get(runId);
        if (!agg) {
          agg = {
            runId,
            sessionId,
            userId: null,
            totalInput: 0,
            totalOutput: 0,
            startedAt: Date.now()
          };
        } else {
          agg.sessionId = sessionId || agg.sessionId;
        }
        agg.totalInput += input;
        agg.totalOutput += output;
        rememberAggregate(agg);

        // Per-step row written immediately so the eval pipeline can replay mid-run.
        const row: DfdTokenUsageRow = {
          run_id: runId,
          session_id: sessionId,
          user_id: agg.userId,
          step_number: numberOrZero(value.step_number),
          model: typeof value.model === "string" ? value.model : null,
          tool_call_id: typeof value.tool_call_id === "string" ? value.tool_call_id : null,
          tool_name: typeof value.tool_name === "string" ? value.tool_name : null,
          input_tokens: input,
          output_tokens: output,
          total_tokens: total,
          finished_at: new Date().toISOString()
        };
        client
          .insert<Record<string, unknown>>("dfd_token_usage", snakeRecord(row))
          .then((res) => {
            if (res.error) {
              console.warn(
                "[eval-pipeline] dfd_token_usage insert error:",
                res.error.slice(0, 200)
              );
            }
          })
          .catch((err) => {
            console.warn("[eval-pipeline] dfd_token_usage insert threw:", String(err));
          });
        return;
      }

      if (e.type === EventType.RUN_STARTED) {
        if (!tokenAggregates.has(runId)) {
          rememberAggregate({
            runId,
            sessionId: e._sessionId ?? "",
            userId: null,
            totalInput: 0,
            totalOutput: 0,
            startedAt: Date.now()
          });
        }
        return;
      }

      if (e.type === EventType.RUN_FINISHED || e.type === EventType.RUN_ERROR) {
        const agg = tokenAggregates.get(runId);
        if (!agg) return;
        // Patch dfd_runs with the aggregate (non-blocking).
        client
          .update<Record<string, unknown>>(
            "dfd_runs",
            { token_input: agg.totalInput, token_output: agg.totalOutput },
            { filter: `id=eq.${encodeURIComponent(runId)}` }
          )
          .then((res) => {
            if (res.error) {
              console.warn(
                "[eval-pipeline] dfd_runs token update error:",
                res.error.slice(0, 200)
              );
            }
          })
          .catch((err) => {
            console.warn("[eval-pipeline] dfd_runs token update threw:", String(err));
          })
          .finally(() => {
            // Keep the aggregate briefly so duplicate RUN_FINISHED events stay idempotent;
            // a 60s window is plenty for delivery retries.
            setTimeout(() => dropAggregate(runId), 60_000);
          });
      }
    },
    async dispose() {
      /* stateless */
    }
  });
}

// =============================================================================
// 2. HITL Approval — interaction.requested/resolved → dfd_approvals
// =============================================================================

function registerHitlApprovalSink(): void {
  registerSink({
    name: "hitl-approval-supabase",
    accept(event: BaseEvent & { _sessionId?: string; _runId?: string }) {
      const e = event as BaseEvent & {
        _sessionId?: string;
        _runId?: string;
        type: string;
        name?: string;
        value?: unknown;
      };
      const client = supabase();
      if (!client.enabled) return;

      if (e.type === EventType.CUSTOM && e.name === "interaction.requested") {
        const value = (e.value ?? {}) as {
          tool_name?: string;
          tool_call_id?: string;
          payload?: unknown;
          interaction_id?: string;
          run_id?: string;
        };
        const toolName =
          value.tool_name === "submit_plan" || value.tool_name === "ask_user"
            ? value.tool_name
            : null;
        if (!toolName) return;
        const row = {
          id: typeof value.interaction_id === "string" ? value.interaction_id : undefined,
          workspace_id: null,
          session_id: e._sessionId ?? null,
          run_id: e._runId ?? null,
          user_id: null,
          user_email: null,
          tool_name: toolName,
          status: "pending",
          suspend_payload: value.payload ?? {},
          selected_option: null,
          resolved_at: null,
          created_at: new Date().toISOString()
        };
        client
          .upsert<Record<string, unknown>>("dfd_approvals", row, "id")
          .then((res) => {
            if (res.error) {
              console.warn(
                "[hitl-approval] dfd_approvals upsert error:",
                res.error.slice(0, 200)
              );
            }
          })
          .catch((err) => {
            console.warn("[hitl-approval] dfd_approvals upsert threw:", String(err));
          });
        return;
      }

      if (e.type === EventType.CUSTOM && e.name === "interaction.resolved") {
        const value = (e.value ?? {}) as {
          interaction_id?: string;
          response?: unknown;
          status?: string;
        };
        const id = typeof value.interaction_id === "string" ? value.interaction_id : null;
        if (!id) return;
        const patch: Record<string, unknown> = {
          resolved_at: new Date().toISOString()
        };
        const response = value.response;
        if (response !== undefined) {
          patch.selected_option =
            typeof response === "string"
              ? response
              : (response as Record<string, unknown>).action ?? JSON.stringify(response);
        }
        const status = typeof value.status === "string" ? value.status : null;
        if (status === "approved" || status === "rejected" || status === "auto_resolved") {
          patch.status = status;
        } else if (patch.selected_option === "approved") {
          patch.status = "approved";
        } else if (patch.selected_option === "rejected") {
          patch.status = "rejected";
        }
        client
          .update<Record<string, unknown>>("dfd_approvals", patch, {
            filter: `id=eq.${encodeURIComponent(id)}`
          })
          .then((res) => {
            if (res.error) {
              console.warn(
                "[hitl-approval] dfd_approvals resolve error:",
                res.error.slice(0, 200)
              );
            }
          })
          .catch((err) => {
            console.warn("[hitl-approval] dfd_approvals resolve threw:", String(err));
          });
      }
    },
    async dispose() {
      /* stateless */
    }
  });
}

// =============================================================================
// 3. Memory Bank — TEXT_MESSAGE_* → dfd_messages (typed rows)
// =============================================================================

/** Per-run message buffer. AG-UI streams TEXT_MESSAGE_CONTENT fragments keyed
 *  by `messageId`; we accumulate until TEXT_MESSAGE_END and persist the
 *  complete content as one dfd_messages row. The buffer is keyed by
 *  `sessionId:messageId` to avoid cross-message bleed on retried streams. */
interface MessageDraft {
  messageId: string;
  role: "user" | "assistant" | "system" | "tool";
  sessionId: string;
  runId: string;
  chunks: string[];
}

const messageBuffers = new Map<string, MessageDraft>();
const BUFFER_LIMIT = 1000;

function rememberDraft(draft: MessageDraft): void {
  messageBuffers.set(`${draft.sessionId}:${draft.messageId}`, draft);
  if (messageBuffers.size > BUFFER_LIMIT) {
    const oldest = messageBuffers.keys().next().value;
    if (oldest) messageBuffers.delete(oldest);
  }
}

function dropDraft(key: string): void {
  messageBuffers.delete(key);
}

const SYSTEM_LIKE_ROLES = new Set(["system", "developer"]);

function registerMemoryBankSink(): void {
  registerSink({
    name: "memory-bank",
    accept(event: BaseEvent & { _sessionId?: string; _runId?: string }) {
      const e = event as BaseEvent & {
        _sessionId?: string;
        _runId?: string;
        type: string;
        messageId?: string;
        role?: string;
        delta?: string;
      };
      const client = supabase();
      if (!client.enabled) return;
      const sessionId = e._sessionId;
      if (!sessionId) return;

      if (e.type === EventType.TEXT_MESSAGE_CONTENT) {
        const messageId = typeof e.messageId === "string" ? e.messageId : null;
        if (!messageId) return;
        const key = `${sessionId}:${messageId}`;
        let draft = messageBuffers.get(key);
        if (!draft) {
          draft = {
            messageId,
            role: "assistant",
            sessionId,
            runId: e._runId ?? "",
            chunks: []
          };
          rememberDraft(draft);
        }
        if (typeof e.delta === "string") draft.chunks.push(e.delta);
        return;
      }

      if (e.type === EventType.TEXT_MESSAGE_END) {
        const messageId = typeof e.messageId === "string" ? e.messageId : null;
        if (!messageId) return;
        const key = `${sessionId}:${messageId}`;
        const draft = messageBuffers.get(key);
        if (!draft) return;
        dropDraft(key);
        const rawRole = typeof e.role === "string" ? e.role : draft.role;
        const normalizedRole =
          rawRole === "user" || rawRole === "assistant" || rawRole === "tool"
            ? rawRole
            : SYSTEM_LIKE_ROLES.has(rawRole)
              ? "system"
              : null;
        if (!normalizedRole) return;
        const content = draft.chunks.join("");
        if (!content) return; // empty messages (e.g. tool-only turns) are not bank-worthy
        const row: DfdMessageRow = {
          session_id: sessionId,
          run_id: e._runId ?? (draft.runId || null),
          user_id: null,
          role: normalizedRole,
          content,
          content_type: "text",
          tool_call_id: null,
          tool_name: null
        };
        client
          .insert<Record<string, unknown>>("dfd_messages", snakeRecord(row))
          .then((res) => {
            if (res.error) {
              console.warn("[memory-bank] dfd_messages insert error:", res.error.slice(0, 200));
            }
          })
          .catch((err) => {
            console.warn("[memory-bank] dfd_messages insert threw:", String(err));
          });
      }
    },
    async dispose() {
      /* drop in-flight drafts so a server restart doesn't leak memory */
      messageBuffers.clear();
    }
  });
}

// =============================================================================
// Helpers
// =============================================================================

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Convert a row that may carry snake_case keys already into the same shape
 *  — provided as a stable boundary so any future camelCase→snake_case mapping
 *  lives in one place when the column list grows. */
function snakeRecord<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  return row as Record<string, unknown>;
}

export function registerRunPersistenceSinks(): void {
  const client = supabase();
  if (!client.enabled) {
    console.info(
      "[run-persistence] Supabase not configured — eval / hitl / memory-bank sinks will be no-ops"
    );
    return;
  }
  registerEvalPipelineSink();
  registerHitlApprovalSink();
  registerMemoryBankSink();
  console.info(
    "[run-persistence] sinks registered — eval_pipeline, hitl_approval, memory_bank"
  );
}
