"use client";

/**
 * admin/admin-dingtalk-template.tsx — STUB
 *
 * Placeholder for the "DingTalk message templates" admin tab. Will
 * allow editing the templates used by A9 webhook deliveries to
 * DingTalk robots (markdown / action-card variants, @-mention tokens,
 * per-work-order-type mappings).
 *
 * TODO: Extract the real dingtalk-template implementation here.
 */

export function AdminDingtalkTemplatePanel() {
  return (
    <div className="rounded border border-dashed border-slate-200 bg-surface-subtle px-6 py-8 text-center text-sm text-muted">
      <p className="font-medium text-foreground">DingTalk Templates</p>
      <p className="mt-1 text-xs text-muted-light">
        Coming soon — 模块化拆分后此面板的实现待从 admin-home 抽出。
      </p>
    </div>
  );
}