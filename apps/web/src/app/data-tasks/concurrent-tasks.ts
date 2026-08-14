/**
 * Build a Cordis-style concurrent-task list from sessions + running thread ids.
 * Pure and testable.
 */
export interface ConcurrentTask {
  id: string;
  title: string;
  status: "running" | "idle";
}

export function buildConcurrentTasks(
  sessions: Array<{ id: string; title?: string; threadId?: string }>,
  runningThreadIds: ReadonlySet<string>,
): ConcurrentTask[] {
  return sessions
    .map((s) => ({
      id: s.id,
      title: s.title || s.id,
      status: (s.threadId && runningThreadIds.has(s.threadId) ? "running" : "idle") as
        | "running"
        | "idle",
    }))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "running" ? -1 : 1));
}
