"use client";

/**
 * admin/admin-workspace-config.tsx — STUB
 *
 * Placeholder for the "workspace configuration" admin tab. Will
 * expose per-workspace settings (timezone, default language, quota,
 * feature flags).
 *
 * TODO: Extract the real workspace-config implementation here.
 */

export function AdminWorkspaceConfigPanel() {
  return (
    <div className="rounded border border-dashed border-slate-200 bg-surface-subtle px-6 py-8 text-center text-sm text-muted">
      <p className="font-medium text-foreground">Workspace Configuration</p>
      <p className="mt-1 text-xs text-muted-light">
        Coming soon — 模块化拆分后此面板的实现待从 admin-home 抽出。
      </p>
    </div>
  );
}