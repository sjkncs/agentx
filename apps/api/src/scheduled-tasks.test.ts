import { describe, expect, it } from "vitest";

import {
  computeNextRun,
  createScheduledTask,
  deleteScheduledTask,
  handleScheduledTasksRequest,
  listScheduledTasks,
  setScheduledTaskEnabled,
} from "./scheduled-tasks.js";

describe("scheduled-tasks", () => {
  it("computes next run from interval minutes", () => {
    const from = 1_000_000;
    expect(computeNextRun(from, 5)).toBe(from + 5 * 60_000);
    // Clamps to a minimum of 1 minute.
    expect(computeNextRun(from, 0)).toBe(from + 60_000);
  });

  it("creates, lists, toggles, and deletes tasks per user", () => {
    const created = createScheduledTask({
      userId: "user-a",
      name: "Daily report",
      prompt: "Summarize sales",
      intervalMinutes: 60,
    });
    expect(created.enabled).toBe(true);
    expect(created.id).toMatch(/^sched_/);

    expect(listScheduledTasks("user-a").map((t) => t.id)).toContain(created.id);
    expect(listScheduledTasks("user-b")).toHaveLength(0);

    const disabled = setScheduledTaskEnabled("user-a", created.id, false);
    expect(disabled?.enabled).toBe(false);

    // Other user cannot delete it.
    expect(deleteScheduledTask("user-b", created.id)).toBe(false);
    expect(deleteScheduledTask("user-a", created.id)).toBe(true);
    expect(listScheduledTasks("user-a").map((t) => t.id)).not.toContain(created.id);
  });

  it("routes REST verbs through the handler", async () => {
    const post = await handleScheduledTasksRequest({
      method: "POST",
      pathname: "/api/v1/scheduled-tasks",
      userId: "user-c",
      body: { name: "n", prompt: "p", intervalMinutes: 30 },
    });
    expect(post?.status).toBe(201);

    const list = await handleScheduledTasksRequest({
      method: "GET",
      pathname: "/api/v1/scheduled-tasks",
      userId: "user-c",
    });
    expect(list?.status).toBe(200);
    const tasks = (list?.body as { data: { tasks: Array<{ id: string }> } }).data.tasks;
    expect(tasks.length).toBeGreaterThan(0);

    const id = tasks[0]!.id;
    const del = await handleScheduledTasksRequest({
      method: "DELETE",
      pathname: `/api/v1/scheduled-tasks/${id}`,
      userId: "user-c",
    });
    expect(del?.status).toBe(200);

    // Unrelated path is not handled.
    const none = await handleScheduledTasksRequest({
      method: "GET",
      pathname: "/api/v1/other",
      userId: "user-c",
    });
    expect(none).toBeNull();
  });
});
