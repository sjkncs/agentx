"use client";

import { EventEmitter } from "events";

/** Optional remote sync. Falls back gracefully when offline / no cookie. */
async function postJson(path: string, body: unknown): Promise<boolean> {
  try {
    const csrfMatch = document.cookie.match(/(?:^|;\s*)df_csrf=([^;]+)/);
    const csrf = csrfMatch?.[1] ? decodeURIComponent(csrfMatch[1]) : "";
    const resp = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "x-csrf-token": csrf } : {}),
      },
      body: JSON.stringify(body),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function patchJson(path: string, body: unknown): Promise<boolean> {
  try {
    const csrfMatch = document.cookie.match(/(?:^|;\s*)df_csrf=([^;]+)/);
    const csrf = csrfMatch?.[1] ? decodeURIComponent(csrfMatch[1]) : "";
    const resp = await fetch(path, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "x-csrf-token": csrf } : {}),
      },
      body: JSON.stringify(body),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Browser-side Subagent Inbox controller.
 *
 * Exposes a user-facing inbox over subagents so the UI can list / spawn /
 * message / pause / remove subagents without going through the main agent.
 *
 * To keep this module browser-bundle-friendly and testable without the
 * harness-core node-only modules, the controller defines its own
 * `BrowserSubagent` (an EventEmitter with the minimal state machine we need).
 * A real harness-core Subagent can be swapped in by replacing the
 * `BrowserSubagent` factory with `createSubagent` from
 * `@datafoundry/harness-core/src/subagent` once the package exposes a
 * browser-safe entry point.
 */

export type SubagentRole = "worker" | "explore" | "planner" | "general-purpose" | "verifier";
export type SubagentStatus = "ready" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface SubagentConfig {
  id: string;
  role: SubagentRole;
  prompt: string;
  isolation?: "fork" | "inherit" | "worktree";
}

export interface SubagentMessage {
  id: string;
  fromSubagentId: string;
  toSubagentId?: string;
  type: "request" | "response" | "result" | "report";
  subject?: string;
  body: unknown;
  metadata?: Record<string, unknown>;
}

export interface SubagentStats {
  totalSpawned: number;
  currentlyRunning: number;
  completed: number;
  failed: number;
  byRole: Record<string, number>;
  totalDuration: number;
  averageDuration: number;
  totalTokensUsed: number;
}

export interface SubagentResult {
  success: boolean;
  summary: string;
  durationMs?: number;
}

/** Minimal in-memory subagent. */
export class BrowserSubagent extends EventEmitter {
  readonly id: string;
  readonly config: SubagentConfig;
  readonly role: SubagentRole;
  private _status: SubagentStatus = "ready";
  private readonly createdAt: number;

  constructor(sessionId: string, config: SubagentConfig) {
    super();
    this.id = config.id ?? `${sessionId}-${Math.random().toString(36).slice(2, 8)}`;
    this.config = { ...config, id: this.id };
    this.role = config.role;
    this.createdAt = Date.now();
  }

  getStatus(): SubagentStatus {
    return this._status;
  }

  setStatus(next: SubagentStatus) {
    const previous = this._status;
    this._status = next;
    this.emit("status:change", next, previous);
  }

  pause() {
    if (this._status === "running") this.setStatus("paused");
  }

  resume() {
    if (this._status === "paused") this.setStatus("running");
  }

  cancel() {
    if (this._status === "running" || this._status === "ready") this.setStatus("cancelled");
  }

  emitCompleted(result: SubagentResult) {
    this.emit("completed", result);
  }
}

export function createSubagent(sessionId: string, config: SubagentConfig): BrowserSubagent {
  return new BrowserSubagent(sessionId, config);
}

// ============================================================================
// Inbox controller
// ============================================================================

export interface InboxConversation {
  subagentId: string;
  messages: Array<{
    from: "user" | "subagent" | "system";
    body: string;
    at: number;
  }>;
}

export interface SubagentSummary {
  id: string;
  role: SubagentRole;
  status: SubagentStatus;
  prompt: string;
  createdAt: number;
}

class SubagentInboxController extends EventEmitter {
  private subs = new Map<string, BrowserSubagent>();
  private conversations = new Map<string, InboxConversation>();
  private summaries = new Map<string, SubagentSummary>();
  private stats: SubagentStats = {
    totalSpawned: 0,
    currentlyRunning: 0,
    completed: 0,
    failed: 0,
    byRole: {},
    totalDuration: 0,
    averageDuration: 0,
    totalTokensUsed: 0,
  };

  private emitChange() {
    this.emit("change");
  }

  private appendMessage(
    subagentId: string,
    from: "user" | "subagent" | "system",
    body: string,
  ) {
    const conv = this.conversations.get(subagentId);
    if (!conv) return;
    conv.messages.push({ from, body, at: Date.now() });
    this.emitChange();
  }

  /** Start a new subagent */
  spawn(input: { prompt: string; role?: SubagentRole; parentSessionId?: string }): SubagentSummary {
    const sessionId = input.parentSessionId ?? `sess-${Date.now()}`;
    const config: SubagentConfig = {
      id: `${sessionId}-${Math.random().toString(36).slice(2, 8)}`,
      role: input.role ?? "worker",
      prompt: input.prompt,
      isolation: "fork",
    };
    const sub = createSubagent(sessionId, config);
    sub.setStatus("running");
    this.subs.set(sub.id, sub);

    this.summaries.set(sub.id, {
      id: sub.id,
      role: sub.role,
      status: sub.getStatus(),
      prompt: sub.config.prompt,
      createdAt: Date.now(),
    });
    this.conversations.set(sub.id, { subagentId: sub.id, messages: [] });
    this.stats.totalSpawned++;
    this.stats.byRole[sub.role] = (this.stats.byRole[sub.role] || 0) + 1;
    this.recalcRunning();

    sub.on("status:change", (newStatus) => {
      const summary = this.summaries.get(sub.id);
      if (summary) {
        this.summaries.set(sub.id, { ...summary, status: newStatus });
      }
      this.recalcRunning();
      this.emitChange();
    });

    this.appendMessage(sub.id, "system", `Started subagent (role=${sub.role})`);
    this.emitChange();
    // Best-effort sync to server store.
    void postJson("/api/subagents", { prompt: input.prompt, role: input.role, sessionId });
    return this.summaries.get(sub.id)!;
  }

  /** User sends a message to a subagent */
  sendUserMessage(subagentId: string, body: string) {
    this.appendMessage(subagentId, "user", body);
    const sub = this.subs.get(subagentId);
    if (sub) {
      const msg: SubagentMessage = {
        id: `msg-${Date.now()}`,
        fromSubagentId: "user",
        toSubagentId: subagentId,
        type: "request",
        subject: "user-input",
        body,
        metadata: {},
      };
      sub.emit("message", msg);
    }
    void patchJson("/api/subagents", { id: subagentId, action: "send", body });
  }

  /** Inject a synthetic reply (UI demo helper) */
  injectSubagentReply(subagentId: string, body: string) {
    this.appendMessage(subagentId, "subagent", body);
    void patchJson("/api/subagents", { id: subagentId, action: "reply", body });
  }

  pause(id: string) {
    const sub = this.subs.get(id);
    if (sub) sub.pause();
    void patchJson("/api/subagents", { id, action: "status", status: "paused" });
  }

  resume(id: string) {
    const sub = this.subs.get(id);
    if (sub) sub.resume();
    void patchJson("/api/subagents", { id, action: "status", status: "running" });
  }

  remove(id: string) {
    const sub = this.subs.get(id);
    if (sub) sub.cancel();
    this.subs.delete(id);
    this.summaries.delete(id);
    this.conversations.delete(id);
    this.recalcRunning();
    this.emitChange();
    void patchJson("/api/subagents", { id, action: "remove" });
  }

  getStats(): SubagentStats {
    return { ...this.stats, byRole: { ...this.stats.byRole } };
  }

  list(): SubagentSummary[] {
    return Array.from(this.summaries.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  conversation(subagentId: string): InboxConversation | undefined {
    return this.conversations.get(subagentId);
  }

  private recalcRunning() {
    this.stats.currentlyRunning = Array.from(this.subs.values()).filter(
      (s) => s.getStatus() === "running",
    ).length;
  }
}

let _controller: SubagentInboxController | null = null;

export function getSubagentInboxController(): SubagentInboxController {
  if (!_controller) _controller = new SubagentInboxController();
  return _controller;
}

/** test-only reset */
export function __resetSubagentInboxControllerForTests() {
  _controller = null;
}