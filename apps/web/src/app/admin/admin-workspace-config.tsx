"use client";

/**
 * admin-workspace-config.tsx — A17.2 工作区配置面板
 *
 * 展示：
 *   - workspace 配置列表（rpc_workspace_config_list）
 *   - 重试策略快速编辑（per-channel max_attempts / base_delay / max_delay / multiplier）
 *   - 保存 → rpc_workspace_config_set
 *
 * 数据流：
 *   GET  rpc_workspace_config_list('default') → 渲染配置
 *   POST rpc_workspace_config_set(key, value) → 保存
 */
import { useCallback, useEffect, useState } from "react";
import { useT } from "../../i18n/locale-context";
import { callRpc } from "./supabase-rpc";

interface ConfigRow {
  workspace_id:  string;
  config_key:    string;
  config_value:  string;
  updated_at:    string;
}

interface RetryConfig {
  max_attempts:       number;
  base_delay_s:      number;
  max_delay_s:       number;
  backoff_multiplier: number;
}

const CHANNELS = [
  { key: "retry_dingtalk",      label: "钉钉群机器人" },
  { key: "retry_corp_dingtalk", label: "钉钉企业内部" },
  { key: "retry_webhook",       label: "Webhook" },
  { key: "retry_email",         label: "邮件" },
  { key: "retry_sms",           label: "短信" },
  { key: "retry_slack",         label: "Slack" },
];

const CHANNEL_CHANNEL_MAP: Record<string, string> = {
  "retry_dingtalk":      "dingtalk",
  "retry_corp_dingtalk": "corp_dingtalk",
  "retry_webhook":       "webhook",
  "retry_email":         "email",
  "retry_sms":           "sms",
  "retry_slack":         "slack",
};

const DEFAULT_RETRY: RetryConfig = {
  max_attempts:       5,
  base_delay_s:      30,
  max_delay_s:       300,
  backoff_multiplier: 2.0,
};

function parseRetry(raw: string | null): RetryConfig {
  if (!raw) return { ...DEFAULT_RETRY };
  try { return { ...DEFAULT_RETRY, ...JSON.parse(raw) }; }
  catch { return { ...DEFAULT_RETRY }; }
}

function backoffSeq(cfg: RetryConfig): string {
  return Array.from({ length: Math.min(cfg.max_attempts, 5) }, (_, i) => {
    const s = Math.min(cfg.base_delay_s * Math.pow(cfg.backoff_multiplier, i), cfg.max_delay_s);
    return s < 60 ? `${s}s` : `${Math.round(s/60)}m`;
  }).join(" → ");
}

export function AdminWorkspaceConfigPanel() {
  const t = useT();
  const [configs, setConfigs] = useState<Record<string, RetryConfig>>({});
  const [dirty,    setDirty]    = useState<Record<string, boolean>>({});
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await callRpc<ConfigRow[]>("rpc_workspace_config_list", { p_workspace_id: "default" });
    if (r.error) { setError(r.error); }
    else {
      const map: Record<string, RetryConfig> = {};
      for (const row of r.data ?? []) {
        if (row.config_key.startsWith("retry_")) {
          map[row.config_key] = parseRetry(row.config_value);
        }
      }
      setConfigs(map);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = (key: string, patch: Partial<RetryConfig>) => {
    setConfigs((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? DEFAULT_RETRY), ...patch },
    }));
    setDirty((prev) => ({ ...prev, [key]: true }));
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    const wsId = "default";
    let ok = true;
    for (const [key, cfg] of Object.entries(configs)) {
      if (!dirty[key]) continue;
      const r = await callRpc<{ ok: boolean }>("rpc_workspace_config_set", {
        p_workspace_id: wsId,
        p_key:          key,
        p_value:        JSON.stringify(cfg),
      });
      if (r.error || !r.data?.ok) { ok = false; setError(`${key}: save failed`); }
    }
    setSaving(false);
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 3000); }
    setDirty({});
    void load();
  };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-base font-semibold text-foreground">
          {t("admin.wsconfig.title", { defaultValue: "工作区配置" })}
        </h2>
        <p className="mt-1 text-xs text-muted-light">
          {t("admin.wsconfig.subtitle", { defaultValue: "A17.2 — 重试退避策略 + workspace 配置" })}
        </p>
      </header>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div>
      )}
      {saved && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">✓ 配置已保存</div>
      )}

      {/* 提示 */}
      <div className="rounded border border-blue-100 bg-blue-50 p-3">
        <p className="text-xs text-blue-700">
          以下配置决定 subscribe_loop 的指数退避行为。修改后实时生效（下次投递轮询读取）。
          支持 6 个 channel：钉钉机器人 / 钉钉企业 / Webhook / 邮件 / 短信 / Slack。
        </p>
      </div>

      {/* 配置表格 */}
      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="w-full text-xs">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {["Channel", "最大次数", "初始延迟(s)", "最大延迟(s)", "乘数", "退避序列预览", ""].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-light">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted-light">Loading…</td>
              </tr>
            ) : CHANNELS.map(({ key, label }) => {
              const cfg = configs[key] ?? DEFAULT_RETRY;
              return (
                <tr key={key} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-foreground">{label}</td>
                  {(["max_attempts", "base_delay_s", "max_delay_s", "backoff_multiplier"] as const).map((field) => (
                    <td key={field} className="px-3 py-2">
                      <input
                        type="number"
                        min={field === "backoff_multiplier" ? 1 : 0}
                        max={field === "max_attempts" ? 20 : undefined}
                        step={field === "backoff_multiplier" ? 0.1 : 1}
                        value={cfg[field]}
                        onChange={(e) => update(key, { [field]: Number(e.target.value) })}
                        className="w-20 rounded border border-slate-200 bg-white px-1.5 py-1 text-foreground focus:border-blue-400 focus:outline-none"
                      />
                    </td>
                  ))}
                  <td className="px-3 py-2 font-mono text-muted-light max-w-[180px] truncate" title={backoffSeq(cfg)}>
                    {backoffSeq(cfg)}
                  </td>
                  <td className="px-3 py-2">
                    {dirty[key] && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">待保存</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={load}
          className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-muted hover:bg-slate-50">
          重置
        </button>
        <button type="button" onClick={save} disabled={saving || !Object.values(dirty).some(Boolean)}
          className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? "保存中…" : "保存配置"}
        </button>
      </div>
    </div>
  );
}
