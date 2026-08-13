"use client";

import { useT } from "../../../../i18n/locale-context";
import type { LiveRun } from "../../live-run-state";
import { IconAwareness } from "./console-icons-system";

/**
 * Awareness panel: surfaces the agent's long-term memory activity for this session.
 * Reads memory.long-term.extracted events captured on the LiveRun.
 */
export function AwarenessPanel({ liveRun }: { liveRun: LiveRun }) {
  const t = useT();
  const events = liveRun.memoryEvents ?? [];
  const totalMemories = events.reduce((sum, e) => sum + e.count, 0);

  return (
    <section data-testid="awareness-panel" className="grid gap-3">
      <header className="flex items-center gap-2 text-muted">
        <IconAwareness size={14} />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em]">
          {t("awareness.title")}
        </h3>
      </header>

      <div className="rounded-lg border border-border bg-surface-subtle p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">{t("awareness.memories")}</span>
          <span className="tabular text-sm font-semibold text-foreground">{totalMemories}</span>
        </div>
      </div>

      {events.length === 0 ? (
        <p className="text-[11px] text-muted-light">{t("awareness.empty")}</p>
      ) : (
        <ul className="grid gap-1.5">
          {events.map((event, index) => (
            <li
              key={`${event.receivedAt}-${index}`}
              className="rounded-lg border border-border bg-surface-subtle p-2"
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-foreground">
                  {t("awareness.extracted", { count: event.count })}
                </span>
                {event.source ? (
                  <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted-light">
                    {event.source}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
