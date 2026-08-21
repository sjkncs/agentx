"use client";

/**
 * admin-audit-enhanced-panel.tsx — A26.2 增强审计面板
 *
 * 功能：
 *   - 审计事件列表（rpc_audit_event_list）
 *   - 筛选：category / severity / days
 *   - 统计摘要（rpc_audit_summary）
 *   - 每行展开显示完整 payload JSON
 *
 * 集成：admin-home.tsx tab="audit2"
 */
import { useCallback, useEffect, useState } from "react";
import { callRpc } from "./supabase-rpc";

interface AuditRow {
  id:          bigint;
  workspace_id: string;
  actor_id:    bigint | null;
  category:    string;
  severity:    string;
  action:      string;
  target:      string;
  payload:     Record<string, unknown>;
  created_at:  string;
}

interface AuditSummary {
  action:      string;
  category:    string;
  severity:    string;
  event_count: number;
  with_actor: number;
  first_seen: string;
  last_seen:  string;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-rose-100 text-rose-700",
  warning:  "bg-amber-100 text-amber-700",
  info:     "bg-blue-100 text-blue-700",
  debug:    "bg-slate-100 text-slate-500",
};

const ACTION_ICONS: Record<string, string> = {
  "compensation.approved":  "💰",
  "escalation.created":    "🚨",
  "work_order.created":    "📋",
  "work_order.resolved":   "✅",
  "work_order.closed":     "🔒",
  "stage.advanced":        "→",
  "stage.escalated":       "⬆️",
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" });
}

export function AdminAuditEnhancedPanel() {
  const [events,      setEvents]      = useState<AuditRow[]>([]);
  const [summary,    setSummary]    = useState<AuditSummary[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [fCategory,  setFCategory]  = useState("");
  const [fSeverity,  setFSeverity]  = useState("");
  const [fDays,      setFDays]      = useState(7);
  const [expanded,   setExpanded]   = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ev, sum] = await Promise.all([
        callRpc<AuditRow[] | null>("rpc_audit_event_list", {
          p_category: fCategory || null,
          p_severity: fSeverity || null,
          p_days: fDays,
          p_limit: 100,
        }),
        callRpc<AuditSummary[] | null>("rpc_audit_summary", {
          p_days: fDays,
        }),
      ]);
      setEvents(Array.isArray(ev) ? ev : []);
      setSummary(Array.isArray(sum) ? sum : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, [fCategory, fSeverity, fDays]);

  useEffect(() => { void load(); }, [load]);

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">审计日志（增强）</h3>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50">
          {loading ? "…" : "刷新"}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-light">类别</label>
          <select value={fCategory} onChange={(e) => setFCategory(e.target.value)}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs focus:border-blue-400 focus:outline-none">
            <option value="">全部</option>
            <option value="fsf_work_order">工单</option>
            <option value="compensation">补偿</option>
            <option value="escalation">升级</option>
            <option value="auth">认证</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-light">严重性</label>
          <select value={fSeverity} onChange={(e) => setFSeverity(e.target.value)}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs focus:border-blue-400 focus:outline-none">
            <option value="">全部</option>
            <option value="critical">严重</option>
            <option value="warning">警告</option>
            <option value="info">信息</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-light">时间范围</label>
          <select value={fDays} onChange={(e) => setFDays(Number(e.target.value))}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs focus:border-blue-400 focus:outline-none">
            <option value={1}>最近1天</option>
            <option value={7}>最近7天</option>
            <option value={30}>最近30天</option>
            <option value={90}>最近90天</option>
          </select>
        </div>
      </div>

      {/* Summary badges */}
      {summary.length > 0 && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {summary.slice(0, 4).map((s, i) => (
            <div key={i} className="rounded border border-slate-200 bg-white p-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span>{ACTION_ICONS[s.action] ?? "📌"}</span>
                <span className="font-medium text-foreground">{s.action}</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-2xl font-bold text-foreground">{s.event_count}</span>
                <span className={`rounded px-1 text-[10px] ${SEVERITY_COLORS[s.severity] ?? ""}`}>
                  {s.severity}
                </span>
              </div>
              <div className="mt-1 text-muted-light">最后: {fmtDate(s.last_seen)}</div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div>
      )}

      {/* Event list */}
      <div className="space-y-1">
        {loading ? (
          <div className="py-6 text-center text-xs text-muted-light">加载中…</div>
        ) : events.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-light">暂无审计记录</div>
        ) : events.map((ev) => (
          <div key={ev.id} className="rounded border border-slate-200 bg-white">
            <button type="button"
              onClick={() => toggleExpand(Number(ev.id))}
              className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50">
              <div className="flex items-center gap-2">
                <span className="text-base">{ACTION_ICONS[ev.action] ?? "📌"}</span>
                <div>
                  <span className="font-mono text-xs font-medium text-foreground">{ev.action}</span>
                  <span className="ml-2 text-[10px] text-muted-light">{ev.category}</span>
                  {ev.target && (
                    <span className="ml-2 rounded bg-slate-100 px-1 text-[10px] text-muted">{ev.target}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {ev.severity && (
                  <span className={`rounded px-1 text-[10px] ${SEVERITY_COLORS[ev.severity] ?? ""}`}>
                    {ev.severity}
                  </span>
                )}
                <span className="text-[10px] text-muted-light">{fmtDate(ev.created_at)}</span>
                <span className="text-muted-light">{expanded.has(Number(ev.id)) ? "▲" : "▼"}</span>
              </div>
            </button>

            {expanded.has(Number(ev.id)) && ev.payload && (
              <div className="border-t border-slate-100 bg-slate-50 px-3 py-2">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-muted">
                  {Object.entries(ev.payload).map(([k, v]) => (
                    <div key={k} className="flex gap-1">
                      <span className="shrink-0 font-medium">{k}:</span>
                      <span className="truncate">{JSON.stringify(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
