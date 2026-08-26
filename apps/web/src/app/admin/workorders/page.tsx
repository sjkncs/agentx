"use client";

export const dynamic = "force-dynamic";

/**
 * admin/workorders/page.tsx — A25.3 工单管理完整页面
 *
 * 路由: /admin/workorders
 *
 * 功能：
 *   - 工单列表（SLA 优先级排序：breached > warning > escalated > open）
 *   - 筛选：category / risk_level / status / sla_status
 *   - 快速升级按钮（触发 rpc_work_order_escalate）
 *   - 点击工单 → 跳转 /admin/workorders/[case_no]
 *
 * 依赖：rpc_work_order_list（已含 SLA 优先级排序）
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "../../../i18n/locale-context";
import { callRpc } from "../supabase-rpc";
import { WOStageDialog } from "../admin-wo-stage-dialog";

interface WorkOrderRow {
  id: number;
  case_no: string;
  category: string;
  sub_category: string | null;
  description: string;
  risk_level: string;
  status: string;
  stage: string | null;
  sla_status: string | null;
  sla_deadline: string | null;
  sla_start: string | null;
  sla_target_hours: number | null;
  handler_id: number | null;
  resolution: string | null;
  compensation_type: string | null;
  escalated_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  event_count: number;
}

const RISK_BADGE: Record<string, string> = {
  high:   "border border-rose-200 bg-rose-50 text-rose-700",
  medium: "border border-amber-200 bg-amber-50 text-amber-700",
  low:    "border border-emerald-200 bg-emerald-50 text-emerald-700",
};

const STATUS_BADGE: Record<string, string> = {
  open:          "border border-blue-200 bg-blue-50 text-blue-700",
  investigating: "border border-purple-200 bg-purple-50 text-purple-700",
  resolved:      "border border-emerald-200 bg-emerald-50 text-emerald-700",
  closed:        "border border-slate-200 bg-slate-50 text-slate-500",
  escalated:     "border border-rose-200 bg-rose-50 text-rose-700",
};

const CATEGORY_LABELS: Record<string, string> = {
  foreign_object_external: "外源异物",
  foreign_object_internal: "内源异物",
  spoilage:               "变质",
  body_discomfort:        "身体不适",
  taste_issue:            "口味问题",
  other:                  "其他",
};

function SlaTag({ sla_status }: { sla_status: string | null }) {
  if (!sla_status || sla_status === "ok") return null;
  return (
    <span className={`ml-1 rounded px-1 text-[10px] font-medium ${
      sla_status === "breached" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"
    }`}>
      {sla_status === "breached" ? "超时" : "预警"}
    </span>
  );
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" });
}

const FILTERS_CATEGORY = [
  { value: "", label: "全部类别" },
  { value: "foreign_object_external", label: "外源异物" },
  { value: "foreign_object_internal", label: "内源异物" },
  { value: "spoilage",               label: "变质" },
  { value: "body_discomfort",        label: "身体不适" },
  { value: "taste_issue",            label: "口味问题" },
];

const FILTERS_STATUS = [
  { value: "", label: "全部状态" },
  { value: "open",          label: "待处理" },
  { value: "investigating", label: "调查中" },
  { value: "escalated",    label: "已升级" },
  { value: "resolved",      label: "已解决" },
  { value: "closed",        label: "已关闭" },
];

const FILTERS_SLA = [
  { value: "", label: "全部 SLA" },
  { value: "breached", label: "已超时" },
  { value: "warning",  label: "预警中" },
  { value: "ok",       label: "正常" },
];

export default function WorkOrdersPage() {
  const t = useT();
  const router = useRouter();

  const [orders,   setOrders]   = useState<WorkOrderRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [stageRow, setStageRow] = useState<WorkOrderRow | null>(null);

  // Filters
  const [fCategory, setFCategory] = useState("");
  const [fStatus,   setFStatus]   = useState("");
  const [fSla,      setFSla]      = useState("");

  // Summary counts
  const [stats, setStats] = useState<Record<string, number>>({});

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await callRpc<WorkOrderRow[] | null>("rpc_work_order_list", {
        p_category:   fCategory || null,
        p_status:    fStatus || null,
        p_limit:     200,
      });
      let rows: WorkOrderRow[] = [];
      if (r && Array.isArray(r)) rows = r;
      else if (r && typeof r === "object" && "rows" in r) {
        rows = (r as { rows: WorkOrderRow[] }).rows;
      }
      // Client-side SLA filter
      if (fSla) rows = rows.filter((o) => o.sla_status === fSla);
      setOrders(rows);

      // Summary
      const s: Record<string, number> = {};
      for (const o of rows) {
        s[o.sla_status ?? "ok"] = (s[o.sla_status ?? "ok"] ?? 0) + 1;
      }
      setStats(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, [fCategory, fStatus, fSla]);

  useEffect(() => { void loadOrders(); }, [loadOrders]);

  const handleEscalate = async (caseNo: string) => {
    const r = await callRpc<{ ok: boolean }>("rpc_work_order_escalate", {
      p_case_no:     caseNo,
      p_reason:      "管理员快速升级",
      p_escalate_to: "hq",
    });
    if (r?.ok) void loadOrders();
  };

  const summaryBadges = [
    { label: "已超时", count: stats["breached"] ?? 0, cls: "bg-rose-100 text-rose-700" },
    { label: "预警",   count: stats["warning"]  ?? 0, cls: "bg-amber-100 text-amber-700" },
    { label: "已升级", count: (stats[""] ?? 0) + (orders.filter((o) => o.status === "escalated").length), cls: "bg-purple-100 text-purple-700" },
    { label: "总计",   count: orders.length, cls: "bg-slate-100 text-slate-700" },
  ];

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-base font-semibold text-foreground">
          {t("admin.workorders.title", { defaultValue: "食品安全工单" })}
        </h2>
        <p className="mt-1 text-xs text-muted-light">
          SLA 优先级排序 · breached &gt; warning &gt; escalated &gt; open
        </p>
      </header>

      {/* Summary badges */}
      <div className="flex flex-wrap gap-2">
        {summaryBadges.map((b) => (
          <div key={b.label} className={`rounded px-3 py-1 text-xs font-medium ${b.cls}`}>
            {b.label} <span className="ml-1">{b.count}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-light">类别</label>
          <select value={fCategory} onChange={(e) => setFCategory(e.target.value)}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs focus:border-blue-400 focus:outline-none">
            {FILTERS_CATEGORY.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-light">状态</label>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs focus:border-blue-400 focus:outline-none">
            {FILTERS_STATUS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-light">SLA</label>
          <select value={fSla} onChange={(e) => setFSla(e.target.value)}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs focus:border-blue-400 focus:outline-none">
            {FILTERS_SLA.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <button type="button" onClick={loadOrders} disabled={loading}
          className="ml-auto rounded border border-slate-200 bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50">
          {loading ? "…" : "刷新"}
        </button>
      </div>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-muted-light">
              {["工单号", "类别", "风险", "SLA状态", "处理状态", "创建时间", "SLA截止", "操作"].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-light">加载中…</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-light">暂无工单</td></tr>
            ) : orders.map((o) => (
              <tr key={o.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <button type="button"
                    onClick={() => router.push(`/admin/workorders/${o.case_no}`)}
                    className="font-mono text-blue-600 hover:underline">
                    {o.case_no}
                  </button>
                </td>
                <td className="px-3 py-2">
                  {CATEGORY_LABELS[o.category] ?? o.category}
                  {o.sub_category ? <span className="ml-1 text-muted-light">/ {o.sub_category}</span> : null}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-1 py-0.5 text-[10px] ${RISK_BADGE[o.risk_level] ?? ""}`}>
                    {o.risk_level}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-1 py-0.5 text-[10px] ${
                    o.sla_status === "breached" ? "bg-rose-100 text-rose-700"
                    : o.sla_status === "warning" ? "bg-amber-100 text-amber-700"
                    : "bg-emerald-100 text-emerald-700"
                  }`}>
                    {o.sla_status ?? "—"}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-1 py-0.5 text-[10px] ${STATUS_BADGE[o.status] ?? ""}`}>
                    {o.status}
                  </span>
                  <SlaTag sla_status={o.sla_status} />
                </td>
                <td className="px-3 py-2 text-muted-light">{fmtDate(o.created_at)}</td>
                <td className="px-3 py-2 text-muted-light">{fmtDate(o.sla_deadline)}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <button type="button"
                      onClick={() => router.push(`/admin/workorders/${o.case_no}`)}
                      className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] hover:bg-slate-50">
                      详情
                    </button>
                    {o.status !== "closed" && o.status !== "resolved" && (
                      <button type="button"
                        onClick={() => void handleEscalate(o.case_no)}
                        className="rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-700 hover:bg-rose-100">
                        升级
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Stage Dialog */}
      {stageRow && (
        <WOStageDialog
          order={stageRow}
          onClose={() => setStageRow(null)}
          onUpdated={() => { setStageRow(null); void loadOrders(); }}
        />
      )}
    </div>
  );
}
