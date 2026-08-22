"use client";

import React from "react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../../../../i18n/locale-context";
import {
  getSubagentInboxController,
  type InboxConversation,
  type SubagentSummary,
  type SubagentRole,
  type SubagentStatus,
} from "../../subagent-inbox-controller";
import {
  panelShellClass,
  panelTitleClass,
  sectionLabelClass,
  emptyStateClass,
  btnGhostClass,
  btnPrimaryClass,
  btnSecondaryClass,
} from "../../ui-tokens";

/**
 * Subagent Inbox Panel - per-subagent conversation panel.
 *
 * Gives the user a direct, independent window into every spawned subagent.
 * Solves the "subagents are controlled only by the main agent" gap:
 * the user can spawn, message, pause, resume, and remove subagents here.
 *
 * The component is self-contained: all browser-side state lives in
 * `SubagentInboxController` and is observed via a `change` event so SSR
 * is safe (every browser API is gated behind useEffect).
 */

const ROLE_OPTIONS: SubagentRole[] = ["worker", "explore", "planner", "general-purpose"];

const STATUS_TONE: Record<SubagentStatus, { dot: string; text: string }> = {
  running: { dot: "bg-primary-light", text: "text-primary" },
  ready: { dot: "bg-step-knowledge", text: "text-step-knowledge" },
  paused: { dot: "bg-step-warning", text: "text-step-warning" },
  completed: { dot: "bg-step-success", text: "text-step-success" },
  failed: { dot: "bg-step-error", text: "text-step-error" },
  cancelled: { dot: "bg-muted-light", text: "text-muted-light" },
};

export function SubagentInboxPanel() {
  const t = useT();
  const controller = useMemo(() => getSubagentInboxController(), []);
  const [list, setList] = useState<SubagentSummary[]>([]);
  const [stats, setStats] = useState(controller.getStats());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newPrompt, setNewPrompt] = useState("");
  const [newRole, setNewRole] = useState<SubagentRole>("worker");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const update = () => {
      setList(controller.list());
      setStats(controller.getStats());
    };
    update();
    controller.on("change", update);
    return () => {
      controller.off("change", update);
    };
  }, [controller]);

  // Auto-expand when the first subagent is spawned so the user sees the conversation.
  useEffect(() => {
    if (list.length > 0) setExpanded(true);
  }, [list.length > 0]);

  // Default to selecting the first subagent
  useEffect(() => {
    if (!selectedId && list.length > 0) {
      setSelectedId(list[0].id);
    }
  }, [list, selectedId]);

  const conversation: InboxConversation | undefined = selectedId
    ? controller.conversation(selectedId)
    : undefined;

  const submit = () => {
    const prompt = newPrompt.trim();
    if (!prompt) return;
    controller.spawn({ prompt, role: newRole });
    setNewPrompt("");
  };

  const handleInjectReply = (subId: string) => {
    controller.injectSubagentReply(
      subId,
      "[demo reply] I've completed the task you assigned.",
    );
  };

  return (
    <section data-testid="subagent-inbox-panel" className={panelShellClass}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="mb-1 flex w-full cursor-pointer items-center justify-between gap-2 rounded-md text-left transition-colors hover:bg-surface-subtle"
      >
        <span className="flex items-center gap-2">
          <h3 className={panelTitleClass}>{t("subagent.title")}</h3>
          {stats.currentlyRunning > 0 ? (
            <span
              data-testid="subagent-running-badge"
              className="inline-flex h-5 items-center rounded-full bg-primary/15 px-2 text-[10px] font-semibold text-primary"
              title={t("subagent.runningBadge")}
            >
              {stats.currentlyRunning}
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-2 text-[11px] text-muted-light">
          <span className="tabular">
            {t("subagent.statsSummary", {
              running: stats.currentlyRunning,
              total: stats.totalSpawned,
            })}
          </span>
          <span
            aria-hidden="true"
            className={[
              "inline-flex h-6 w-6 items-center justify-center rounded-md transition-transform duration-200",
              expanded ? "rotate-180" : "",
            ].join(" ")}
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="m4 6 4 4 4-4" />
            </svg>
          </span>
        </span>
      </button>

      {expanded ? (
        <>
      <div className="mb-3 grid gap-2">
        <div className="flex items-center gap-2">
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as SubagentRole)}
            className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-foreground"
            aria-label={t("subagent.role")}
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={newPrompt}
            onChange={(e) => setNewPrompt(e.target.value)}
            placeholder={t("subagent.spawnPlaceholder")}
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-xs text-foreground"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!newPrompt.trim()}
            className={`${btnPrimaryClass} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {t("subagent.spawn")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[200px_1fr] gap-3">
        <aside className="grid max-h-72 gap-1 overflow-y-auto rounded-lg border border-border bg-surface-subtle p-2">
          {list.length === 0 ? (
            <p className={`${emptyStateClass} py-3 text-center text-xs`}>{t("subagent.empty")}</p>
          ) : (
            list.map((s) => (
              <SubagentListItem
                key={s.id}
                summary={s}
                active={s.id === selectedId}
                onSelect={() => setSelectedId(s.id)}
                onPause={() => controller.pause(s.id)}
                onResume={() => controller.resume(s.id)}
                onRemove={() => controller.remove(s.id)}
              />
            ))
          )}
        </aside>

        <div className="grid min-h-72 gap-2 rounded-lg border border-border bg-surface p-3">
          {conversation ? (
            <>
              <header className="flex items-center justify-between gap-2">
                <div>
                  <div className={sectionLabelClass}>{conversation.subagentId}</div>
                  <p className="mt-1 text-[11px] text-muted-light">
                    {t("subagent.messageCount", { n: conversation.messages.length })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleInjectReply(conversation.subagentId)}
                  className={btnSecondaryClass}
                >
                  {t("subagent.injectReply")}
                </button>
              </header>
              <div className="grid max-h-72 gap-2 overflow-y-auto pr-1">
                {conversation.messages.map((m, idx) => (
                  <MessageBubble key={idx} from={m.from} body={m.body} at={m.at} />
                ))}
              </div>
              <UserInputRow
                onSend={(body) => controller.sendUserMessage(conversation.subagentId, body)}
              />
            </>
          ) : (
            <p className={`${emptyStateClass} text-center text-xs`}>{t("subagent.empty")}</p>
          )}
        </div>
      </div>
        </>
      ) : null}
    </section>
  );
}

function SubagentListItem({
  summary,
  active,
  onSelect,
  onPause,
  onResume,
  onRemove,
}: {
  summary: SubagentSummary;
  active: boolean;
  onSelect: () => void;
  onPause: () => void;
  onResume: () => void;
  onRemove: () => void;
}) {
  const tone = STATUS_TONE[summary.status] ?? STATUS_TONE.ready;
  return (
    <div
      className={[
        "rounded-md border px-2 py-1.5 text-left",
        active
          ? "border-primary bg-primary/5"
          : "border-border bg-surface hover:bg-surface-subtle",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full cursor-pointer items-center gap-2 text-left"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-xs font-medium ${tone.text}`}>{summary.role}</span>
          <span className="block truncate font-mono text-[10px] text-muted-light">
            {summary.id.slice(0, 18)}
          </span>
        </span>
      </button>
      <div className="mt-1 flex items-center gap-1">
        {summary.status === "running" ? (
          <button type="button" onClick={onPause} className={`${btnGhostClass} text-[10px]`}>
            pause
          </button>
        ) : summary.status === "paused" ? (
          <button type="button" onClick={onResume} className={`${btnGhostClass} text-[10px]`}>
            resume
          </button>
        ) : null}
        <button
          type="button"
          onClick={onRemove}
          className={`${btnGhostClass} text-[10px] text-step-error`}
        >
          remove
        </button>
      </div>
    </div>
  );
}

function MessageBubble({
  from,
  body,
  at,
}: {
  from: "user" | "subagent" | "system";
  body: string;
  at: number;
}) {
  const isUser = from === "user";
  const isSystem = from === "system";
  return (
    <div
      className={[
        "rounded-lg border px-3 py-1.5 text-xs leading-5",
        isUser
          ? "ml-6 border-primary/30 bg-primary/5 text-foreground"
          : isSystem
            ? "border-border bg-surface-subtle text-muted-light italic"
            : "mr-6 border-step-knowledge/30 bg-step-knowledge/5 text-foreground",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-light">
        <span>{from}</span>
        <span>{new Date(at).toLocaleTimeString()}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap">{body}</p>
    </div>
  );
}

function UserInputRow({ onSend }: { onSend: (body: string) => void }) {
  const t = useT();
  const [value, setValue] = useState("");
  return (
    <div className="flex items-center gap-2 border-t border-border pt-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("subagent.userInputPlaceholder")}
        className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-xs"
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) {
            onSend(value.trim());
            setValue("");
          }
        }}
      />
      <button
        type="button"
        disabled={!value.trim()}
        onClick={() => {
          if (value.trim()) {
            onSend(value.trim());
            setValue("");
          }
        }}
        className={`${btnPrimaryClass} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {t("subagent.send")}
      </button>
    </div>
  );
}
