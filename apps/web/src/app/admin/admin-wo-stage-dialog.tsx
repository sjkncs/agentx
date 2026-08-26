"use client";

/**
 * admin-wo-stage-dialog.tsx — A22.2 Stage 流转 + 升级表单
 *
 * 展示：
 *   - Stage 阶段卡（reported → triage → investigation → resolution → closed）
 *   - 当前阶段高亮，已完成阶段打勾
 *   - 每个阶段的操作按钮 + 备注输入
 *   - 升级按钮（触达 rpc_work_order_escalate）
 *   - SLA 预警banner
 *
 * 调用 RPC：
 *   - rpc_work_order_stage_advance(case_no, stage, notes, resolution, handler_id)
 *   - rpc_work_order_escalate(case_no, reason, escalate_to)
 *   - rpc_compensation_recommend (A25.2: resolution 阶段自动加载推荐)
 *   - rpc_compensation_approve  (A25.2: 确认补偿方案)
 */
import { useState, useCallback } from "react";
import { callRpc } from "./supabase-rpc";

interface StageOrder {
  id: number;
  case_no: string;
  category: string;
  sub_category: string | null;
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
  created_at: string;
}

const STAGES = [
  { key: "reported",     label: "已报告",    icon: "📋" },
  { key: "triage",      label: "分诊",       icon: "🔍" },
  { key: "investigation",label: "调查中",     icon: "⚙️" },
  { key: "resolution",   label: "补偿处理",   icon: "✅" },
  { key: "closed",      label: "已关闭",     icon: "🔒" },
];

const STAGE_ORDER: Record<string, number> = {
  reported:     0,
  triage:       1,
  investigation:2,
  resolution:   3,
  closed:       4,
};

function StageIndicator({ current }: { current: string | null }) {
  const currentIdx = current ? (STAGE_ORDER[current] ?? 0) : 0;
  return (
    <div className="flex items-center gap-0">
      {STAGES.map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={s.key} className="flex items-center">
            <div className="flex flex-col items-center">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium
                ${done   ? "bg-emerald-100 text-emerald-700" : ""}
                ${active ? "bg-blue-500 text-white" : ""}
                ${!done && !active ? "bg-slate-100 text-slate-400" : ""}`}>
                {done ? "✓" : s.icon}
              </div>
              <span className={`mt-1 whitespace-nowrap text-[10px]
                ${active ? "font-medium text-blue-600" : "text-muted-light"}`}>
                {s.label}
              </span>
            </div>
            {i < STAGES.length - 1 && (
              <div className={`mx-1 h-px w-6 ${
                done ? "bg-emerald-300" : "bg-slate-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SlaBanner({ sla_status, sla_deadline, sla_start }: {
  sla_status: string | null; sla_deadline: string | null; sla_start: string | null;
}) {
  if (!sla_deadline || !sla_start) return null;

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

  const bannerStyle = sla_status === "breached"
    ? "border-rose-200 bg-rose-50"
    : sla_status === "warning"
    ? "border-amber-200 bg-amber-50"
    : "border-emerald-200 bg-emerald-50";

  const textStyle = sla_status === "breached" ? "text-rose-700"
    : sla_status === "warning" ? "text-amber-700"
    : "text-emerald-700";

  return (
    <div className={`rounded border px-3 py-2 ${bannerStyle}`}>
      <div className="mb-1 flex items-center justify-between text-[11px] font-medium">
        <span className={textStyle}>
          {sla_status === "breached" ? "⚠ SLA 已超时！" : sla_status === "warning" ? "⚠ SLA 即将超时" : "✓ SLA 正常"}
        </span>
        <span className="text-muted-light">
          剩余 ~{remaining_h}h
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white">
        <div className={`h-full rounded-full ${barColor} transition-all`}
          style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  foreign_object_external: "外源性异物（外部）",
  foreign_object_internal: "外源性异物（内部）",
  spoilage:               "变质",
  body_discomfort:        "身体不适",
  taste_issue:            "口味问题",
  other:                  "其他",
};

interface Props {
  order: StageOrder;
  onClose: () => void;
  onUpdated: (caseNo: string) => void;
}

type StepView = "view" | "advance" | "escalate" | "compensate";

interface CompensationRec {
  ok: boolean;
  type: string;
  min_amount: number;
  max_amount: number;
  recommended_amount: number;
  severity_score: number;
  reason: string;
  description: string;
  script: string | null;
}

const COMP_TYPE_LABELS: Record<string, string> = {
  voucher:    "代金券",
  redelivery: "重新配送",
  refund:     "退款",
  apology:    "道歉",
  none:       "无补偿",
};

export function WOStageDialog({ order, onClose, onUpdated }: Props) {
  const [view, setView] = useState<StepView>("view");
  const [loading, setLoading] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  // Advance form
  const [notes,      setNotes]      = useState("");
  const [resolution,  setResolution]  = useState("");
  const [selectedStage, setSelectedStage] = useState<string>("");

  // Escalate form
  const [escalateReason, setEscalateReason] = useState("");
  const [escalateTo,     setEscalateTo]     = useState<string>("hq");

  // A25.2: Compensation form
  const [compRec,          setCompRec]          = useState<CompensationRec | null>(null);
  const [compType,         setCompType]         = useState<string>("voucher");
  const [compAmount,       setCompAmount]       = useState<string>("");
  const [compLoading,      setCompLoading]      = useState(false);

  // A25.2: Load recommendation when entering compensation mode
  const loadCompensation = useCallback(async (cat: string, subCat: string | null, risk: string) => {
    setCompLoading(true);
    try {
      const r = await callRpc<CompensationRec | null>("rpc_compensation_recommend", {
        p_category:    cat,
        p_sub_category: subCat,
        p_risk_level:  risk,
      });
      if (r && "ok" in r && r.ok && r.data) {
        setCompRec(r.data);
        if ("type" in r.data && typeof r.data.type === "string") {
          setCompType(r.data.type);
        }
        if ("recommended_amount" in r.data && r.data.recommended_amount != null) {
          setCompAmount(String(r.data.recommended_amount));
        }
      }
    } catch {
      // ignore — recommendation is optional
    } finally {
      setCompLoading(false);
    }
  }, []);

  const handleApproveCompensation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await callRpc<{ ok: boolean; error?: string }>(
        "rpc_compensation_approve",
        {
          p_case_no:             order.case_no,
          p_compensation_type:   compType,
          p_compensation_amount: compAmount ? Number(compAmount) : null,
          p_resolution:          resolution || null,
          p_handler_id:         order.handler_id,
        }
      );
      if (r.error || !r.ok) {
        setError((r as { error?: string }).error ?? "补偿审批失败");
        return;
      }
      onUpdated(order.case_no);
      onClose();
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }, [order.case_no, order.handler_id, compType, compAmount, resolution, onUpdated, onClose]);

  const currentIdx = order.stage ? (STAGE_ORDER[order.stage] ?? 0) : 0;

  const nextStages = STAGES.filter((s) => STAGE_ORDER[s.key] > currentIdx);

  const handleAdvance = useCallback(async (stage: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await callRpc<{ ok: boolean; error?: string }>(
        "rpc_work_order_stage_advance",
        {
          p_case_no:    order.case_no,
          p_stage:      stage,
          p_notes:      notes || null,
          p_resolution: resolution || null,
          p_handler_id: order.handler_id,
        }
      );
      if (r.error || !r.ok) {
        setError((r as { error?: string }).error ?? "推进失败");
        return;
      }
      onUpdated(order.case_no);
      onClose();
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }, [order.case_no, order.handler_id, notes, resolution, onUpdated, onClose]);

  const handleEscalate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await callRpc<{ ok: boolean; error?: string }>(
        "rpc_work_order_escalate",
        {
          p_case_no:     order.case_no,
          p_reason:      escalateReason || null,
          p_escalate_to: escalateTo,
        }
      );
      if (r.error || !r.ok) {
        setError((r as { error?: string }).error ?? "升级失败");
        return;
      }
      onUpdated(order.case_no);
      onClose();
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }, [order.case_no, escalateReason, escalateTo, onUpdated, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3 shrink-0">
          <div>
            <h2 className="font-mono text-sm font-semibold text-foreground">{order.case_no}</h2>
            <p className="mt-0.5 text-xs text-muted-light">
              {CATEGORY_LABELS[order.category] ?? order.category}
              <span className="ml-2 rounded bg-slate-100 px-1 text-[10px]">{order.risk_level}</span>
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface-subtle hover:text-foreground">
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* SLA Banner */}
        <div className="shrink-0 px-5 pt-3">
          <SlaBanner
            sla_status={order.sla_status}
            sla_deadline={order.sla_deadline}
            sla_start={order.sla_start}
          />
        </div>

        {/* Stage Indicator */}
        <div className="shrink-0 px-5 py-4">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-light">处理进度</p>
          <StageIndicator current={order.stage} />
        </div>

        {/* SLA Breached Escalate CTA */}
        {order.sla_status === "breached" && (
          <div className="mx-5 mb-3 shrink-0 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            SLA 已超时，建议立即升级至总部处理
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">

          {/* ── VIEW mode: 操作按钮 ──────────────────────────── */}
          {view === "view" && (
            <div className="space-y-3">
              {/* 推进按钮 */}
              {nextStages.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-foreground">推进处理阶段</p>
                  <div className="flex flex-wrap gap-2">
                    {nextStages.map((s) => (
                      <button key={s.key} type="button"
                        onClick={() => { setSelectedStage(s.key); setView("advance"); }}
                        className="flex items-center gap-1.5 rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-100">
                        <span>{s.icon}</span>
                        <span>{s.label}</span>
                        <span className="text-blue-400">→</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 升级按钮 */}
              {order.status !== "closed" && order.status !== "resolved" && (
                <div>
                  <p className="mb-2 text-xs font-medium text-foreground">升级处理</p>
                  <button type="button"
                    onClick={() => setView("escalate")}
                    className="flex items-center gap-1.5 rounded border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-100">
                    <span>⬆️</span>
                    <span>升级至总部 / 质量管理团队</span>
                  </button>
                </div>
              )}

              {/* A25.2: 确认补偿按钮（已调查完毕，进入补偿处理） */}
              {order.stage !== "resolution" && order.stage !== "closed" && (
                <div>
                  <p className="mb-2 text-xs font-medium text-foreground">补偿处理</p>
                  <button type="button"
                    onClick={() => {
                      void loadCompensation(order.category, order.sub_category ?? null, order.risk_level);
                      setSelectedStage("resolution");
                      setView("compensate");
                    }}
                    className="flex items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-100">
                    <span>✅</span>
                    <span>确认补偿方案</span>
                  </button>
                </div>
              )}

              {/* 关闭按钮 */}
              {order.status !== "closed" && order.status !== "resolved" && (
                <div>
                  <button type="button"
                    onClick={() => { setSelectedStage("closed"); setView("advance"); }}
                    className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                    标记为已关闭
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── ADVANCE mode: 推进表单 ───────────────────────── */}
          {view === "advance" && (
            <div className="space-y-4">
              <div>
                <p className="mb-1 text-xs font-medium text-foreground">
                  推进至：<span className="text-blue-600">{STAGES.find((s) => s.key === selectedStage)?.label}</span>
                </p>
                <p className="text-xs text-muted-light">请填写处理备注，方便后续追溯</p>
              </div>

              {/* 补偿结果（resolution 阶段专用） */}
              {selectedStage === "resolution" && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">补偿结果</label>
                  <input type="text" value={resolution} onChange={(e) => setResolution(e.target.value)}
                    placeholder="例如：已退款 ¥50，提供代金券 ¥100"
                    className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-light focus:border-blue-400 focus:outline-none" />
                </div>
              )}

              {/* 处理备注 */}
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">处理备注</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  placeholder="记录本次处理的调查结论、补偿方案、联系门店情况等"
                  className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-light focus:border-blue-400 focus:outline-none resize-none" />
              </div>

              {error && (
                <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div>
              )}

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setView("view")}
                  className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-muted hover:bg-slate-50">
                  取消
                </button>
                <button type="button" onClick={() => void handleAdvance(selectedStage)} disabled={loading}
                  className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                  {loading ? "处理中…" : `确认推进 → ${STAGES.find((s) => s.key === selectedStage)?.label}`}
                </button>
              </div>
            </div>
          )}

          {/* ── ESCALATE mode: 升级表单 ──────────────────────── */}
          {view === "escalate" && (
            <div className="space-y-4">
              <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                升级后工单将发送至总部 / 质量管理团队，并将 SLA 状态标记为已超时
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">升级至</label>
                <select value={escalateTo} onChange={(e) => setEscalateTo(e.target.value)}
                  className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-foreground focus:border-blue-400 focus:outline-none">
                  <option value="hq">总部食品安全团队</option>
                  <option value="quality_team">质量管理团队</option>
                  <option value="manager">区域经理</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">升级原因</label>
                <textarea value={escalateReason} onChange={(e) => setEscalateReason(e.target.value)}
                  rows={3}
                  placeholder="请描述升级原因（必填），例如：SLA超时、内部无法判断责任方..."
                  className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-light focus:border-blue-400 focus:outline-none resize-none" />
              </div>

              {error && (
                <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div>
              )}

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setView("view")}
                  className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-muted hover:bg-slate-50">
                  取消
                </button>
                <button type="button" onClick={() => void handleEscalate()} disabled={loading}
                  className="rounded bg-rose-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50">
                  {loading ? "升级中…" : "确认升级"}
                </button>
              </div>
            </div>
          )}

          {/* ── A25.2: COMPENSATE mode: 补偿审批 ───────────── */}
          {view === "compensate" && (
            <div className="space-y-4">
              <div>
                <p className="mb-1 text-xs font-medium text-foreground">
                  补偿处理：<span className="text-emerald-600">确认补偿方案</span>
                </p>
                <p className="text-xs text-muted-light">基于补偿矩阵推荐的处理方案，请确认后提交</p>
              </div>

              {/* 推荐方案卡片 */}
              {compLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-light">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600" />
                  加载推荐方案…
                </div>
              ) : compRec ? (
                <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs">
                  <div className="mb-1 font-medium text-emerald-700">推荐方案</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted">
                    <span>补偿方式</span><span className="text-emerald-800">{COMP_TYPE_LABELS[compRec.type] ?? compRec.type}</span>
                    <span>建议金额</span><span className="text-emerald-800">¥{compRec.min_amount} ~ ¥{compRec.max_amount}</span>
                    <span>推荐金额</span><span className="font-medium text-emerald-800">¥{compRec.recommended_amount}</span>
                    <span>严重程度</span><span className="text-emerald-800">{compRec.severity_score}/10</span>
                  </div>
                  <div className="mt-2 text-muted-light">{compRec.reason}</div>
                  {compRec.script && (
                    <div className="mt-2 italic text-emerald-700">话术：{compRec.script}</div>
                  )}
                </div>
              ) : null}

              {/* 补偿方式 */}
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">补偿方式 *</label>
                <select value={compType} onChange={(e) => setCompType(e.target.value)}
                  className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-foreground focus:border-blue-400 focus:outline-none">
                  {Object.entries(COMP_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              {/* 补偿金额 */}
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">补偿金额（元）</label>
                <input type="number" value={compAmount} onChange={(e) => setCompAmount(e.target.value)}
                  min="0" step="0.01"
                  placeholder="填入实际补偿金额"
                  className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-light focus:border-blue-400 focus:outline-none" />
              </div>

              {/* 处理备注 */}
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">处理备注</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="记录补偿过程、联系门店/客户情况"
                  className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-light focus:border-blue-400 focus:outline-none resize-none" />
              </div>

              {error && (
                <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div>
              )}

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setView("view")}
                  className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-muted hover:bg-slate-50">
                  取消
                </button>
                <button type="button" onClick={() => void handleApproveCompensation()} disabled={loading}
                  className="rounded bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                  {loading ? "提交中…" : "确认补偿"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
