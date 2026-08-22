import { describe, expect, it, beforeEach } from "vitest";

// Force fresh module per test by resetting globalThis.
function freshStore() {
  // @ts-expect-error: clearing global for fresh store
  delete globalThis.__subagent_inbox_store;
  return import("./store").then((m) => m.getSubagentInboxStore());
}

describe("subagent inbox store", () => {
  beforeEach(() => {
    // @ts-expect-error: clearing global for fresh store
    delete globalThis.__subagent_inbox_store;
  });

  it("spawns a subagent and tracks it in list", async () => {
    const store = await freshStore();
    const sub = store.spawn({ prompt: "hello", role: "worker" });
    expect(sub.id).toMatch(/^sess-/);
    expect(sub.status).toBe("running");
    expect(store.list()).toHaveLength(1);
  });

  it("append user messages and inject replies", async () => {
    const store = await freshStore();
    const sub = store.spawn({ prompt: "p" });
    store.sendUserMessage(sub.id, "hi from user");
    store.injectReply(sub.id, "hi from agent");
    const msgs = store.messagesOf(sub.id);
    expect(msgs).toHaveLength(3); // system + user + subagent
    expect(msgs.map((m) => m.from)).toEqual(["system", "user", "subagent"]);
  });

  it("setStatus updates and emits change", async () => {
    const store = await freshStore();
    const sub = store.spawn({ prompt: "p" });
    const events: string[] = [];
    const off = store.on("change", (e: unknown) => {
      const ev = e as { type?: string };
      events.push(ev.type ?? "?");
    });
    store.setStatus(sub.id, "paused");
    store.setStatus(sub.id, "completed");
    expect(events).toContain("status");
    off();
  });

  it("remove deletes subagent and its messages", async () => {
    const store = await freshStore();
    const sub = store.spawn({ prompt: "p" });
    expect(store.remove(sub.id)).toBe(true);
    expect(store.list()).toHaveLength(0);
    expect(store.messagesOf(sub.id)).toHaveLength(0);
    expect(store.remove(sub.id)).toBe(false); // already gone
  });

  it("sendUserMessage returns undefined when subagent id is unknown", async () => {
    const store = await freshStore();
    expect(store.sendUserMessage("missing", "x")).toBeUndefined();
  });
});