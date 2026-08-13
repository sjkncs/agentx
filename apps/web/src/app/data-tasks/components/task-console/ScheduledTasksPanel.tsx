"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "../../../../i18n/locale-context";
import { IconSchedule } from "./console-icons-system";

export interface ScheduledTaskDto {
  id: string;
  name: string;
  prompt: string;
  intervalMinutes: number;
  enabled: boolean;
  nextRunAt: number;
  lastRunAt?: number | undefined;
}

function readCsrfToken(): string | undefined {
  const match = document.cookie.match(/(?:^|;\s*)df_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Scheduled-tasks panel: create / list / toggle / delete timer-driven analysis runs.
 * Backed by the /api/v1/scheduled-tasks REST endpoints.
 */
export function ScheduledTasksPanel() {
  const t = useT();
  const [tasks, setTasks] = useState<ScheduledTaskDto[]>([]);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/scheduled-tasks", { credentials: "include" });
      const json = await res.json();
      setTasks(json?.data?.tasks ?? []);
    } catch {
      setTasks([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mutate = useCallback(
    async (run: () => Promise<Response>) => {
      setBusy(true);
      try {
        await run();
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const csrf = readCsrfToken();
  const headers = { "Content-Type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) };

  const add = () =>
    mutate(() =>
      fetch("/api/v1/scheduled-tasks", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ name, prompt, intervalMinutes }),
      }),
    );

  return (
    <section data-testid="scheduled-tasks-panel" className="grid gap-3">
      <header className="flex items-center gap-2 text-muted">
        <IconSchedule size={14} />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em]">
          {t("scheduled.title")}
        </h3>
      </header>

      {/* Create form */}
      <div className="grid gap-1.5 rounded-lg border border-border bg-surface-subtle p-2.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("scheduled.name")}
          className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
        />
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t("scheduled.prompt")}
          className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
        />
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(Number(e.target.value) || 60)}
            className="w-20 rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
          />
          <span className="text-[11px] text-muted-light">min</span>
          <button
            type="button"
            disabled={busy || !prompt.trim()}
            onClick={() => {
              void add();
              setName("");
              setPrompt("");
            }}
            className="ml-auto cursor-pointer rounded-lg bg-primary px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            {t("scheduled.add")}
          </button>
        </div>
      </div>

      {/* List */}
      {tasks.length === 0 ? (
        <p className="text-[11px] text-muted-light">{t("scheduled.empty")}</p>
      ) : (
        <ul className="grid gap-1.5">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface-subtle p-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-medium text-foreground">{task.name}</span>
                  <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted-light">
                    {task.intervalMinutes}m
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-1 text-[11px] text-muted">{task.prompt}</p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  mutate(() =>
                    fetch(`/api/v1/scheduled-tasks/${task.id}`, {
                      method: "PATCH",
                      credentials: "include",
                      headers,
                      body: JSON.stringify({ enabled: !task.enabled }),
                    }),
                  )
                }
                className={[
                  "shrink-0 cursor-pointer rounded-full px-2.5 py-1 text-[10px] font-semibold",
                  task.enabled ? "bg-step-success/15 text-step-success" : "bg-surface text-muted-light",
                ].join(" ")}
              >
                {task.enabled ? t("scheduled.enabled") : t("scheduled.disabled")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  mutate(() =>
                    fetch(`/api/v1/scheduled-tasks/${task.id}`, {
                      method: "DELETE",
                      credentials: "include",
                      headers,
                    }),
                  )
                }
                className="shrink-0 cursor-pointer rounded-full bg-surface px-2.5 py-1 text-[10px] text-muted-light hover:text-rose-600"
              >
                {t("scheduled.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
