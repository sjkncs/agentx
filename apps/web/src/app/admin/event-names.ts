/**
 * admin/event-names.ts
 *
 * Shared constants for the Webhooks / Event Subscriptions panel
 * (admin-webhooks-panel.tsx) and any future event-aware surface.
 *
 * The authoritative event names live in the database
 * (`fsf_event_subscriptions.event_name`), populated by application code
 * via Supabase RPCs. This module is a *fallback* so the Admin UI can
 * render the create-subscription <select> before the database has any
 * rows.
 *
 * TODO: Replace these with a client-side fetch
 *       (rpc_event_subscription_event_list or similar) once the
 *       corresponding RPC is published. Until then, hardcoded defaults
 *       keep the Webhooks tab from crashing on an empty database.
 */

export const EVENT_NAMES: readonly string[] = [
  "fsf.work_order.created",
  "fsf.work_order.stage_changed",
  "fsf.work_order.completed",
  "fsf.alert.raised",
] as const;

export const CHANNEL_NAMES: readonly string[] = [
  "webhook",
  "dingtalk",
  "email",
] as const;

export const EVENT_LABELS: Record<string, string> = {
  "fsf.work_order.created": "工单创建",
  "fsf.work_order.stage_changed": "工单阶段变更",
  "fsf.work_order.completed": "工单完成",
  "fsf.alert.raised": "告警触发",
};

export const CHANNEL_LABELS: Record<string, string> = {
  webhook: "Webhook",
  dingtalk: "钉钉",
  email: "邮件",
};