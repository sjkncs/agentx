"use client";

/**
 * admin/admin-delivery-stats.tsx — STUB
 *
 * Placeholder for the "delivery statistics" admin tab.
 * The real implementation (per-supplier / per-channel delivery
 * success-rate charts, retry-rate histograms, etc.) has not yet been
 * extracted from admin-home.tsx into this module.
 *
 * TODO: Extract the real delivery-stats implementation here. Until
 *       then this stub satisfies webpack's module resolver so
 *       `next build` succeeds.
 */

export function AdminDeliveryStatsPanel() {
  return (
    <div className="rounded border border-dashed border-slate-200 bg-surface-subtle px-6 py-8 text-center text-sm text-muted">
      <p className="font-medium text-foreground">Delivery Statistics</p>
      <p className="mt-1 text-xs text-muted-light">
        Coming soon — 模块化拆分后此面板的实现待从 admin-home 抽出。
      </p>
    </div>
  );
}