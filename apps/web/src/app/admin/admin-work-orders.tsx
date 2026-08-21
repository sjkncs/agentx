"use client";

/**
 * admin-work-orders.tsx — A13 工单列表 + 事件流
 *
 * 展示：
 *   - fsf_work_orders 列表（case_no, category, risk_level, status, stage）
 *   - 工单详情 + fsf_inngest_events 事件时间线
 *   - status 更新按钮 → rpc_work_order_update_status
 */
import { useCallback, useEffect, useState } from "react";
import { useT } from "../../i18n/locale-context";
import { callRpc } from "./supabase-rpc";

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
  store_info: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  handler_id: number | null;
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
  open:         "border border-blue-200 bg-blue-50 text-blue-700",
  investigating: "border border-purple-200 bg-purple-50 text-purple-700",
  resolved:     "border border-emerald-200 bg-emerald-50 text-emerald-700",
  closed:       "border border-slate-200 bg-slate-50 text-slate-500",
  escalated:    "border border-rose-200 bg-rose-50 text-rose-700",
};

const CATEGORY_LABELS: Record<string, string> = {
  foreign_object_external:  "外源性异物（外部）",
  foreign_object_internal:  "外源性异物（内部）",
  spoilage:                 "变质",
  body_discomfort:          "身体不适",
  taste_issue:              "口味问题",
  other:                    "其他",
};

const NEXT_STATUS: Record<string, string> = {
  open:         "investigating",
  investigating:"resolved",
  resolved:     "closed",
};

export function AdminWorkOrdersPanel() {
  const t = useT();
  const [orders, setOrders] = useState<WorkOrderRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/fsf_work_orders?select=*&order=created_at.desc&limit=100`;
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
          {t("admin.workorders.subtitle", { defaultValue: "A13 — 工单列表 + 事件流" })}
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
            <button
              type="button" onClick={loadOrders} disabled={loading}
              className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-muted hover:text-foreground disabled:opacity-50"
            >
              {loading ? "…" : "Refresh"}
            </button>
          </div>
          <div className="space-y-1 max-h-[600px] overflow-y-auto">
            {orders.length === 0 ? (
              <p className="text-xs text-muted-light py-4 text-center">
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
                  <span className={`inline-block rounded px-1 py-0.5 text-[10px] ${RISK_BADGE[o.risk_level] ?? "border border-slate-200 bg-slate-50"}`}>
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
                <div className="mt-0.5 text-[10px] text-muted-light">
                  {o.created_at ? new Date(o.created_at).toLocaleDateString("zh-CN") : ""}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 详情 */}
        <div className="lg:col-span-2">
          {!selectedOrder ? (
            <div className="flex h-48 items-center justify-center rounded border border-dashed border-slate-200 text-xs text-muted-light">
              点击左侧工单查看详情
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <h3 className="font-mono text-sm font-semibold text-foreground">{selectedOrder.case_no}</h3>
                    <p className="mt-0.5 text-xs text-muted-light">{CATEGORY_LABELS[selectedOrder.category] ?? selectedOrder.category}</p>
                  </div>
                  <div className="flex gap-1">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs ${RISK_BADGE[selectedOrder.risk_level] ?? ""}`}>
                      {selectedOrder.risk_level}
                    </span>
                    <span className={`inline-block rounded px-2 py-0.5 text-xs ${STATUS_BADGE[selectedOrder.status] ?? ""}`}>
                      {selectedOrder.status}
                    </span>
                    {selectedOrder.stage && (
                      <span className="inline-block rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                        {selectedOrder.stage}
                      </span>
                    )}
                  </div>
                </div>

                <p className="text-xs text-muted">{selectedOrder.description}</p>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  {selectedOrder.sla_deadline && (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-muted-light">SLA 截止</span>
                      <span className={selectedOrder.sla_status === "breached" ? "text-rose-600 font-medium" : "text-foreground"}>
                        {new Date(selectedOrder.sla_deadline).toLocaleString("zh-CN")}
                      </span>
                    </div>
                  )}
                  {selectedOrder.store_info && (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-muted-light">门店</span>
                      <span className="text-foreground">
                        {String((selectedOrder.store_info as Record<string, unknown>).store_name ?? "") || "-"}
                      </span>
                    </div>
                  )}
                </div>

                {NEXT_STATUS[selectedOrder.status] && (
                  <button
                    type="button"
                    onClick={() => advanceStatus(selectedOrder.case_no)}
                    className="mt-3 rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
                  >
                    推进状态 → {NEXT_STATUS[selectedOrder.status]}
                  </button>
                )}
              </div>

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
                          {ev.source !== "rpc" && <span className="ml-2 rounded bg-slate-100 px-1 text-[10px] text-slate-500">{ev.source}</span>}
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
    </div>
  );
}
