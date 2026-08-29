import type { AgUiEventEmitter } from "@agentx/agent-runtime";
import { createCustomEvent } from "@agentx/agent-runtime";
import { createSupabaseClient, type SupabaseScheduledTaskRow } from "./supabase.js";

const supabase = createSupabaseClient();
const loadedUsers = new Set<string>();

function toRow(task: ScheduledTask): SupabaseScheduledTaskRow {
  return {
    id: task.id,
    user_id: task.userId,
    name: task.name,
    prompt: task.prompt,
    interval_minutes: task.intervalMinutes,
    enabled: task.enabled,
    created_at: task.createdAt,
    next_run_at: task.nextRunAt,
  };
}

function fromRow(row: SupabaseScheduledTaskRow): ScheduledTask {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    prompt: row.prompt,
    intervalMinutes: row.interval_minutes,
    enabled: row.enabled,
    createdAt: row.created_at,
    nextRunAt: row.next_run_at,
  };
}

/** Load a user's tasks from Supabase into memory once (no-op when not configured). */
export async function ensureTasksLoaded(userId: string): Promise<void> {
  if (!supabase.enabled || loadedUsers.has(userId)) return;
  const rows = await supabase.listTasks(userId);
  for (const row of rows) {
    if (!tasks.has(row.id)) tasks.set(row.id, fromRow(row));
  }
  loadedUsers.add(userId);
}

/**
 * Lightweight scheduled-task (cron) system for AgentX.
 *
 * Tasks run on a fixed interval (minutes). A background scheduler checks for due
 * tasks and emits a `scheduled.task.due` AG-UI custom event (observable by the
 * frontend / logs). The actual agent-run trigger is an integration point: callers
 * may supply `onDue` to launch a run through the run pipeline.
 *
 * Storage is in-memory for this increment; persistence can later move to the
 * metadata store without changing the public surface.
 */

export interface ScheduledTask {
  id: string;
  userId: string;
  name: string;
  prompt: string;
  intervalMinutes: number;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number | undefined;
  nextRunAt: number;
}

const tasks = new Map<string, ScheduledTask>();
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let onDueHook: ((task: ScheduledTask) => void | Promise<void>) | null = null;

export function computeNextRun(from: number, intervalMinutes: number): number {
  return from + Math.max(1, intervalMinutes) * 60_000;
}

export function listScheduledTasks(userId: string): ScheduledTask[] {
  return [...tasks.values()]
    .filter((task) => task.userId === userId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function createScheduledTask(input: {
  userId: string;
  name: string;
  prompt: string;
  intervalMinutes: number;
}): ScheduledTask {
  const now = Date.now();
  const task: ScheduledTask = {
    id: `sched_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    userId: input.userId,
    name: input.name || "Scheduled task",
    prompt: input.prompt,
    intervalMinutes: Math.max(1, Math.floor(input.intervalMinutes) || 60),
    enabled: true,
    createdAt: now,
    nextRunAt: computeNextRun(now, input.intervalMinutes),
  };
  tasks.set(task.id, task);
  void supabase.upsertTask(toRow(task));
  return task;
}

export function deleteScheduledTask(userId: string, id: string): boolean {
  const task = tasks.get(id);
  if (!task || task.userId !== userId) return false;
  tasks.delete(id);
  void supabase.deleteTask(id);
  return true;
}

export function setScheduledTaskEnabled(userId: string, id: string, enabled: boolean): ScheduledTask | null {
  const task = tasks.get(id);
  if (!task || task.userId !== userId) return null;
  task.enabled = enabled;
  if (enabled) task.nextRunAt = computeNextRun(Date.now(), task.intervalMinutes);
  void supabase.upsertTask(toRow(task));
  return task;
}

/** Register a callback invoked when a task becomes due (e.g. to launch a run). */
export function onScheduledTaskDue(handler: (task: ScheduledTask) => void | Promise<void>): void {
  onDueHook = handler;
}

/** Start the background scheduler (idempotent). */
export function startScheduledTaskScheduler(emitter?: AgUiEventEmitter): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    const now = Date.now();
    for (const task of tasks.values()) {
      if (!task.enabled || now < task.nextRunAt) continue;
      task.lastRunAt = now;
      task.nextRunAt = computeNextRun(now, task.intervalMinutes);
      try {
        emitter?.emit(
          createCustomEvent("scheduled.task.due", {
            task_id: task.id,
            name: task.name,
            prompt: task.prompt,
          }),
        );
      } catch {
        // Never break the scheduler on emit failure.
      }
      void onDueHook?.(task);
    }
  }, 30_000);
}

export function stopScheduledTaskScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

export type ScheduledTasksHttpResponse = { status: number; body: unknown };

/**
 * Minimal REST handler for /api/v1/scheduled-tasks.
 * Returns a {status, body} descriptor, or null when the path is not handled.
 */
export async function handleScheduledTasksRequest(input: {
  method: string;
  pathname: string;
  userId: string;
  body?: Record<string, unknown> | undefined;
}): Promise<ScheduledTasksHttpResponse | null> {
  const { method, pathname, userId, body } = input;
  if (!pathname.startsWith("/api/v1/scheduled-tasks")) return null;

  const parts = pathname.replace(/\/+$/, "").split("/");
  const id = parts[4]; // /api/v1/scheduled-tasks/:id

  if (method === "GET" && !id) {
    await ensureTasksLoaded(userId);
    return { status: 200, body: { success: true, data: { tasks: listScheduledTasks(userId) } } };
  }

  if (method === "POST" && !id) {
    const task = createScheduledTask({
      userId,
      name: typeof body?.name === "string" ? body.name : "",
      prompt: typeof body?.prompt === "string" ? body.prompt : "",
      intervalMinutes: typeof body?.intervalMinutes === "number" ? body.intervalMinutes : 60,
    });
    return { status: 201, body: { success: true, data: task } };
  }

  if (id && method === "DELETE") {
    const removed = deleteScheduledTask(userId, id);
    return { status: removed ? 200 : 404, body: { success: removed } };
  }

  if (id && method === "PATCH") {
    const task = setScheduledTaskEnabled(userId, id, Boolean(body?.enabled));
    return task
      ? { status: 200, body: { success: true, data: task } }
      : { status: 404, body: { success: false } };
  }

  return { status: 404, body: { success: false, error: "NOT_FOUND" } };
}
