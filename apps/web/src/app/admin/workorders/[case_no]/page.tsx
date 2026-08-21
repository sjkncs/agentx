"use client";

/**
 * admin/workorders/[case_no]/page.tsx — A25.3 工单详情页
 *
 * 路由: /admin/workorders/[case_no]
 *
 * 功能：
 *   - 完整 22 字段展示 + SLA 进度条
 *   - 事件时间线（来自 fsf_inngest_events）
 *   - Stage 流转按钮（WOStageDialog）
 *   - 补偿方案推荐 + 确认（CompensationPanel）
 *   - 钉钉 Markdown 卡片预览（rpc_work_order_markdown_card）
 *
 * 依赖：
 *   - rpc_work_order_list / rpc_work_order_list_events
 *   - WOStageDialog (admin-wo-stage-dialog.tsx)
 */
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useT } from "../../../../i18n/locale-context";
import { callRpc } from "../../../supabase-rpc";
import { WOStageDialog } from "../../admin-wo-stage-dialog";

interface WorkOrderRow {
  id: number;
  case_no: string;
  conversation_id: string | null;
  user_id: number;
  category: string;
  sub_category: string | null;
  description: string;
  evidence_urls: unknown[];
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
  compensation_detail: Record<string, unknown> | null;
  store_info: Record<string, unknown> | null;
  order_info: Record<string, unknown> | null;
  agent_notes: string | null;
  escalated_at: string | null;
  resolved_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  event_id: string;
  event_name: string;
  payload: Record<string, unknown>;
  source: string;
  status: string;
  created_at: string;
}

interface MarkdownCardRow {
  ok: boolean;
  title: string;
  markdown: string;
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

const STAGE_LABELS: Record<string, string> = {
  reported:     "已报告",
  triage:       "分诊",
  investigating:"调查中",
  compensating: "补偿处理",
  closed:       "已关闭",
};

const CATEGORY_LABELS: Record<string, string> = {
  foreign_object_external: "外源性异物（外部）",
  foreign_object_internal: "外源性异物（内部）",
  spoilage:               "变质",
  body_discomfort:        "身体不适",
  taste_issue:            "口味问题",
  other:                 "其他",
};

const COMP_LABELS: Record<string, string> = {
  voucher:    "代金券",
  redelivery: "重新配送",
  refund:     "退款",
  apology:    "道歉",
  none:       "无补偿",
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

function SlaBar({ sla_start, sla_deadline, sla_status }: {
  sla_start: string | null; sla_deadline: string | null; sla_status: string | null;
}) {
  if (!sla_start || !sla_deadline) return null;
  const start = new Date(sla_start).getTime();
  const end   = new Date(sla_deadline).getTime();
  const now   = Date.now();
  const total = end - start;
  const used  = now - start;
  const pct   = Math.min(100, Math.max(0, Math.round((used / total) * 100)));
  const remaining_h = Math.max(0, Math.round((end - now) / 3600000 * 10) / 10);

  const barColor = sla_status === "breached" ? "bg-rose-500"
    : sla_status === "warning" ? "bg-amber-400"
    : "bg-emerald-400";

  const label = sla_status === "breached" ? "⚠ SLA 已超时"
    : sla_status === "warning" ? `⚠ SLA 预警（剩余 ~${remaining_h}h）`
    : `✓ SLA 正常（剩余 ~${remaining_h}h）`;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-muted-light">
        <span>已用 {pct}%</span>
        <span className={sla_status === "breached" ? "font-medium text-rose-600" : ""}>{label}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function WorkOrderDetailPage() {
  const t = useT();
  const params = useParams();
  const router = useRouter();
  const caseNo = String(params?.case_no ?? "");

  const [wo,       setWo]       = useState<WorkOrderRow | null>(null);
  const [events,   setEvents]   = useState<EventRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [markdownCard, setMarkdownCard] = useState<string>("");
  const [showCard, setShowCard] = useState(false);

  const loadData = useCallback(async () => {
    if (!caseNo) return;
    setLoading(true);
    setError(null);
    try {
      // Load WO
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/fsf_work_orders` +
        `?case_no=eq.${encodeURIComponent(caseNo)}&select=*&limit=1`;
      const res = await fetch(url, {
        headers: {
          "content-type": "application/json",
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        },
      });
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        setError("工单不存在"); return;
      }
      setWo(rows[0] as WorkOrderRow);

      // Load events
      const ev = await callRpc<EventRow[]>("rpc_work_order_list_events", {
        p_work_order_id: caseNo,
        p_limit: 50,
      });
      setEvents(Array.isArray(ev) ? ev : []);

    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, [caseNo]);

  const loadMarkdownCard = useCallback(async () => {
    if (!caseNo) return;
    try {
      const r = await callRpc<MarkdownCardRow | null>("rpc_work_order_markdown_card", {
        p_case_no: caseNo,
      });
      if (r && "markdown" in r && typeof r.markdown === "string") {
        setMarkdownCard(r.markdown);
      }
    } catch {
      // ignore
    }
  }, [caseNo]);

  useEffect(() => { void loadData(); }, [loadData]);

  if (loading) return <div className="p-8 text-xs text-muted-light">加载中…</div>;
  if (error)   return <div className="p-8 text-xs text-rose-700">{error}</div>;
  if (!wo)     return null;

  const RISK_ICON  = wo.risk_level === "high" ? "🔴" : wo.risk_level === "medium" ? "🟡" : "🟢";
  const STATUS_ICON = wo.status === "escalated" ? "🚨" : wo.status === "resolved" ? "✅" : "📋";

  return (
    <div className="space-y-5">

      {/* Back + Title */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => router.back()}
          className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-muted hover:bg-slate-50 hover:text-foreground">
          ←
        </button>
        <div>
          <h2 className="font-mono text-sm font-bold text-foreground">{wo.case_no}</h2>
          <p className="text-xs text-muted-light">
            {CATEGORY_LABELS[wo.category] ?? wo.category}
            {wo.sub_category ? ` / ${wo.sub_category}` : ""}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <span className={`inline-block rounded px-2 py-0.5 text-xs ${RISK_BADGE[wo.risk_level] ?? ""}`}>
            {RISK_ICON} {wo.risk_level}
          </span>
          <span className={`inline-block rounded px-2 py-0.5 text-xs ${STATUS_BADGE[wo.status] ?? ""}`}>
            {STATUS_ICON} {wo.status}
          </span>
          {wo.stage && (
            <span className="inline-block rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
              {STAGE_LABELS[wo.stage] ?? wo.stage}
            </span>
          )}
        </div>
      </div>

      {/* SLA Bar */}
      <div className="rounded border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-xs font-medium text-foreground">SLA 状态</h3>
        <SlaBar
          sla_start={wo.sla_start}
          sla_deadline={wo.sla_deadline}
          sla_status={wo.sla_status}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button"
            onClick={() => setShowDialog(true)}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700">
            分阶段管理
          </button>
          <button type="button"
            onClick={() => { void loadMarkdownCard(); setShowCard(!showCard); }}
            className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs hover:bg-slate-50">
            {showCard ? "隐藏" : "预览"}钉钉卡片
          </button>
        </div>
      </div>

      {/* Markdown Card Preview */}
      {showCard && markdownCard && (
        <div className="rounded border border-blue-200 bg-white p-4">
          <h3 className="mb-3 text-xs font-medium text-blue-700">钉钉 Markdown 卡片预览</h3>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[11px] text-muted">
            {markdownCard}
          </pre>
        </div>
      )}

      {/* 22 Field Grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {[
          ["case_no",       "工单号",      wo.case_no],
          ["category",      "类别",        CATEGORY_LABELS[wo.category] ?? wo.category],
          ["risk_level",    "风险等级",    `${RISK_ICON} ${wo.risk_level}`],
          ["status",        "状态",        `${STATUS_ICON} ${wo.status}`],
          ["stage",         "SOP 阶段",    wo.stage ? STAGE_LABELS[wo.stage] ?? wo.stage : "—"],
          ["sla_status",    "SLA 状态",    wo.sla_status ?? "—"],
          ["sla_target",    "SLA 时限",    wo.sla_target_hours ? `${wo.sla_target_hours}h` : "—"],
          ["sla_deadline",  "SLA 截止",    fmtDate(wo.sla_deadline)],
          ["escalated_at",  "升级时间",    fmtDate(wo.escalated_at)],
          ["resolved_at",   "解决时间",    fmtDate(wo.resolved_at)],
          ["compensation",  "补偿方式",    wo.compensation_type ? COMP_LABELS[wo.compensation_type] ?? wo.compensation_type : "—"],
          ["resolution",    "处理结果",    wo.resolution ?? "—"],
          ["created_at",    "创建时间",    fmtDate(wo.created_at)],
          ["updated_at",    "更新时间",    fmtDate(wo.updated_at)],
        ].map(([key, label, val]) => (
          <div key={key as string} className="rounded border border-slate-200 bg-white p-3">
            <div className="text-[10px] text-muted-light">{label as string}</div>
            <div className="mt-0.5 text-xs text-foreground truncate">{val as string}</div>
          </div>
        ))}
      </div>

      {/* Description */}
      <div className="rounded border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-xs font-medium text-foreground">问题描述</h3>
        <p className="whitespace-pre-wrap text-xs text-muted">{wo.description}</p>
      </div>

      {/* Store + Order */}
      <div className="grid grid-cols-2 gap-4">
        {wo.store_info && (
          <div className="rounded border border-slate-200 bg-white p-4">
            <h3 className="mb-2 text-xs font-medium text-foreground">门店信息</h3>
            <div className="space-y-1 text-xs text-muted">
              {Object.entries(wo.store_info).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="shrink-0 text-muted-light">{k}:</span>
                  <span className="truncate">{String(v ?? "—")}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {wo.order_info && (
          <div className="rounded border border-slate-200 bg-white p-4">
            <h3 className="mb-2 text-xs font-medium text-foreground">订单信息</h3>
            <div className="space-y-1 text-xs text-muted">
              {Object.entries(wo.order_info).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="shrink-0 text-muted-light">{k}:</span>
                  <span className="truncate">{String(v ?? "—")}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Compensation Detail */}
      {wo.compensation_detail && (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-4">
          <h3 className="mb-2 text-xs font-medium text-emerald-700">补偿详情</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-emerald-800">
            {Object.entries(wo.compensation_detail).map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <span className="text-emerald-600">{k}:</span>
                <span>{String(v ?? "—")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Notes */}
      {wo.agent_notes && (
        <div className="rounded border border-blue-100 bg-blue-50 p-4">
          <h3 className="mb-1 text-xs font-medium text-blue-800">AI 处理备注</h3>
          <p className="whitespace-pre-wrap text-xs text-blue-700">{wo.agent_notes}</p>
        </div>
      )}

      {/* Event Timeline */}
      <div className="rounded border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-xs font-medium text-foreground">事件时间线 ({events.length})</h3>
        {events.length === 0 ? (
          <p className="text-xs text-muted-light">暂无事件记录</p>
        ) : (
          <div className="space-y-2">
            {[...events].reverse().map((ev) => (
              <div key={ev.event_id} className="flex items-start gap-2 text-xs">
                <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                  ev.event_name.includes("escalated") ? "bg-rose-400"
                  : ev.event_name.includes("resolved") ? "bg-emerald-400"
                  : "bg-blue-400"
                }`} />
                <div className="flex-1">
                  <span className="font-mono text-muted">{ev.event_name}</span>
                  <span className="ml-2 text-muted-light">{fmtDate(ev.created_at)}</span>
                  {ev.source !== "rpc" && (
                    <span className="ml-2 rounded bg-slate-100 px-1 text-[10px] text-slate-500">{ev.source}</span>
                  )}
                  {ev.status && ev.status !== "processed" && (
                    <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">{ev.status}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stage Dialog */}
      {showDialog && (
        <WOStageDialog
          order={wo}
          onClose={() => setShowDialog(false)}
          onUpdated={() => { setShowDialog(false); void loadData(); }}
        />
      )}
    </div>
  );
}
