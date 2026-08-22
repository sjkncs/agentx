import { describe, expect, it, beforeEach } from "vitest";

import {
  __resetSubagentInboxControllerForTests,
  getSubagentInboxController,
} from "../subagent-inbox-controller";

describe("subagent-inbox-controller", () => {
  beforeEach(() => {
    __resetSubagentInboxControllerForTests();
  });

  it("spawn creates a subagent and a fresh conversation", () => {
    const ctrl = getSubagentInboxController();
    const summary = ctrl.spawn({ prompt: "hello", role: "worker" });
    expect(summary.id).toMatch(/^sess-/);
    expect(summary.status).toBe("running");
    const conv = ctrl.conversation(summary.id);
    expect(conv).toBeDefined();
    expect(conv!.messages.length).toBe(1); // system "Started"
  });

  it("sendUserMessage + injectSubagentReply append to the conversation", () => {
    const ctrl = getSubagentInboxController();
    const summary = ctrl.spawn({ prompt: "p1" });
    ctrl.sendUserMessage(summary.id, "are you alive?");
    ctrl.injectSubagentReply(summary.id, "yes");
    const conv = ctrl.conversation(summary.id)!;
    expect(conv.messages.map((m) => m.from)).toEqual([
      "system",
      "user",
      "subagent",
    ]);
  });

  it("list() returns all spawned subagents", () => {
    const ctrl = getSubagentInboxController();
    ctrl.spawn({ prompt: "p1" });
    ctrl.spawn({ prompt: "p2", role: "explore" });
    expect(ctrl.list().length).toBe(2);
  });

  it("remove() drops the subagent", () => {
    const ctrl = getSubagentInboxController();
    const summary = ctrl.spawn({ prompt: "p1" });
    ctrl.remove(summary.id);
    expect(ctrl.list().length).toBe(0);
    expect(ctrl.conversation(summary.id)).toBeUndefined();
  });

  it("stats() updates after spawn", () => {
    const ctrl = getSubagentInboxController();
    ctrl.spawn({ prompt: "p1" });
    ctrl.spawn({ prompt: "p2" });
    const stats = ctrl.getStats();
    expect(stats.totalSpawned).toBe(2);
  });
});
