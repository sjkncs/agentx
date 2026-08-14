"use client";

import { useT } from "../../../../i18n/locale-context";
import type { ConcurrentTask } from "../../concurrent-tasks";

/**
 * Cordis-style concurrent-task panel: lists sessions with a live status badge
 * (running / idle), running ones first.
 */
export function ConcurrentTasksPanel({ tasks }: { tasks: ConcurrentTask[] }) {
  const t = useT();
  if (tasks.length === 0) return null;

  return (
    <section data-testid="concurrent-tasks-panel" className="grid gap-1.5">
      <header className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          {t("concurrent.title")}
        </h3>
        <span className="tabular rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted-light">
          {tasks.filter((x) => x.status === "running").length}/{tasks.length}
        </span>
      </header>
      <ul className="grid gap-1">
        {tasks.map((task) => (
          <li
            key={task.id}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface-subtle px-2 py-1.5"
          >
            <span
              aria-hidden="true"
              className={[
                "h-2 w-2 shrink-0 rounded-full",
                task.status === "running" ? "animate-pulse bg-step-success" : "bg-muted-light",
              ].join(" ")}
            />
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">{task.title}</span>
            <span
              className={[
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                task.status === "running"
                  ? "bg-step-success/15 text-step-success"
                  : "bg-surface text-muted-light",
              ].join(" ")}
            >
              {task.status === "running" ? t("concurrent.running") : t("concurrent.idle")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
