import { EventEmitter } from "events";

// Force module context — required for `declare global` to be valid.
export {};

/**
 * Server-side Subagent inbox (in-memory singleton).
 *
 * Backs the `/api/subagents/*` BFF. Lets the client subagent UI survive
 * a page refresh and is the seed point for a future persistent store.
 *
 * Note: this is a process-local singleton. Next.js dev hot-reload can
 * create multiple instances across requests; in production this lives
 * for the lifetime of the Node process.
 */

export type SubagentRole = "worker" | "explore" | "planner" | "general-purpose" | "verifier";
export type SubagentStatus = "ready" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface SubagentSummary {
  id: string;
  role: SubagentRole;
  status: SubagentStatus;
  prompt: string;
  createdAt: number;
  updatedAt: number;
}

export interface InboxMessage {
  id: string;
  subagentId: string;
  from: "user" | "subagent" | "system";
  body: string;
  at: number;
}

class SubagentInboxStore {
  private subs = new Map<string, SubagentSummary>();
  private messages = new Map<string, InboxMessage[]>();
  private emitter = new EventEmitter();

  spawn(input: { prompt: string; role?: SubagentRole; sessionId?: string }): SubagentSummary {
    const id = `${input.sessionId ?? "sess"}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const sub: SubagentSummary = {
      id,
      role: input.role ?? "worker",
      status: "running",
      prompt: input.prompt,
      createdAt: now,
      updatedAt: now,
    };
    this.subs.set(id, sub);
    this.messages.set(id, [
      { id: `m-${now}`, subagentId: id, from: "system", body: `Started (role=${sub.role})`, at: now },
    ]);
    this.emitter.emit("change", { type: "spawn", sub });
    return sub;
  }

  sendUserMessage(subagentId: string, body: string): InboxMessage | undefined {
    const sub = this.subs.get(subagentId);
    if (!sub) return undefined;
    const msg: InboxMessage = {
      id: `m-${Date.now()}`,
      subagentId,
      from: "user",
      body,
      at: Date.now(),
    };
    this.appendMessage(subagentId, msg);
    return msg;
  }

  injectReply(subagentId: string, body: string): InboxMessage | undefined {
    const sub = this.subs.get(subagentId);
    if (!sub) return undefined;
    const msg: InboxMessage = {
      id: `m-${Date.now()}`,
      subagentId,
      from: "subagent",
      body,
      at: Date.now(),
    };
    this.appendMessage(subagentId, msg);
    return msg;
  }

  setStatus(subagentId: string, status: SubagentStatus): SubagentSummary | undefined {
    const sub = this.subs.get(subagentId);
    if (!sub) return undefined;
    sub.status = status;
    sub.updatedAt = Date.now();
    this.subs.set(subagentId, sub);
    this.emitter.emit("change", { type: "status", sub });
    return sub;
  }

  remove(subagentId: string): boolean {
    const existed = this.subs.delete(subagentId);
    this.messages.delete(subagentId);
    if (existed) this.emitter.emit("change", { type: "remove", id: subagentId });
    return existed;
  }

  list(): SubagentSummary[] {
    return Array.from(this.subs.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  messagesOf(subagentId: string): InboxMessage[] {
    return this.messages.get(subagentId) ?? [];
  }

  on(event: "change", listener: (payload: unknown) => void): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }

  private appendMessage(subagentId: string, msg: InboxMessage) {
    const arr = this.messages.get(subagentId) ?? [];
    arr.push(msg);
    this.messages.set(subagentId, arr);
    this.emitter.emit("change", { type: "message", msg });
  }
}

// Singleton across HMR reloads via globalThis.
declare global {
  // eslint-disable-next-line no-var
  var __subagent_inbox_store: SubagentInboxStore | undefined;
}

export function getSubagentInboxStore(): SubagentInboxStore {
  if (!globalThis.__subagent_inbox_store) {
    globalThis.__subagent_inbox_store = new SubagentInboxStore();
  }
  return globalThis.__subagent_inbox_store;
}