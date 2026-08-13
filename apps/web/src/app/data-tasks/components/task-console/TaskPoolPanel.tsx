"use client";

import { useT } from "../../../../i18n/locale-context";
import type { LiveRun, SessionUsageStats } from "../../live-run-state";
import type { WorkspaceConfigItem } from "../../data-task-state";
import { IconSchedule } from "./console-icons-system";
import { MonitorPanel } from "./MonitorPanel";
import { ScheduledTasksPanel } from "./ScheduledTasksPanel";
import { SkillMarketPanel } from "./SkillMarketPanel";
import { WebSourcesPanel } from "./WebSourcesPanel";

/**
 * Unified Task Pool view: aggregates automation (scheduled tasks), capabilities
 * (skill market), live monitoring (usage/health/needs-action), and external source
 * tracing in one execution-oriented page, so skills / cron / monitor / tool
 * distribution are connected rather than scattered.
 */
export function TaskPoolPanel({
  liveRun,
  sessionUsage,
  skills,
  onToggleSkill,
}: {
  liveRun: LiveRun;
  sessionUsage: SessionUsageStats;
  skills?: WorkspaceConfigItem[];
  onToggleSkill?: (id: string) => void;
}) {
  const t = useT();

  return (
    <div data-testid="task-pool-panel" className="grid gap-4">
      <header className="flex items-center gap-2 text-muted">
        <IconSchedule size={14} />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em]">
          {t("console.tabs.pool")}
        </h3>
      </header>
      <MonitorPanel liveRun={liveRun} sessionUsage={sessionUsage} />
      <ScheduledTasksPanel />
      {skills && onToggleSkill ? (
        <SkillMarketPanel skills={skills} onToggle={onToggleSkill} />
      ) : null}
      <WebSourcesPanel liveRun={liveRun} />
    </div>
  );
}
