/**
 * Supabase sink wiring for the API server.
 *
 * Registers two sinks on the global EventBus:
 *   1. SupabaseEventLogSink  — persists session events to dfd_session_events
 *   2. SupabaseRunSink        — tracks agent run lifecycle
 *
 * Also registers the human-approval-queue interrupt bridge so that
 * approval requests from @datafoundry/metadata are visible to the admin panel.
 *
 * Run after metadataStore is created; safe to call with `void` — logs warnings
 * if Supabase is not configured (no credentials / disabled).
 */
import type { BaseEvent } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import { createCustomEvent } from "@datafoundry/agent-runtime";
import type { MetadataStore } from "@datafoundry/metadata";
import {
  SupabaseEventLogSink,
  SupabaseRunSink,
} from "@datafoundry/supabase-bridge";
import { registerSink } from "./event-bus.js";
import { enqueueFromInterrupt } from "./human-approval-queue.js";
import { supabase } from "@datafoundry/supabase-bridge";

function buildEventLogSink(metadataStore: MetadataStore): SupabaseEventLogSink {
  const client = supabase();
  const sink = new SupabaseEventLogSink(client);

  // The pipeline delivers events directly; we also need session/run metadata.
  // Wire into RunEventWriter append events by subscribing to the store's run_events.
  // For now, use the EventBus sink approach (publishEvent calls sink.accept).
  registerSink({
    name: "supabase-event-log",
    accept(event: BaseEvent & { _sessionId?: string; _runId?: string }) {
      const e = event as BaseEvent & {
        _sessionId?: string;
        _runId?: string;
        _timestamp?: number;
        _seq?: number;
        type: string;
      };
      const args = {
        type: e.type,
        _sessionId: e._sessionId,
        _runId: e._runId,
        _timestamp: e._timestamp ?? Date.now(),
        ...(e._seq !== undefined ? { _seq: e._seq } : {}),
      };
      sink.append(args as Parameters<typeof sink.append>[0]);
    },
    async flush() { await sink.flush(); },
    async dispose() { await sink.dispose(); },
  });

  return sink;
}

function buildRunSink(): SupabaseRunSink {
  const client = supabase();
  const sink = new SupabaseRunSink(client);

  registerSink({
    name: "supabase-run",
    accept(event: BaseEvent & { _sessionId?: string; _runId?: string }) {
      const e = event as BaseEvent & {
        _sessionId?: string;
        _runId?: string;
        _timestamp?: number;
        type: string;
        status?: string;
      };

      // Map AG-UI event types to run status transitions
      const computedDuration = e._timestamp ? Date.now() - e._timestamp : undefined;
      switch (e.type) {
        case EventType.RUN_STARTED:
          sink.start({ runId: e._runId ?? "", sessionId: e._sessionId ?? "" });
          break;
        case EventType.RUN_FINISHED: {
          const endParams: Parameters<typeof sink.end>[0] = {
            runId: e._runId ?? "",
            sessionId: e._sessionId ?? "",
            status: "completed",
          };
          if (computedDuration !== undefined) endParams.durationMs = computedDuration;
          sink.end(endParams);
          break;
        }
        case EventType.RUN_ERROR: {
          const endParams: Parameters<typeof sink.end>[0] = {
            runId: e._runId ?? "",
            sessionId: e._sessionId ?? "",
            status: "failed",
          };
          if (e.status !== undefined) endParams.error = e.status;
          if (computedDuration !== undefined) endParams.durationMs = computedDuration;
          sink.end(endParams);
          break;
        }
        // Other events: no-op for run lifecycle
      }
    },
    async dispose() { /* no-op for stateless HTTP sink */ },
  });

  return sink;
}

/**
 * Bridge interaction.requested events to the human approval queue.
 * The InteractionRuntimeAdapter already persisted the interaction to metadataStore;
 * we listen for the CUSTOM event and mirror it into the queue for admin UI.
 */
function registerHumanApprovalSink(_metadataStore: MetadataStore): void {
  registerSink({
    name: "human-approval",
    accept(event: BaseEvent & { _sessionId?: string; _runId?: string }) {
      const e = event as BaseEvent & {
        _sessionId?: string;
        _runId?: string;
        type: string;
        payload?: unknown;
        tool_name?: string;
      };
      if ((e as unknown as { type: string }).type !== "interaction.requested") return;
      const payload = e.payload as Record<string, unknown> | undefined;
      const userId = String(e._runId ? e._runId.split("-")[0] : "unknown");
      enqueueFromInterrupt({
        run_id: e._runId ?? "",
        session_id: e._sessionId ?? "",
        user_id: userId,
        user_email: `user-${userId}@datafoundry.local`,
        tool_name: (e.tool_name as "ask_user" | "submit_plan") ?? "ask_user",
        suspendPayload: payload,
      });
    },
    async dispose() { /* stateless, no cleanup */ },
  });
}

export async function registerSupabaseSinks(metadataStore: MetadataStore): Promise<void> {
  const client = supabase();
  if (!client.enabled) {
    console.info(
      "[Supabase] not configured — set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env.local to enable"
    );
    return;
  }

  console.info(`[Supabase] connecting to ${client.url}`);

  // Session event log sink
  buildEventLogSink(metadataStore);

  // Run lifecycle sink
  buildRunSink();

  // Human-approval interrupt bridge
  registerHumanApprovalSink(metadataStore);

  console.info(
    "[Supabase] sinks registered — event_log, run_lifecycle, human_approval"
  );
}
