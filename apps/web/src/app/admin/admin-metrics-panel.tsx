"use client";

/**
 * admin-metrics-panel.tsx — A26.3 SLA + WO 统计面板
 *
 * 功能：
 *   - SLA 总览（rpc_sla_summary）：breached/warning/ok count + breach_rate
 *   - SLA 趋势卡片（简化版）
 *   - WO 多维统计（rpc_sla_stats）：category × risk_level × status
 *
 * 集成：admin-home.tsx tab="metrics"
 */
import { useCallback, useEffect, useState } from "react";
import { callRpc } from "./supabase-rpc";

interface SlaSummary {
  total_open:    number;
  breached:      number;
  warning:       number;
  ok:            number;
  breach_rate:   number;
  warning_rate:  number;
  avg_breached_hours: number | null;
  warning_active: number;
  oldest_deadline: string | null;
  generated_at:  string;
}

interface SlaStatRow {
  category:    string | null;
  risk_level:  string | null;
  status:      string | null;
  stage:       string | null;
  sla_status:  string | null;
  wo_count:    number;
  breached_count: number;
  warning_count:  number;
  avg_resolution_hours: number | null;
  total_compensation_amount: number | null;
  avg_compensation_amount: number | null;
}

const RISK_COLORS: Record<string, string> = {
  high:   "bg-rose-100 text-rose-700",
  medium: "bg-amber-100 text-amber-700",
  low:    "bg-emerald-100 text-emerald-700",
};

const CATEGORY_LABELS: Record<string, string> = {
  foreign_object_external: "外源异物",
  foreign_object_internal: "内源异物",
  spoilage:               "变质",
  body_discomfort:        "身体不适",
  taste_issue:           "口味问题",
};

function fmtNum(n: number | null | undefined, suffix = ""): string {
  if (n == null) return "—";
  return suffix === "%" ? `${n}${suffix}` : n.toLocaleString("zh-CN") + suffix;
}

export function AdminMetricsPanel() {
  const [summary,    setSummary]    = useState<SlaSummary | null>(null);
  const [stats,      setStats]    = useState<SlaStatRow[]>([]);
  const [loading,    setLoading]  = useState(true);
  const [error,      setError]    = useState<string | null>(null);
  const [days,       setDays]     = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, st] = await Promise.all([
        callRpc<SlaSummary | null>("rpc_sla_summary"),
        callRpc<SlaStatRow[] | null>("rpc_sla_stats", { p_days: days }),
      ]);
      setSummary(s as SlaSummary | null);
      setStats(Array.isArray(st) ? st : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  const totalWo = summary?.total_open ?? 0;
  const breached = summary?.breached ?? 0;
  const warning  = summary?.warning  ?? 0;
  const ok       = summary?.ok       ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">SLA + 工单统计</h3>
        <div className="flex items-center gap-2">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs focus:border-blue-400 focus:outline-none">
            <option value={7}>近7天</option>
            <option value={30}>近30天</option>
            <option value={90}>近90天</option>
          </select>
          <button type="button" onClick={() => void load()} disabled={loading}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50">
            {loading ? "…" : "刷新"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div>
      )}

      {/* SLA Summary Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { label: "待处理工单", value: totalWo, cls: "border-blue-200 bg-blue-50 text-blue-700", icon: "📋" },
          { label: "已超时",    value: breached, cls: "border-rose-200 bg-rose-50 text-rose-700", icon: "⏰" },
          { label: "预警中",    value: warning,  cls: "border-amber-200 bg-amber-50 text-amber-700", icon: "⚠️" },
          { label: "正常",      value: ok,       cls: "border-emerald-200 bg-emerald-50 text-emerald-700", icon: "✅" },
          { label: "超时率",    value: fmtNum(summary?.breach_rate, "%"), cls: "border-slate-200 bg-slate-50 text-slate-700", icon: "📊" },
        ].map((card) => (
          <div key={card.label} className={`rounded border p-3 ${card.cls}`}>
            <div className="flex items-center gap-1.5 text-[10px] font-medium opacity-80">{card.icon} {card.label}</div>
            <div className="mt-1 text-2xl font-bold">{card.value}</div>
          </div>
        ))}
      </div>

      {/* SLA Health Bar */}
      {totalWo > 0 && (
        <div className="rounded border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-light">
            <span>工单 SLA 健康度</span>
            <span>{fmtNum(summary?.breach_rate, "%")} 超时</span>
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full">
            <div className="bg-rose-400 transition-all" style={{ width: `${summary?.breach_rate ?? 0}%` }} />
            <div className="bg-amber-400 transition-all" style={{ width: `${summary?.warning_rate ?? 0}%` }} />
            <div className="bg-emerald-400 transition-all" style={{ width: `${100 - (summary?.breach_rate ?? 0) - (summary?.warning_rate ?? 0)}%` }} />
          </div>
          <div className="mt-2 flex gap-4 text-[10px] text-muted-light">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-400" />超时 {fmtNum(breached)}</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" />预警 {fmtNum(warning)}</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" />正常 {fmtNum(ok)}</span>
          </div>
        </div>
      )}

      {/* Stats Table */}
      {stats.length > 0 && (
        <div className="rounded border border-slate-200">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-medium text-muted-light">
            工单统计（{days}天）/ 按类别×风险等级
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-muted-light">
                  {["类别", "风险", "状态", "SLA", "工单数", "超时", "预警", "平均处理时长(h)", "总补偿(¥)"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.slice(0, 30).map((row, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2">{CATEGORY_LABELS[row.category ?? ""] ?? row.category ?? "—"}</td>
                    <td className="px-3 py-2">
                      {row.risk_level && (
                        <span className={`inline-block rounded px-1 py-0.5 text-[10px] ${RISK_COLORS[row.risk_level] ?? ""}`}>
                          {row.risk_level}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-light">{row.status ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-light">{row.sla_status ?? "—"}</td>
                    <td className="px-3 py-2 font-medium text-foreground">{fmtNum(row.wo_count)}</td>
                    <td className="px-3 py-2">
                      {row.breached_count > 0 && (
                        <span className="rounded bg-rose-100 px-1 text-rose-700">{fmtNum(row.breached_count)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.warning_count > 0 && (
                        <span className="rounded bg-amber-100 px-1 text-amber-700">{fmtNum(row.warning_count)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-light">{fmtNum(row.avg_resolution_hours, "h")}</td>
                    <td className="px-3 py-2 text-muted-light">¥{fmtNum(row.total_compensation_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && summary && (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded border border-slate-200 bg-white p-3 text-xs">
            <div className="text-muted-light">平均超时处理时长</div>
            <div className="mt-1 text-xl font-bold text-rose-700">
              {fmtNum(summary.avg_breached_hours, "h")}
            </div>
          </div>
          <div className="rounded border border-slate-200 bg-white p-3 text-xs">
            <div className="text-muted-light">活跃预警工单</div>
            <div className="mt-1 text-xl font-bold text-amber-700">
              {fmtNum(summary.warning_active)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
