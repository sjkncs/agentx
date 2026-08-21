"use client";

/**
 * admin-delivery-stats.tsx — A15 投递统计面板
 *
 * 展示：
 *   - fsf_subscription_deliveries 投递结果（成功/失败/pending）
 *   - 按 channel / workspace / event_name 聚合统计
 *   - 失败重发按钮 → rpc_subscription_delivery_resend
 *
 * 数据来源：rpc_subscription_list_deliveries（已有 A9）
 */
import { useCallback, useEffect, useState } from "react";
import { useT } from "../../i18n/locale-context";
import { callRpc } from "./supabase-rpc";

interface DeliveryRow {
  id: number;
  subscription_id: number;
  event_id: string;
  event_name: string;
  target_channel: string;
  target_id: string;
  response_status: number;
  success: boolean;
  attempt: number;
  work_order_id: string | null;
  created_at: string;
  last_attempt_at: string | null;
}

const CHANNEL_LABELS: Record<string, string> = {
  email:         "邮件",
  dingtalk:      "钉钉群机器人",
  corp_dingtalk: "钉钉企业内部",
  slack:         "Slack",
  webhook:       "Webhook",
  sms:           "短信",
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

export function AdminDeliveryStatsPanel() {
  const t = useT();
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "success" | "failed">("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await callRpc<DeliveryRow[]>("rpc_subscription_list_deliveries", {
      p_workspace_id: "default",
      p_limit: 200,
      p_status: filter === "all" ? null : filter === "success" ? "success" : "failed",
    });
    if (r.error) {
      setError(r.error);
    } else {
      setDeliveries(r.data ?? []);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const resend = async (id: number) => {
    const r = await callRpc<{ ok: boolean }>("rpc_subscription_delivery_resend", { p_id: id });
    if (r.ok) void load();
  };

  const filtered = deliveries.filter((d) => {
    if (channelFilter !== "all" && d.target_channel !== channelFilter) return false;
    return true;
  });

  const total   = filtered.length;
  const success = filtered.filter((d) => d.success).length;
  const failed  = filtered.filter((d) => !d.success).length;

  const channels = Array.from(new Set(deliveries.map((d) => d.target_channel)));

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-base font-semibold text-foreground">
          {t("admin.delivery.title", { defaultValue: "投递统计" })}
        </h2>
        <p className="mt-1 text-xs text-muted-light">
          {t("admin.delivery.subtitle", { defaultValue: "A15 — 订阅投递结果 + 失败重发" })}
        </p>
      </header>

      {error ? (
        <div className="border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div>
      ) : null}

      {/* 统计摘要 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded border border-slate-200 bg-white p-3 text-center">
          <div className="text-xl font-semibold text-foreground">{total}</div>
          <div className="text-xs text-muted-light">总计</div>
        </div>
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-center">
          <div className="text-xl font-semibold text-emerald-700">
            {success}
            <span className="ml-1 text-xs font-normal text-emerald-600">
              ({total > 0 ? Math.round((success / total) * 100) : 0}%)
            </span>
          </div>
          <div className="text-xs text-emerald-600">成功</div>
        </div>
        <div className="rounded border border-rose-200 bg-rose-50 p-3 text-center">
          <div className="text-xl font-semibold text-rose-700">{failed}</div>
          <div className="text-xs text-rose-600">失败</div>
        </div>
      </div>

      {/* 过滤器 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-light">状态：</span>
        {(["all", "success", "failed"] as const).map((f) => (
          <button
            key={f} type="button"
            onClick={() => setFilter(f)}
            className={`rounded border px-2 py-0.5 text-xs transition-colors ${
              filter === f
                ? "border-blue-300 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-white text-muted hover:bg-slate-50"
            }`}
          >
            {f === "all" ? "全部" : f === "success" ? "成功" : "失败"}
          </button>
        ))}

        <span className="ml-3 text-xs text-muted-light">Channel：</span>
        <button type="button" onClick={() => setChannelFilter("all")}
          className={`rounded border px-2 py-0.5 text-xs ${channelFilter === "all" ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-muted"}`}>
          全部
        </button>
        {channels.map((ch) => (
          <button key={ch} type="button" onClick={() => setChannelFilter(ch)}
            className={`rounded border px-2 py-0.5 text-xs ${channelFilter === ch ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-muted"}`}>
            {CHANNEL_LABELS[ch] ?? ch}
          </button>
        ))}
      </div>

      {/* 投递记录表格 */}
      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="w-full text-xs">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {["状态", "Channel", "事件", "目标", "HTTP", "重试", "工单", "时间"].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-light">{h}</th>
              ))}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-muted-light">
                  {loading ? "Loading…" : "no delivery records"}
                </td>
              </tr>
            ) : filtered.map((d) => (
              <tr key={d.id} className={`border-b border-slate-100 ${d.success ? "" : "bg-rose-50/50"}`}>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    d.success
                      ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border border-rose-200 bg-rose-50 text-rose-700"
                  }`}>
                    {d.success ? "成功" : "失败"}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted">
                  <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">
                    {CHANNEL_LABELS[d.target_channel] ?? d.target_channel}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-muted-light">{d.event_name}</td>
                <td className="px-3 py-2 text-muted-light max-w-[120px] truncate" title={d.target_id}>
                  {d.target_id}
                </td>
                <td className="px-3 py-2">
                  <span className={d.success ? "text-emerald-600" : "text-rose-600"}>
                    {d.response_status}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-light">#{d.attempt}</td>
                <td className="px-3 py-2 font-mono text-muted-light">
                  {d.work_order_id ?? "—"}
                </td>
                <td className="px-3 py-2 text-muted-light whitespace-nowrap">
                  {fmtDate(d.last_attempt_at ?? d.created_at)}
                </td>
                <td className="px-3 py-2">
                  {!d.success && (
                    <button
                      type="button"
                      onClick={() => void resend(d.id)}
                      className="rounded border border-rose-200 bg-white px-2 py-0.5 text-[10px] text-rose-700 hover:bg-rose-50"
                    >
                      重发
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {loading && <p className="text-center text-xs text-muted-light py-4">Loading…</p>}
    </div>
  );
}
