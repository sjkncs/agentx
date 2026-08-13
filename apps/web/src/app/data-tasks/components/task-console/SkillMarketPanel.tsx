"use client";

import { useT } from "../../../../i18n/locale-context";
import type { WorkspaceConfigItem } from "../../data-task-state";
import { IconSkill } from "./console-icons-system";

/**
 * Skill Market panel: lists installed / built-in skills with their enabled state
 * and a quick enable/disable toggle. Reuses the workspace config skill store.
 */
export function SkillMarketPanel({
  skills,
  onToggle,
}: {
  skills: WorkspaceConfigItem[];
  onToggle: (id: string) => void;
}) {
  const t = useT();

  return (
    <section data-testid="skill-market-panel" className="grid gap-3">
      <header className="flex items-center gap-2 text-muted">
        <IconSkill size={14} />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em]">
          {t("market.title")}
        </h3>
      </header>

      {skills.length === 0 ? (
        <p className="text-[11px] text-muted-light">{t("slash.empty")}</p>
      ) : (
        <ul className="grid gap-1.5">
          {skills.map((skill) => (
            <li
              key={skill.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface-subtle p-2"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary-light/20 text-primary">
                <IconSkill size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-medium text-foreground">
                    {skill.name || skill.id}
                  </span>
                  {skill.builtin ? (
                    <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted-light">
                      {t("market.builtin")}
                    </span>
                  ) : null}
                </div>
                {skill.description ? (
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-muted">{skill.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onToggle(skill.id)}
                className={[
                  "shrink-0 cursor-pointer rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors",
                  skill.enabled
                    ? "bg-step-success/15 text-step-success"
                    : "bg-surface text-muted-light",
                ].join(" ")}
              >
                {skill.enabled ? t("market.enabled") : t("market.enable")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
