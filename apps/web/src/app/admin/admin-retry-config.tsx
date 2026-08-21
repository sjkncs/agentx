"use client";

/**
 * admin-retry-config.tsx — A16.3 投递重试策略配置面板
 *
 * 展示：
 *   - subscribe_loop retry backoff 参数（max_attempts / base_delay_s / max_delay_s / backoff_multiplier）
 *   - 当前规则表（按 channel）
 *   - 编辑按钮 → 保存到 dfd_audit_events workspace_config
 *
 * 数据来源：rpc_subscription_list_deliveries（已有 A9）
 */
import { useState } from "react";
import { useT } from "../../i18n/locale-context";

interface RetryRule {
  channel: string;
  maxAttempts: number;
  baseDelaySeconds: number;
  maxDelaySeconds: number;
  multiplier: number;
  enabled: boolean;
}

const CHANNEL_LABELS: Record<string, string> = {
  email:         "邮件",
  dingtalk:      "钉钉群机器人",
  corp_dingtalk: "钉钉企业内部",
  webhook:       "Webhook",
  sms:           "短信",
  slack:         "Slack",
};

const PRESETS: Record<string, Omit<RetryRule, "channel" | "enabled">> = {
  fast:    { maxAttempts: 3,  baseDelaySeconds: 10,  maxDelaySeconds: 60,   multiplier: 2.0 },
  standard:{ maxAttempts: 5,  baseDelaySeconds: 30,  maxDelaySeconds: 300,  multiplier: 2.0 },
  slow:    { maxAttempts: 8,  baseDelaySeconds: 60,  maxDelaySeconds: 3600, multiplier: 2.5 },
};

const CHANNELS = Object.keys(CHANNEL_LABELS);

function fmtSec(s: number): string {
  if (s < 60)  return `${s}s`;
  if (s < 3600) return `${Math.round(s/60)}m`;
  return `${Math.round(s/3600)}h`;
}

export function AdminRetryConfigPanel() {
  const t = useT();
  const [rules, setRules] = useState<RetryRule[]>(
    CHANNELS.map((channel) => ({
      channel,
      maxAttempts: 5,
      baseDelaySeconds: 30,
      maxDelaySeconds: 300,
      multiplier: 2.0,
      enabled: channel !== "email",
    })),
  );
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [editChannel, setEditChannel] = useState<string | null>(null);

  const applyPreset = (channel: string, preset: keyof typeof PRESETS) => {
    setRules((prev) =>
      prev.map((r) =>
        r.channel === channel
          ? { ...r, ...PRESETS[preset] }
          : r,
      ),
    );
  };

  const updateRule = (channel: string, patch: Partial<RetryRule>) => {
    setRules((prev) => prev.map((r) => r.channel === channel ? { ...r, ...patch } : r));
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    await new Promise((r) => setTimeout(r, 600)); // simulate
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const editing = editChannel !== null;
  const editingRule = rules.find((r) => r.channel === editChannel);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-base font-semibold text-foreground">
          {t("admin.retry.title", { defaultValue: "投递重试策略" })}
        </h2>
        <p className="mt-1 text-xs text-muted-light">
          {t("admin.retry.subtitle", { defaultValue: "A16.3 — subscribe_loop backoff 参数配置" })}
        </p>
      </header>

      {saved && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          ✓ 配置已保存（模拟 — 需后端 workspace_config 支持）
        </div>
      )}

      {/* 编辑模式 */}
      {editing && editingRule ? (
        <div className="rounded border border-blue-200 bg-blue-50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-blue-800">
              {CHANNEL_LABELS[editingRule.channel] ?? editingRule.channel} — 重试规则
            </h3>
            <button type="button" onClick={() => setEditChannel(null)}
              className="text-xs text-muted-light hover:text-foreground">
              ← 返回列表
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <label className="mb-1 block text-muted-light">最大重试次数</label>
              <input type="number" min={0} max={20}
                value={editingRule.maxAttempts}
                onChange={(e) => updateRule(editingRule.channel, { maxAttempts: Number(e.target.value) })}
                className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-foreground focus:border-blue-400 focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-muted-light">退避乘数</label>
              <input type="number" min={1} max={5} step={0.1}
                value={editingRule.multiplier}
                onChange={(e) => updateRule(editingRule.channel, { multiplier: Number(e.target.value) })}
                className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-foreground focus:border-blue-400 focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-muted-light">初始延迟（秒）</label>
              <input type="number" min={1} max={3600}
                value={editingRule.baseDelaySeconds}
                onChange={(e) => updateRule(editingRule.channel, { baseDelaySeconds: Number(e.target.value) })}
                className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-foreground focus:border-blue-400 focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-muted-light">最大延迟（秒）</label>
              <input type="number" min={1} max={86400}
                value={editingRule.maxDelaySeconds}
                onChange={(e) => updateRule(editingRule.channel, { maxDelaySeconds: Number(e.target.value) })}
                className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-foreground focus:border-blue-400 focus:outline-none" />
            </div>
          </div>

          {/* 预设 */}
          <div className="mt-3 flex gap-2">
            <span className="text-xs text-muted-light">预设：</span>
            {(["fast", "standard", "slow"] as const).map((p) => (
              <button key={p} type="button"
                onClick={() => applyPreset(editingRule.channel, p)}
                className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-muted hover:bg-slate-50">
                {p === "fast" ? "快速(3次)" : p === "standard" ? "标准(5次)" : "保守(8次)"}
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* 列表模式 */
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="w-full text-xs">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                {["Channel", "启用", "最大次数", "初始延迟", "最大延迟", "乘数", "退避序列", ""].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-light">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => {
                const seq = Array.from({ length: Math.min(rule.maxAttempts, 5) }, (_, i) => {
                  const delay = Math.min(rule.baseDelaySeconds * Math.pow(rule.multiplier, i), rule.maxDelaySeconds);
                  return fmtSec(delay);
                }).join(" → ");
                return (
                  <tr key={rule.channel} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-foreground">
                      {CHANNEL_LABELS[rule.channel] ?? rule.channel}
                    </td>
                    <td className="px-3 py-2">
                      <button type="button"
                        onClick={() => updateRule(rule.channel, { enabled: !rule.enabled })}
                        className={`inline-block h-4 w-8 rounded-full transition-colors ${
                          rule.enabled ? "bg-emerald-400" : "bg-slate-200"
                        }`}>
                        <span className={`block h-3 w-3 mx-0.5 mt-0.5 rounded-full bg-white transition-transform ${
                          rule.enabled ? "translate-x-3" : ""
                        }`} />
                      </button>
                    </td>
                    <td className="px-3 py-2 text-muted">{rule.maxAttempts}次</td>
                    <td className="px-3 py-2 text-muted">{fmtSec(rule.baseDelaySeconds)}</td>
                    <td className="px-3 py-2 text-muted">{fmtSec(rule.maxDelaySeconds)}</td>
                    <td className="px-3 py-2 font-mono text-muted">{rule.multiplier}x</td>
                    <td className="px-3 py-2 text-muted-light max-w-[200px] truncate" title={seq}>{seq}</td>
                    <td className="px-3 py-2">
                      <button type="button"
                        onClick={() => setEditChannel(rule.channel)}
                        className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-muted hover:bg-slate-50">
                        编辑
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 保存按钮 */}
      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={saving}
          className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? "保存中…" : "保存配置"}
        </button>
      </div>

      {/* 说明 */}
      <div className="rounded border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs text-muted">
          退避序列示例（乘数 2x，初始 10s，最大 60s）：<code className="rounded bg-slate-100 px-1">10s → 20s → 40s → 60s → 60s</code>
          。实际策略通过 <code className="rounded bg-slate-100 px-1">dfd_audit_events workspace_config</code> 持久化。
        </p>
      </div>
    </div>
  );
}
