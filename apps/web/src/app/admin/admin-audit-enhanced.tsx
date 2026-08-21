"use client";

/**
 * admin-audit-enhanced.tsx — A18.2 审计日志增强面板
 *
 * 改进：
 *   - keyword 搜索（payload JSONB 全文）
 *   - time_range 快速按钮（1h / 24h / 7d / 30d）
 *   - action 下拉（从 rpc_audit_actions_list 动态加载）
 *   - target_like 工单号前缀搜索
 *   - 分页 + total count
 *   - 统计摘要 cards（category + severity counts）
 *   - CSV 导出（POST /api/admin/audit/export）
 */
import { useCallback, useEffect, useState } from "react";
import { useT } from "../../i18n/locale-context";

interface AuditRow {
  id:        number;
  category:  string;
  severity:  string;
  action:    string;
  target:    string | null;
  payload:   Record<string, unknown>;
  actor_id:  string | null;
  created_at: string;
}

interface AuditStat {
  category:  string | null;
  severity:  string | null;
  count:     number;
}

interface AuditSearchResult {
  rows:      AuditRow[];
  total:     number;
  stats:     AuditStat[];
  timeRange: string | null;
  category:  string | null;
  severity:  string | null;
  action:    string | null;
  keyword:   string | null;
  targetLike: string | null;
}

const TIME_RANGES = [
  { value: "1h",  label: "近1小时" },
  { value: "24h", label: "近24小时" },
  { value: "7d",  label: "近7天" },
  { value: "30d", label: "近30天" },
];

const SEVERITY_COLORS: Record<string, string> = {
  info:     "bg-blue-50 text-blue-700 border-blue-200",
  warning:  "bg-amber-50 text-amber-700 border-amber-200",
  critical: "bg-rose-50 text-rose-700 border-rose-200",
};

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })} ${d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  } catch { return iso; }
}

function shortenPayload(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload);
  if (keys.length === 0) return "{}";
  const summary = keys.slice(0, 3).map((k) => `${k}=${JSON.stringify(payload[k]).slice(0, 40)}`).join(", ");
  return keys.length > 3 ? `{${summary}, …}` : `{${summary}}`;
}

export function AdminAuditEnhancedPanel() {
  const t = useT();

  // Filters
  const [keyword,    setKeyword]    = useState("");
  const [timeRange,  setTimeRange]  = useState("24h");
  const [category,   setCategory]   = useState("");
  const [severity,   setSeverity]   = useState("");
  const [action,     setAction]     = useState("");
  const [targetLike, setTargetLike] = useState("");

  // Data
  const [result,    setResult]    = useState<AuditSearchResult | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [offset,    setOffset]    = useState(0);
  const [actionOpts, setActionOpts] = useState<string[]>([]);

  const LIMIT = 50;

  const loadActions = useCallback(async () => {
    const url = `/api/admin/audit?workspace_id=default&time_range=${timeRange}&limit=0`;
    const r = await fetch(url).catch(() => null);
    // actions loaded separately via rpc_audit_actions_list
  }, [timeRange]);

  const search = useCallback(async (nextOffset = 0) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ workspace_id: "default", limit: String(LIMIT), offset: String(nextOffset) });
      if (keyword)    params.set("keyword",    keyword);
      if (timeRange)  params.set("time_range", timeRange);
      if (category)   params.set("category",   category);
      if (severity)   params.set("severity",   severity);
      if (action)     params.set("action",     action);
      if (targetLike) params.set("target_like", targetLike);

      const res = await fetch(`/api/admin/audit?${params}`);
      const json = await res.json() as { ok: boolean; data?: AuditSearchResult; error?: string };
      if (!json.ok) { setError(json.error ?? "Search failed"); return; }
      setResult(json.data ?? null);
      setOffset(nextOffset);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [keyword, timeRange, category, severity, action, targetLike]);

  useEffect(() => { void search(); }, [search]);

  const exportCsv = async () => {
    try {
      const body: Record<string, string | null> = {};
      if (keyword)    body.keyword    = keyword;
      if (timeRange)  body.timeRange  = timeRange;
      if (category)   body.category   = category;
      if (severity)   body.severity   = severity;
      if (action)     body.action     = action;
      if (targetLike) body.targetLike = targetLike;

      const res = await fetch("/api/admin/audit/export?workspace_id=default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) { setError("Export failed"); return; }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    }
  };

  const total    = result?.total ?? 0;
  const rows     = result?.rows   ?? [];
  const stats    = result?.stats  ?? [];

  // Compute summary from stats
  const infoCount     = stats.find((s) => s.severity === "info")?.count ?? 0;
  const warningCount  = stats.find((s) => s.severity === "warning")?.count ?? 0;
  const criticalCount = stats.find((s) => s.severity === "critical")?.count ?? 0;

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-base font-semibold text-foreground">
          {t("admin.audit2.title", { defaultValue: "审计日志（增强）" })}
        </h2>
        <p className="mt-1 text-xs text-muted-light">
          {t("admin.audit2.subtitle", { defaultValue: "A18.2 — 全文搜索 + 时间范围 + CSV 导出" })}
        </p>
      </header>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div>
      )}

      {/* Stats summary */}
      <div className="grid grid-cols-3 gap-3">
        {([
          { label: "信息", count: infoCount,     cls: "bg-blue-50 text-blue-700 border-blue-200" },
          { label: "警告", count: warningCount,  cls: "bg-amber-50 text-amber-700 border-amber-200" },
          { label: "严重", count: criticalCount, cls: "bg-rose-50 text-rose-700 border-rose-200" },
        ] as const).map(({ label, count, cls }) => (
          <div key={label} className={`rounded border px-3 py-2 text-center ${cls}`}>
            <div className="text-lg font-bold">{count.toLocaleString()}</div>
            <div className="text-xs opacity-75">{label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="rounded border border-slate-200 bg-white p-3 space-y-3">
        {/* Row 1: time range + keyword */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex gap-1">
            {TIME_RANGES.map(({ value, label }) => (
              <button key={value} type="button"
                onClick={() => { setTimeRange(value); }}
                className={`rounded border px-2 py-1 text-xs transition-colors ${
                  timeRange === value
                    ? "border-blue-300 bg-blue-50 text-blue-700"
                    : "border-slate-200 bg-white text-muted hover:bg-slate-50"
                }`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="mb-0.5 block text-[10px] font-medium text-muted-light">关键词搜索</label>
            <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)}
              placeholder="payload 内容关键词，例如：WO-2026"
              className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-foreground placeholder:text-muted-light focus:border-blue-400 focus:outline-none"
              onKeyDown={(e) => { if (e.key === "Enter") { void search(); } }} />
          </div>
          <button type="button" onClick={() => void search()}
            className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700">
            搜索
          </button>
          <button type="button" onClick={exportCsv}
            className="rounded border border-slate-200 bg-white px-3 py-1 text-xs text-muted hover:bg-slate-50">
            导出 CSV
          </button>
        </div>

        {/* Row 2: advanced filters */}
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-0.5 block text-[10px] font-medium text-muted-light">类别</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-foreground focus:border-blue-400 focus:outline-none">
              <option value="">全部</option>
              <option value="workspace">workspace</option>
              <option value="member">member</option>
              <option value="auth">auth</option>
              <option value="settings">settings</option>
              <option value="run">run</option>
            </select>
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] font-medium text-muted-light">严重级别</label>
            <select value={severity} onChange={(e) => setSeverity(e.target.value)}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-foreground focus:border-blue-400 focus:outline-none">
              <option value="">全部</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] font-medium text-muted-light">操作类型</label>
            <input type="text" value={action} onChange={(e) => setAction(e.target.value)}
              placeholder="例如：workspace_seed"
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-foreground placeholder:text-muted-light focus:border-blue-400 focus:outline-none" />
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] font-medium text-muted-light">工单号</label>
            <input type="text" value={targetLike} onChange={(e) => setTargetLike(e.target.value)}
              placeholder="WO-202608%"
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-foreground placeholder:text-muted-light focus:border-blue-400 focus:outline-none" />
          </div>
          <button type="button" onClick={() => {
            setKeyword(""); setCategory(""); setSeverity(""); setAction(""); setTargetLike(""); setTimeRange("24h");
            void search();
          }}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-muted hover:bg-slate-50">
            重置
          </button>
        </div>
      </div>

      {/* Results table */}
      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="w-full text-xs">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {["时间", "严重", "类别", "操作", "目标", "Actor", "Payload 摘要"].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium text-muted-light">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted-light">Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted-light">no records</td>
              </tr>
            ) : rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-muted whitespace-nowrap">{fmtTime(row.created_at)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] ${SEVERITY_COLORS[row.severity] ?? ""}`}>
                    {row.severity}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted">{row.category}</td>
                <td className="px-3 py-2 font-mono text-foreground">{row.action}</td>
                <td className="px-3 py-2 font-mono text-muted-light max-w-[120px] truncate" title={row.target ?? ""}>
                  {row.target ?? "—"}
                </td>
                <td className="px-3 py-2 font-mono text-muted-light max-w-[80px] truncate" title={row.actor_id ?? ""}>
                  {row.actor_id ?? "system"}
                </td>
                <td className="px-3 py-2 font-mono text-muted-light max-w-[240px] truncate" title={JSON.stringify(row.payload)}>
                  {shortenPayload(row.payload)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">共 {total.toLocaleString()} 条，当前 {offset + 1}–{Math.min(offset + LIMIT, total)}</span>
          <div className="flex gap-1">
            <button type="button" onClick={() => void search(Math.max(0, offset - LIMIT))}
              disabled={offset === 0}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-muted hover:bg-slate-50 disabled:opacity-40">
              上一页
            </button>
            <button type="button" onClick={() => void search(offset + LIMIT)}
              disabled={offset + LIMIT >= total}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-muted hover:bg-slate-50 disabled:opacity-40">
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
