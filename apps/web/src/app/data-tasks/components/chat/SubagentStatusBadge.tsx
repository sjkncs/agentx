"use client";

import { useEffect, useState } from "react";
import { useT } from "../../../../i18n/locale-context";
import { getSubagentInboxController } from "../../subagent-inbox-controller";
import {
  panelShellClass,
  btnGhostClass,
} from "../../ui-tokens";

/**
 * A compact cross-panel subagent status indicator.
 *
 * Shows up only when there is at least one running subagent so the user
 * has a stable, page-level cue (instead of needing to scroll to the
 * Overview tab and expand the Subagent Inbox panel).
 */
export function SubagentStatusBadge() {
  const t = useT();
  const controller = getSubagentInboxController();
  const [running, setRunning] = useState(controller.getStats().currentlyRunning);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const update = () => {
      const next = controller.getStats().currentlyRunning;
      setRunning((prev) => (prev !== next ? next : prev));
      // pulse animation when transitioning from 0 -> >0
      if (next > 0) setPulse(true);
    };
    controller.on("change", update);
    return () => {
      controller.off("change", update);
    };
  }, [controller]);

  useEffect(() => {
    if (!pulse) return;
    const id = setTimeout(() => setPulse(false), 1200);
    return () => clearTimeout(id);
  }, [pulse]);

  if (running === 0) return null;

  return (
    <span
      data-testid="subagent-status-badge"
      className={[
        "inline-flex h-7 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 text-[11px] font-medium text-primary",
        pulse ? "animate-pulse" : "",
      ].join(" ")}
      title={t("subagent.runningBadge")}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" />
      {running} {t("subagent.activeCount", { n: running })}
    </span>
  );
}

/**
 * Tiny "view inbox" pill that scrolls to the SubagentInboxPanel and expands it.
 * Used in places that mention subagents but the inbox is collapsed.
 */
export function SubagentInboxJumpPill() {
  const t = useT();
  return (
    <button
      type="button"
      data-testid="subagent-inbox-jump"
      onClick={() => {
        const panel = document.querySelector("[data-testid='subagent-inbox-panel']");
        const header = panel?.querySelector("button[aria-expanded]") as HTMLButtonElement | null;
        if (header?.getAttribute("aria-expanded") === "false") {
          header.click();
        }
        panel?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
      className={`${btnGhostClass} h-7 px-2 text-[11px]`}
    >
      {t("subagent.jumpToInbox")}
    </button>
  );
}

// Re-export so callers can use a single import.
export { panelShellClass };