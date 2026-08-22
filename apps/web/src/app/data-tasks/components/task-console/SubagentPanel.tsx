/**
 * Subagent Panel - per-subagent chat with parent agent control
 *
 * 借鉴 ZCode Subagents 设计：
 *   - 主 agent 派生的子 agent 独立显示
 *   - 用户可以下指令/中断每个子 agent
 *   - 父子层级清晰，可展开看上下文
 *
 * 此组件是纯 UI shell，与现有的 SubagentManager（harness-core）一起工作。
 * 数据通过 props 传入（实际使用时由 data-tasks-app 把 SubagentManager 状态桥接进来）。
 *
 * 设计目标：渐进式增强，没接 harness-core 时也能用降级 mock。
 */

"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useT } from "../../../../i18n/locale-context";
import {
  btnGhostClass,
  btnPrimaryClass,
  btnSecondaryClass,
  chipClass,
  emptyStateClass,
  panelShellClass,
  panelTitleClass,
  sectionLabelClass,
} from "../../ui-tokens";

// ============================================================================
// Types (mirror SubagentManager schema in harness-core)
// ============================================================================

export type SubagentStatus =
  | "pending"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type SubagentRole = "worker" | "explore" | "planner" | "reviewer" | "general-purpose";

export interface SubagentMessageLite {
  id: string;
  role: "user" | "subagent" | "system";
  text: string;
  ts: number;
}

export interface SubagentLite {
  id: string;
  parentId: string | null;
  role: SubagentRole;
  prompt: string;
  status: SubagentStatus;
  startedAt: number;
  /** 子 agent 独立消息历史 */
  history: SubagentMessageLite[];
  /** 子 agent 产出的 token / tool 统计 */
  stats: { toolCalls: number; tokens: number; durationMs: number };
}

export interface SubagentPanelProps {
  subagents: SubagentLite[];
  /** 主 agent 回调：下发指令给某个子 agent */
  onSendToSubagent?: (subagentId: string, text: string) => void;
  /** 主 agent 回调：中断某个子 agent */
  onPauseSubagent?: (subagentId: string) => void;
  /** 主 agent 回调：恢复某个子 agent */
  onResumeSubagent?: (subagentId: string) => void;
  /** 主 agent 回调：终止某个子 agent */
  onCancelSubagent?: (subagentId: string) => void;
  /** 主 agent 回调：创建新的子 agent（用户可从主会话派生） */
  onSpawnSubagent?: (role: SubagentRole, prompt: string) => void;
}

// ============================================================================
// Status pill
// ============================================================================

const STATUS_LABEL: Record<SubagentStatus, string> = {
  pending: "pending",
  ready: "ready",
  running: "running",
  paused: "paused",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
};

const STATUS_TONE: Record<SubagentStatus, string> = {
  pending: "border-border bg-surface-subtle text-muted",
  ready: "border-primary-light/30 bg-primary-light/10 text-primary",
  running: "border-primary-light/30 bg-primary-light/20 text-primary",
  paused: "border-step-warning/30 bg-step-warning/10 text-step-warning",
  completed: "border-step-success/30 bg-step-success/10 text-step-success",
  failed: "border-step-error/30 bg-step-error/10 text-step-error",
  cancelled: "border-border bg-surface-subtle text-muted-light",
};

function StatusPill({ status }: { status: SubagentStatus }) {
  return (
    <span
      className={[
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        STATUS_TONE[status],
      ].join(" ")}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

// ============================================================================
// Component
// ============================================================================

export function SubagentPanel(props: SubagentPanelProps) {
  const t = useT();
  const { subagents, onSendToSubagent, onPauseSubagent, onResumeSubagent, onCancelSubagent, onSpawnSubagent } = props;
  const [selectedId, setSelectedId] = useState<string | null>(subagents[0]?.id ?? null);
  const [draft, setDraft] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  // Auto-select first subagent if list changes
  useEffect(() => {
    if (selectedId && !subagents.some((s) => s.id === selectedId)) {
      setSelectedId(subagents[0]?.id ?? null);
    } else if (!selectedId && subagents.length > 0) {
      setSelectedId(subagents[0].id);
    }
  }, [selectedId, subagents]);

  const selected = useMemo(
    () => subagents.find((s) => s.id === selectedId) ?? null,
    [selectedId, subagents],
  );

  const sendDraft = useCallback(() => {
    if (!selected || !draft.trim() || !onSendToSubagent) return;
    onSendToSubagent(selected.id, draft.trim());
    setDraft("");
  }, [draft, selected, onSendToSubagent]);

  if (subagents.length === 0) {
    return (
      <section className={panelShellClass} data-testid="subagent-panel">
        <header className="flex items-center justify-between gap-2">
          <h3 className={panelTitleClass}>Subagents</h3>
          {onSpawnSubagent ? (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className={`h-7 ${btnSecondaryClass}`}
              data-testid="subagent-spawn-trigger"
            >
              + Spawn
            </button>
          ) : null}
        </header>
        <p className={`mt-3 ${emptyStateClass} p-5 text-xs text-muted-light`}>
          No subagents yet. The main agent can spawn subagents (worker / explore / planner) to handle isolated tasks.
        </p>
        {showCreate && onSpawnSubagent ? (
          <CreateSubagentDialog
            onCancel={() => setShowCreate(false)}
            onConfirm={(role, prompt) => {
              onSpawnSubagent(role, prompt);
              setShowCreate(false);
            }}
          />
        ) : null}
      </section>
    );
  }

  return (
    <section className={panelShellClass} data-testid="subagent-panel">
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className={panelTitleClass}>Subagents</h3>
          <p className="mt-0.5 text-[11px] text-muted-light">
            {subagents.length} active · parent: 1
          </p>
        </div>
        {onSpawnSubagent ? (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className={`h-7 ${btnSecondaryClass}`}
          >
            + Spawn
          </button>
        ) : null}
      </header>

      <div className="mt-3 grid gap-3 md:grid-cols-[220px_1fr]">
        {/* Left: list */}
        <ul className="max-h-72 overflow-y-auto rounded-lg border border-border bg-surface-subtle">
          {subagents.map((s) => {
            const active = s.id === selectedId;
            return (
              <li key={s.id} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={[
                    "flex w-full cursor-pointer flex-col gap-1 px-3 py-2 text-left transition-colors duration-150",
                    active ? "bg-primary-light/10" : "hover:bg-surface",
                  ].join(" ")}
                  data-testid={`subagent-row-${s.id}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-foreground">
                      {s.role}
                    </span>
                    <StatusPill status={s.status} />
                  </div>
                  <p className="line-clamp-2 text-[11px] leading-4 text-muted">
                    {s.prompt}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-muted-light">
                    <span className={chipClass}>{s.stats.toolCalls} tools</span>
                    <span className={chipClass}>{s.stats.tokens} tok</span>
                    <span className={chipClass}>
                      {s.stats.durationMs > 0 ? `${Math.round(s.stats.durationMs / 100) / 10}s` : "—"}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Right: chat */}
        <div className="min-w-0 rounded-lg border border-border bg-surface">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                <div className="min-w-0">
                  <div className={sectionLabelClass}>{selected.role}</div>
                  <p className="mt-0.5 truncate text-xs font-medium text-foreground">
                    {selected.prompt}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {selected.status === "running" && onPauseSubagent ? (
                    <button
                      type="button"
                      onClick={() => onPauseSubagent(selected.id)}
                      className={`h-7 ${btnGhostClass}`}
                      data-testid="subagent-pause"
                    >
                      Pause
                    </button>
                  ) : null}
                  {selected.status === "paused" && onResumeSubagent ? (
                    <button
                      type="button"
                      onClick={() => onResumeSubagent(selected.id)}
                      className={`h-7 ${btnGhostClass}`}
                      data-testid="subagent-resume"
                    >
                      Resume
                    </button>
                  ) : null}
                  {(selected.status === "running" || selected.status === "paused" || selected.status === "ready") &&
                  onCancelSubagent ? (
                    <button
                      type="button"
                      onClick={() => onCancelSubagent(selected.id)}
                      className={`h-7 ${btnGhostClass} text-step-error`}
                      data-testid="subagent-cancel"
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
              </div>

              <div
                className="max-h-72 min-h-32 overflow-y-auto px-3 py-2"
                data-testid="subagent-history"
              >
                {selected.history.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border bg-surface-subtle px-3 py-3 text-center text-[11px] text-muted-light">
                    No conversation yet. Send a message below to steer this subagent.
                  </p>
                ) : (
                  <ul className="grid gap-2">
                    {selected.history.map((msg) => (
                      <MessageBubble key={msg.id} message={msg} />
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex gap-2 border-t border-border bg-surface-subtle px-3 py-2">
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendDraft();
                    }
                  }}
                  placeholder="Send a message to this subagent…"
                  disabled={!onSendToSubagent || selected.status === "completed" || selected.status === "failed" || selected.status === "cancelled"}
                  className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 text-xs text-foreground outline-none focus:border-primary-light disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="subagent-input"
                />
                <button
                  type="button"
                  onClick={sendDraft}
                  disabled={!draft.trim() || selected.status === "completed"}
                  className={`h-8 ${btnPrimaryClass} disabled:cursor-not-allowed disabled:opacity-60`}
                  data-testid="subagent-send"
                >
                  Send
                </button>
              </div>
            </>
          ) : (
            <p className="p-4 text-xs text-muted-light">Select a subagent to view its conversation.</p>
          )}
        </div>
      </div>

      {showCreate && onSpawnSubagent ? (
        <CreateSubagentDialog
          onCancel={() => setShowCreate(false)}
          onConfirm={(role, prompt) => {
            onSpawnSubagent(role, prompt);
            setShowCreate(false);
          }}
        />
      ) : null}
    </section>
  );
}

function MessageBubble({ message }: { message: SubagentMessageLite }) {
  const tone =
    message.role === "user"
      ? "bg-primary-light/10 text-foreground"
      : message.role === "system"
        ? "bg-surface-subtle text-muted-light italic"
        : "bg-surface border border-border text-muted";
  const label = message.role === "user" ? "You" : message.role === "system" ? "system" : "subagent";
  return (
    <li className={["rounded-md px-2.5 py-1.5 text-xs leading-5", tone].join(" ")}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-light">
        {label}
      </div>
      <p className="mt-0.5 whitespace-pre-wrap">{message.text}</p>
    </li>
  );
}

function CreateSubagentDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (role: SubagentRole, prompt: string) => void;
}) {
  const [role, setRole] = useState<SubagentRole>("worker");
  const [prompt, setPrompt] = useState("");
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm"
      data-testid="subagent-create-dialog"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-4 shadow-2xl">
        <h3 className="text-sm font-semibold text-foreground">Spawn subagent</h3>
        <p className="mt-1 text-xs text-muted-light">
          Subagent runs in an isolated context. Pick a role and describe the task.
        </p>
        <div className="mt-3 grid gap-2">
          <label className="grid gap-1">
            <span className="text-[11px] font-medium text-muted">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as SubagentRole)}
              className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-foreground"
            >
              <option value="worker">worker</option>
              <option value="explore">explore (read-only)</option>
              <option value="planner">planner</option>
              <option value="reviewer">reviewer</option>
              <option value="general-purpose">general-purpose</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] font-medium text-muted">Prompt</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary-light"
              placeholder="Describe what this subagent should do…"
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className={`h-8 ${btnSecondaryClass}`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(role, prompt.trim())}
            disabled={!prompt.trim()}
            className={`h-8 ${btnPrimaryClass} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            Spawn
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Test-friendly default state factory
// ============================================================================

export function createMockSubagent(partial: Partial<SubagentLite>): SubagentLite {
  return {
    id: partial.id ?? `mock-${Math.random().toString(36).slice(2, 8)}`,
    parentId: partial.parentId ?? "main-agent",
    role: partial.role ?? "worker",
    prompt: partial.prompt ?? "explore the codebase structure",
    status: partial.status ?? "running",
    startedAt: partial.startedAt ?? Date.now(),
    history: partial.history ?? [],
    stats: partial.stats ?? { toolCalls: 0, tokens: 0, durationMs: 0 },
  };
}

export type SubagentPanelChildren = ReactNode;
