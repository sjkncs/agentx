"use client";

import { useState } from "react";
import { useT } from "../../../../i18n/locale-context";
import {
  btnGhostClass,
  btnPrimaryClass,
  btnSecondaryClass,
  emptyStateClass,
  panelShellClass,
  panelTitleClass,
} from "../../ui-tokens";
import { useWorkspaceAutoPermission } from "../../use-workspace-auto-permission";

/**
 * Workspace Auto-Permission control panel.
 *
 * Solves the user pain point:
 *   "I created a workspace folder but the agent still asks for permission
 *    on every write. Giving global permission is too risky."
 *
 * Offers:
 *   - Scope input (absolute path prefix)
 *   - Level selector (low / medium / high)
 *   - One-click "Auto-Elevate" button: enables + scopes + elevates in one action.
 *   - Reset to defaults.
 */
export function WorkspaceAutoPermissionPanel() {
  const t = useT();
  const {
    state,
    setEnabled,
    setScope,
    setLevel,
    reset,
    autoElevate,
  } = useWorkspaceAutoPermission();

  const [scopeInput, setScopeInput] = useState(state.scope);

  const commitScope = () => {
    if (scopeInput.trim() !== state.scope) setScope(scopeInput.trim());
  };

  const handleElevate = () => {
    const trimmed = scopeInput.trim() || state.scope;
    if (!trimmed) return;
    autoElevate(trimmed, "medium");
    setScopeInput(trimmed);
  };

  return (
    <section data-testid="workspace-auto-permission-panel" className={panelShellClass}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className={panelTitleClass}>{t("workspacePerm.title")}</h3>
        <span
          className={[
            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
            state.enabled ? "bg-step-success/15 text-step-success" : "bg-muted-light/15 text-muted-light",
          ].join(" ")}
          data-testid="workspace-perm-status"
        >
          {state.enabled ? t("workspacePerm.on") : t("workspacePerm.off")}
        </span>
      </header>

      <p className="mb-3 text-[11px] text-muted-light">{t("workspacePerm.description")}</p>

      <div className="mb-3 grid gap-2">
        <label className="grid gap-1 text-[11px] text-muted-light">
          {t("workspacePerm.scopeLabel")}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={scopeInput}
              onChange={(e) => setScopeInput(e.target.value)}
              onBlur={commitScope}
              placeholder={t("workspacePerm.scopePlaceholder")}
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 font-mono text-xs text-foreground"
            />
          </div>
        </label>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-light">
          <span>{t("workspacePerm.levelLabel")}</span>
          {(["low", "medium", "high"] as const).map((lv) => (
            <button
              key={lv}
              type="button"
              data-testid={`workspace-perm-level-${lv}`}
              onClick={() => setLevel(lv)}
              className={[
                "rounded-md border px-2 py-1 transition-colors",
                state.level === lv
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-surface text-muted-light hover:bg-surface-subtle",
              ].join(" ")}
            >
              {t(`workspacePerm.level.${lv}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="workspace-perm-toggle"
          onClick={() => setEnabled(!state.enabled)}
          className={state.enabled ? btnGhostClass : btnPrimaryClass}
        >
          {state.enabled ? t("workspacePerm.disable") : t("workspacePerm.enable")}
        </button>
        <button
          type="button"
          data-testid="workspace-perm-elevate"
          onClick={handleElevate}
          disabled={!scopeInput.trim()}
          className={`${btnSecondaryClass} disabled:cursor-not-allowed disabled:opacity-60`}
          title={t("workspacePerm.elevateHint")}
        >
          {t("workspacePerm.elevate")}
        </button>
        <button
          type="button"
          data-testid="workspace-perm-reset"
          onClick={() => {
            reset();
            setScopeInput("");
          }}
          className={btnGhostClass}
        >
          {t("workspacePerm.reset")}
        </button>
      </div>

      {state.denied.length > 0 ? (
        <p className={`${emptyStateClass} mt-3`}>
          {t("workspacePerm.deniedCount", { n: state.denied.length })}
        </p>
      ) : null}
    </section>
  );
}