/**
 * event-names.ts — A10 已知事件名常量 + 渠道枚举
 * 前端下拉 / 订阅 form 用。
 */
export const EVENT_NAMES = [
  "compensation.generate",
  "escalation.dispatch",
  "work_order.status_change",
  "notification.dispatch",
  "script.render",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export const CHANNEL_NAMES = [
  "dingtalk",
  "wechat",
  "email",
  "sms",
  "webhook",
] as const;

export type ChannelName = (typeof CHANNEL_NAMES)[number];

export const EVENT_LABELS: Record<EventName, string> = {
  "compensation.generate": "补偿物料生成",
  "escalation.dispatch": "升级处理调度",
  "work_order.status_change": "工单状态变更",
  "notification.dispatch": "通知分发",
  "script.render": "脚本渲染",
};

export const CHANNEL_LABELS: Record<ChannelName, string> = {
  dingtalk: "钉钉机器人",
  wechat: "企业微信",
  email: "邮件",
  sms: "短信",
  webhook: "HTTP Webhook",
};
