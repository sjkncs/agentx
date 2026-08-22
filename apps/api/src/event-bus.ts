/**
 * Global event bus for wiring external sinks (Supabase, Prometheus, etc.)
 * into the per-run RunEventPipeline without modifying its signature.
 *
 * Each run's pipeline calls `sink(event)` — we fan that out to all registered sinks.
 */
import type { BaseEvent } from "@ag-ui/client";

export interface EventSink {
  name: string;
  accept(event: BaseEvent & { _sessionId?: string; _runId?: string }): void;
  flush?(): Promise<void>;
  dispose?(): Promise<void>;
}

const sinks = new Set<EventSink>();

export function registerSink(sink: EventSink): () => void {
  sinks.add(sink);
  return () => sinks.delete(sink);
}

/** Fan out one event to all registered sinks. Called from RunEventPipeline's sink callback. */
export function publishEvent(event: BaseEvent & { _sessionId?: string; _runId?: string }): void {
  for (const sink of sinks) {
    try {
      sink.accept(event);
    } catch (err) {
      console.warn(`[EventBus] sink "${sink.name}" threw:`, err instanceof Error ? err.message : String(err));
    }
  }
}

/** Flush all sinks that support it (used on server shutdown). */
export async function flushAllSinks(): Promise<void> {
  await Promise.allSettled(
    [...sinks]
      .filter((s): s is EventSink & { flush: () => Promise<void> } => typeof s.flush === "function")
      .map((s) => s.flush!())
  );
}

/** Dispose all sinks (used on server shutdown). */
export async function disposeAllSinks(): Promise<void> {
  await Promise.allSettled(
    [...sinks]
      .filter((s): s is EventSink & { dispose: () => Promise<void> } => typeof s.dispose === "function")
      .map((s) => s.dispose!())
  );
  sinks.clear();
}
