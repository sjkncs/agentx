"use client";

/**
 * admin-wo-create-dialog.tsx — A16.2 新建工单弹窗
 *
 * 展示：
 *   - 模态表单：category / description / risk_level / store_name / order_no / reporter_email
 *   - 提交 → POST /api/admin/wo
 *   - 成功后自动关闭并触发父组件 refresh
 */
import { useState } from "react";
import { useT } from "../../i18n/locale-context";

const CATEGORY_OPTIONS = [
  { value: "foreign_object_external", label: "外源性异物（外部）" },
  { value: "foreign_object_internal", label: "外源性异物（内部）" },
  { value: "spoilage",               label: "变质" },
  { value: "body_discomfort",         label: "身体不适" },
  { value: "taste_issue",             label: "口味问题" },
  { value: "other",                   label: "其他" },
];

const RISK_OPTIONS = [
  { value: "high",   label: "高风险 (2h SLA)", color: "text-rose-700" },
  { value: "medium", label: "中风险 (8h SLA)", color: "text-amber-700" },
  { value: "low",    label: "低风险 (24h SLA)", color: "text-emerald-700" },
];

interface Props {
  onClose: () => void;
  onCreated: (caseNo: string) => void;
}

export function WOCreateDialog({ onClose, onCreated }: Props) {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const [category,       setCategory]       = useState("foreign_object_external");
  const [description,   setDescription]   = useState("");
  const [riskLevel,     setRiskLevel]     = useState("medium");
  const [storeName,     setStoreName]     = useState("");
  const [orderNo,       setOrderNo]       = useState("");
  const [reporterEmail, setReporterEmail] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) { setError("请填写问题描述"); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/wo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          description,
          risk_level: riskLevel,
          store_name:   storeName   || undefined,
          order_no:     orderNo     || undefined,
          reporter_email: reporterEmail || undefined,
        }),
      });
      const json = await res.json() as { ok: boolean; error?: string; data?: { case_no: string } };
      if (!json.ok) { setError(json.error ?? "创建失败"); return; }
      onCreated(json.data?.case_no ?? "");
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            {t("admin.wo.create.title", { defaultValue: "新建工单" })}
          </h2>
          <button type="button" onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface-subtle hover:text-foreground">
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 px-5 py-4">
          {/* 风险等级 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">风险等级 *</label>
            <div className="flex gap-2">
              {RISK_OPTIONS.map((o) => (
                <button key={o.value} type="button"
                  onClick={() => setRiskLevel(o.value)}
                  className={`flex-1 rounded border px-2 py-1.5 text-xs text-center transition-colors ${
                    riskLevel === o.value
                      ? "border-blue-300 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-muted hover:bg-slate-50"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* 类别 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">问题类别 *</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-foreground focus:border-blue-400 focus:outline-none">
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* 问题描述 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">问题描述 *</label>
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="请详细描述发现的问题（产品名称、购买时间、发现异物/变质情况等）"
              className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-foreground placeholder:text-muted-light focus:border-blue-400 focus:outline-none resize-none"
            />
          </div>

          {/* 门店名称 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-light">门店名称</label>
            <input type="text" value={storeName} onChange={(e) => setStoreName(e.target.value)}
              placeholder="例如：杭州西湖店"
              className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-foreground placeholder:text-muted-light focus:border-blue-400 focus:outline-none" />
          </div>

          {/* 订单号 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-light">订单号</label>
            <input type="text" value={orderNo} onChange={(e) => setOrderNo(e.target.value)}
              placeholder="例如：ORD-2024-12345"
              className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-foreground placeholder:text-muted-light focus:border-blue-400 focus:outline-none" />
          </div>

          {/* 联系方式 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-light">联系方式</label>
            <input type="email" value={reporterEmail} onChange={(e) => setReporterEmail(e.target.value)}
              placeholder="customer@example.com"
              className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-foreground placeholder:text-muted-light focus:border-blue-400 focus:outline-none" />
          </div>

          {error && (
            <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-muted hover:bg-slate-50">
              取消
            </button>
            <button type="submit" disabled={loading}
              className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {loading ? "创建中…" : "创建工单"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
