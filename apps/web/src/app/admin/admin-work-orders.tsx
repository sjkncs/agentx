"use client";

/**
 * admin-work-orders.tsx — A13/A15 工单管理面板
 *
 * 展示：
 *   - fsf_work_orders 列表（case_no, category, risk_level, status, stage）
 *   - 工单详情（22字段 + 补偿 + SLA 可视化 + 事件时间线）
 *   - status 推进按钮 → rpc_work_order_update_status
 *
 * A15 扩展：
 *   - 完整 22 字段详情
 *   - compensation_type + compensation_detail
 *   - SLA 进度条（elapsed/remaining）
 *   - order_info + evidence_urls
 *   - escalated_at / resolved_at 时间戳
 */
import { useCallback, useEffect, useState } from "react";
import { useT } from "../../i18n/locale-context";
import { callRpc } from "./supabase-rpc";
import { WOCreateDialog } from "./admin-wo-create-dialog";
import { WOStageDialog } from "./admin-wo-stage-dialog";

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
  handler_id: number | null;
  resolution: string | null;
  compensation_type: string | null;
  compensation_detail: Record<string, unknown> | null;
  sla_deadline: string | null;
  sla_start: string | null;
  sla_status: string | null;
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

const NEXT_STATUS: Record<string, string> = {
  open:          "investigating",
  investigating:  "resolved",
  resolved:      "closed",
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
  const barColor = sla_status === "breached" ? "bg-rose-500"
    : sla_status === "warning" ? "bg-amber-400"
    : "bg-emerald-400";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] text-muted-light">
        <span>已用 {pct}%</span>
        <span className={sla_status === "breached" ? "text-rose-600 font-medium" : ""}>
          {sla_status === "breached" ? "⚠ SLA 已超时" : sla_status === "warning" ? "⚠ SLA 预警" : "✓ SLA 正常"}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function AdminWorkOrdersPanel() {
  const t = useT();
  const [orders, setOrders] = useState<WorkOrderRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [stageOrder, setStageOrder] = useState<WorkOrderRow | null>(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/fsf_work_orders` +
        `?select=*&order=created_at.desc&limit=100`;
      const res = await fetch(url, {
        headers: {
          "content-type": "application/json",
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        },
      });
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const rows = await res.json();
      setOrders(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, []);

  const loadEvents = useCallback(async (caseNo: string) => {
    const r = await callRpc<EventRow[]>("rpc_work_order_list_events", {
      p_work_order_id: caseNo,
      p_limit: 50,
    });
    if (r.data) setEvents(r.data);
    else setEvents([]);
  }, []);

  useEffect(() => { void loadOrders(); }, [loadOrders]);

  const selectOrder = (caseNo: string) => {
    setSelected(caseNo);
    void loadEvents(caseNo);
  };

  const handleCreated = (caseNo: string) => {
    setShowCreate(false);
    if (caseNo) { setSelected(caseNo); }
    void loadOrders();
  };

  const advanceStatus = async (caseNo: string) => {
    const next = NEXT_STATUS[orders.find((o) => o.case_no === caseNo)?.status ?? ""];
    if (!next) return;
    const r = await callRpc<{ ok: boolean }>("rpc_work_order_update_status", {
      p_case_no: caseNo,
      p_status: next,
    });
    if (r.ok) void loadOrders();
  };

  const selectedOrder = orders.find((o) => o.case_no === selected);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-base font-semibold text-foreground">
          {t("admin.workorders.title", { defaultValue: "食品安全工单" })}
        </h2>
        <p className="mt-1 text-xs text-muted-light">
          {t("admin.workorders.subtitle", { defaultValue: "A15 — 工单列表 + 完整22字段详情" })}
        </p>
      </header>

      {error ? (
        <div className="border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 列表 */}
        <div className="lg:col-span-1">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">工单列表</h3>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="rounded bg-blue-600 px-2 py-0.5 text-xs text-white hover:bg-blue-700"
              >
                + 新建
              </button>
              <button
                type="button" onClick={loadOrders} disabled={loading}
                className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-muted hover:text-foreground disabled:opacity-50"
              >
                {loading ? "…" : "Refresh"}
              </button>
            </div>
          </div>
          <div className="space-y-1 max-h-[640px] overflow-y-auto">
            {orders.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-light">
                {loading ? "Loading…" : "no work orders"}
              </p>
            ) : orders.map((o) => (
              <button
                key={o.id} type="button"
                onClick={() => selectOrder(o.case_no)}
                className={`w-full rounded border px-3 py-2 text-left text-xs transition-colors ${
                  selected === o.case_no
                    ? "border-blue-300 bg-blue-50"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-medium text-foreground">{o.case_no}</span>
                  <span className={`inline-block rounded px-1 py-0.5 text-[10px] ${RISK_BADGE[o.risk_level] ?? ""}`}>
                    {o.risk_level}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1 text-muted-light">
                  <span className="truncate">{CATEGORY_LABELS[o.category] ?? o.category}</span>
                  <span>·</span>
                  <span className={`inline-block rounded px-1 py-0.5 text-[10px] ${STATUS_BADGE[o.status] ?? ""}`}>
                    {o.status}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-light">
                  <span>{o.created_at ? new Date(o.created_at).toLocaleDateString("zh-CN") : ""}</span>
                  {o.sla_status === "breached" && <span className="text-rose-600 font-medium">SLA 超时</span>}
                  {o.sla_status === "warning"  && <span className="text-amber-600">SLA 预警</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 详情 */}
        <div className="lg:col-span-2">
          {!selectedOrder ? (
            <div className="flex h-64 items-center justify-center rounded border border-dashed border-slate-200 text-xs text-muted-light">
              点击左侧工单查看详情
            </div>
          ) : (
            <div className="space-y-4">

              {/* 基本信息 */}
              <div className="rounded border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <h3 className="font-mono text-sm font-semibold text-foreground">{selectedOrder.case_no}</h3>
                    <p className="mt-0.5 text-xs text-muted-light">
                      {CATEGORY_LABELS[selectedOrder.category] ?? selectedOrder.category}
                      {selectedOrder.sub_category ? ` / ${selectedOrder.sub_category}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs ${RISK_BADGE[selectedOrder.risk_level] ?? ""}`}>
                      {selectedOrder.risk_level}
                    </span>
                    <span className={`inline-block rounded px-2 py-0.5 text-xs ${STATUS_BADGE[selectedOrder.status] ?? ""}`}>
                      {selectedOrder.status}
                    </span>
                    {selectedOrder.stage && (
                      <span className="inline-block rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                        {STAGE_LABELS[selectedOrder.stage] ?? selectedOrder.stage}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted">{selectedOrder.description}</p>

                {/* SLA */}
                <div className="mt-3">
                  <SlaBar
                    sla_start={selectedOrder.sla_start}
                    sla_deadline={selectedOrder.sla_deadline}
                    sla_status={selectedOrder.sla_status}
                  />
                </div>

                {/* 操作按钮 */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {NEXT_STATUS[selectedOrder.status] && (
                    <button
                      type="button"
                      onClick={() => advanceStatus(selectedOrder.case_no)}
                      className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
                    >
                      推进状态 → {NEXT_STATUS[selectedOrder.status]}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setStageOrder(selectedOrder)}
                    className="rounded border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-700 hover:bg-indigo-100"
                  >
                    分阶段管理
                  </button>
                  {selectedOrder.status === "open" && (
                    <button
                      type="button"
                      onClick={() => advanceStatus(selectedOrder.case_no)}
                      className="rounded bg-rose-600 px-3 py-1.5 text-xs text-white hover:bg-rose-700"
                    >
                      升级 → escalated
                    </button>
                  )}
                </div>
              </div>

              {/* 22 字段网格 */}
              <div className="rounded border border-slate-200 bg-white p-4">
                <h4 className="mb-3 text-xs font-medium text-foreground">工单详情</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  {[
                    ["case_no",       "工单号",     selectedOrder.case_no],
                    ["user_id",       "用户 ID",    String(selectedOrder.user_id)],
                    ["handler_id",    "处理人",     selectedOrder.handler_id ? String(selectedOrder.handler_id) : "—"],
                    ["stage",         "SOP 阶段",   selectedOrder.stage ? STAGE_LABELS[selectedOrder.stage] ?? selectedOrder.stage : "—"],
                    ["created_at",    "创建时间",   fmtDate(selectedOrder.created_at)],
                    ["updated_at",    "更新时间",   fmtDate(selectedOrder.updated_at)],
                    ["escalated_at",  "升级时间",   fmtDate(selectedOrder.escalated_at)],
                    ["resolved_at",   "解决时间",   fmtDate(selectedOrder.resolved_at)],
                    ["sla_deadline",  "SLA 截止",   fmtDate(selectedOrder.sla_deadline)],
                    ["sla_status",    "SLA 状态",   selectedOrder.sla_status ?? "—"],
                    ["compensation",  "补偿方式",   selectedOrder.compensation_type ? COMP_LABELS[selectedOrder.compensation_type] ?? selectedOrder.compensation_type : "—"],
                    ["resolution",    "处理结果",   selectedOrder.resolution ?? "—"],
                  ].map(([key, label, val]) => (
                    <div key={key as string} className="flex flex-col gap-0.5">
                      <span className="text-muted-light">{label as string}</span>
                      <span className="text-foreground truncate" title={String(val)}>{val as string}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 补偿详情 */}
              {selectedOrder.compensation_detail && (
                <div className="rounded border border-slate-200 bg-white p-4">
                  <h4 className="mb-2 text-xs font-medium text-foreground">补偿详情</h4>
                  <div className="text-xs text-muted space-y-1">
                    {Object.entries(selectedOrder.compensation_detail as Record<string, unknown>).map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <span className="text-muted-light shrink-0">{k}:</span>
                        <span className="text-foreground">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 门店 + 订单信息 */}
              <div className="grid grid-cols-2 gap-4">
                {selectedOrder.store_info && (
                  <div className="rounded border border-slate-200 bg-white p-4">
                    <h4 className="mb-2 text-xs font-medium text-foreground">门店信息</h4>
                    <div className="text-xs text-muted space-y-1">
                      {Object.entries(selectedOrder.store_info as Record<string, unknown>).map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <span className="text-muted-light shrink-0">{k}:</span>
                          <span className="text-foreground truncate" title={String(v)}>{String(v ?? "—")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {selectedOrder.order_info && (
                  <div className="rounded border border-slate-200 bg-white p-4">
                    <h4 className="mb-2 text-xs font-medium text-foreground">订单信息</h4>
                    <div className="text-xs text-muted space-y-1">
                      {Object.entries(selectedOrder.order_info as Record<string, unknown>).map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <span className="text-muted-light shrink-0">{k}:</span>
                          <span className="text-foreground truncate" title={String(v)}>{String(v ?? "—")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 凭证截图 */}
              {Array.isArray(selectedOrder.evidence_urls) && selectedOrder.evidence_urls.length > 0 && (
                <div className="rounded border border-slate-200 bg-white p-4">
                  <h4 className="mb-2 text-xs font-medium text-foreground">凭证 ({selectedOrder.evidence_urls.length})</h4>
                  <div className="flex flex-wrap gap-2">
                    {(selectedOrder.evidence_urls as string[]).map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt={`凭证 ${i + 1}`}
                        className="h-16 w-16 rounded border border-slate-200 object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* AI 备注 */}
              {selectedOrder.agent_notes && (
                <div className="rounded border border-blue-100 bg-blue-50 p-4">
                  <h4 className="mb-1 text-xs font-medium text-blue-800">AI 处理备注</h4>
                  <p className="text-xs text-blue-700 whitespace-pre-wrap">{selectedOrder.agent_notes}</p>
                </div>
              )}

              {/* 事件时间线 */}
              <div className="rounded border border-slate-200 bg-white p-4">
                <h4 className="mb-3 text-xs font-medium text-foreground">事件流</h4>
                {events.length === 0 ? (
                  <p className="text-xs text-muted-light">暂无事件记录</p>
                ) : (
                  <div className="space-y-2">
                    {events.map((ev) => (
                      <div key={ev.event_id} className="flex items-start gap-2 text-xs">
                        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-blue-400" />
                        <div className="flex-1">
                          <span className="font-mono text-muted">{ev.event_name}</span>
                          <span className="ml-2 text-muted-light">{new Date(ev.created_at).toLocaleString("zh-CN")}</span>
                          {ev.source !== "rpc" && (
                            <span className="ml-2 rounded bg-slate-100 px-1 text-[10px] text-slate-500">{ev.source}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <WOCreateDialog
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}

      {stageOrder && (
        <WOStageDialog
          order={stageOrder as never}
          onClose={() => setStageOrder(null)}
          onUpdated={() => {
            setStageOrder(null);
            void loadOrders();
          }}
        />
      )}
    </div>
  );
}
