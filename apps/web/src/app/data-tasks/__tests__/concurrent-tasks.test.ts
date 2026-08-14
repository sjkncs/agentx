import { describe, expect, it } from "vitest";

import { buildConcurrentTasks } from "../concurrent-tasks";

describe("buildConcurrentTasks", () => {
  const sessions = [
    { id: "a", title: "Idle task", threadId: "t-a" },
    { id: "b", title: "Running task", threadId: "t-b" },
    { id: "c", title: "Untitled", threadId: "t-c" },
  ];

  it("marks running threads and sorts them first", () => {
    const tasks = buildConcurrentTasks(sessions, new Set(["t-b"]));
    expect(tasks[0]?.id).toBe("b");
    expect(tasks[0]?.status).toBe("running");
    expect(tasks.filter((t) => t.status === "running")).toHaveLength(1);
    expect(tasks).toHaveLength(3);
  });

  it("falls back to id when no title and idle when no running threads", () => {
    const noTitle = [
      { id: "x", threadId: "t-x" },
      { id: "y", title: "", threadId: "t-y" },
    ];
    const tasks = buildConcurrentTasks(noTitle, new Set());
    expect(tasks.every((t) => t.status === "idle")).toBe(true);
    expect(tasks.find((t) => t.id === "x")?.title).toBe("x");
    expect(tasks.find((t) => t.id === "y")?.title).toBe("y");
  });
});
