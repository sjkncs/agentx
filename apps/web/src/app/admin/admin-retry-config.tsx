"use client";

/**
 * admin/admin-retry-config.tsx — STUB
 *
 * Placeholder for the "retry strategy" admin tab. Will surface
 * exponential-backoff knobs, max-attempts, dead-letter queue
 * inspection, etc.
 *
 * TODO: Extract the real retry-config implementation here.
 */

export function AdminRetryConfigPanel() {
  return (
    <div className="rounded border border-dashed border-slate-200 bg-surface-subtle px-6 py-8 text-center text-sm text-muted">
      <p className="font-medium text-foreground">Retry Strategy</p>
      <p className="mt-1 text-xs text-muted-light">
        Coming soon — 模块化拆分后此面板的实现待从 admin-home 抽出。
      </p>
    </div>
  );
}