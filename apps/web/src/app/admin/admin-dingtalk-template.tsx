"use client";

/**
 * admin-dingtalk-template.tsx — A17.4 钉钉消息模板管理
 *
 * 展示：
 *   - 预设消息模板列表（markdown/card/text）
 *   - 模板预览（渲染后的 markdown）
 *   - 新建 / 编辑 / 删除模板
 *   - 关联订阅按钮（跳转到 webhooks tab）
 *
 * 数据来源：local state（模板存储在 localStorage + workspace config）
 */
import { useState } from "react";
import { useT } from "../../i18n/locale-context";

interface MsgTemplate {
  id:           string;
  name:         string;
  msgType:      "markdown" | "text" | "card";
  title:        string;
  body:         string;
  variables:    string[];   // e.g. ["work_order_id", "category", "risk_level"]
  channel:      "dingtalk" | "corp_dingtalk";
}

const SEED_TEMPLATES: MsgTemplate[] = [
  {
    id: "tpl-wo-alert",
    name: "工单告警（高风险）",
    msgType: "markdown",
    title: "🚨 工单告警",
    body: "## 食品安全告警\n\n- **工单**: {{work_order_id}}\n- **类别**: {{category}}\n- **风险**: {{risk_level}}\n- **SLA截止**: {{sla_deadline}}\n\n> 请尽快处理",
    variables: ["work_order_id", "category", "risk_level", "sla_deadline"],
    channel: "dingtalk",
  },
  {
    id: "tpl-wo-resolved",
    name: "工单已解决",
    msgType: "markdown",
    title: "✅ 工单已解决",
    body: "## 工单处理完成\n\n- **工单**: {{work_order_id}}\n- **结果**: {{resolution}}\n- **补偿**: {{compensation_type}}\n\n{{agent_notes}}",
    variables: ["work_order_id", "resolution", "compensation_type", "agent_notes"],
    channel: "dingtalk",
  },
  {
    id: "tpl-compensation",
    name: "补偿审批",
    msgType: "markdown",
    title: "📋 补偿审批请求",
    body: "## 补偿审批\n\n- **工单**: {{work_order_id}}\n- **类型**: {{compensation_type}}\n- **详情**: {{compensation_detail}}\n- **申请人**: {{reporter_email}}",
    variables: ["work_order_id", "compensation_type", "compensation_detail", "reporter_email"],
    channel: "corp_dingtalk",
  },
];

const VAR_HELP = ["work_order_id", "case_no", "category", "risk_level", "sla_deadline",
  "resolution", "compensation_type", "compensation_detail", "agent_notes", "reporter_email",
  "store_name", "order_no", "created_at"];

function renderPreview(tpl: MsgTemplate, vars: Record<string, string>): string {
  let text = tpl.body;
  for (const v of tpl.variables) {
    text = text.replace(new RegExp(`\\{\\{${v}\\}\\}`, "g"), vars[v] || `{{${v}}}`);
  }
  return `**${tpl.title}**\n\n${text}`;
}

function parseVariables(body: string): string[] {
  const matches = body.matchAll(/\{\{(\w+)\}\}/g);
  return [...new Set([...matches].map((m) => m[1]))];
}

export function AdminDingtalkTemplatePanel() {
  const t = useT();
  const [templates, setTemplates] = useState<MsgTemplate[]>(SEED_TEMPLATES);
  const [editId,    setEditId]    = useState<string | null>(null);
  const [form,      setForm]      = useState<Partial<MsgTemplate>>({});
  const [preview,   setPreview]   = useState<Record<string, string>>({});
  const [saved,     setSaved]     = useState(false);

  const editing = editId !== null;
  const current = editing ? templates.find((t) => t.id === editId) : null;

  const openNew = () => {
    setEditId("__new__");
    setForm({ id: "", name: "", msgType: "markdown", title: "", body: "", variables: [], channel: "dingtalk" });
    setPreview({ work_order_id: "WO-20260821-0001", category: "外源性异物（外部）", risk_level: "high", sla_deadline: "2h" });
  };

  const openEdit = (tpl: MsgTemplate) => {
    setEditId(tpl.id);
    setForm({ ...tpl });
    const pv: Record<string, string> = {};
    for (const v of tpl.variables) {
      pv[v] = `{{demo-${v}}}`;
    }
    setPreview(pv);
  };

  const updateForm = (patch: Partial<MsgTemplate>) => {
    const next = { ...form, ...patch };
    setForm(next);
    if (next.body) {
      const vars = parseVariables(next.body);
      setForm((f) => ({ ...f, variables: vars }));
    }
  };

  const save = () => {
    if (!form.name || !form.body) return;
    const final: MsgTemplate = {
      id:           form.id           ?? `tpl-${Date.now()}`,
      name:         form.name         ?? "",
      msgType:      form.msgType      ?? "markdown",
      title:        form.title        ?? "",
      body:         form.body         ?? "",
      variables:    form.variables    ?? [],
      channel:      form.channel      ?? "dingtalk",
    };
    if (editId === "__new__") {
      setTemplates((prev) => [...prev, final]);
    } else {
      setTemplates((prev) => prev.map((t) => t.id === editId ? final : t));
    }
    setEditId(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const remove = (id: string) => {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  };

  const rendered = editing && form.body
    ? renderPreview(form as MsgTemplate, preview)
    : "";

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-base font-semibold text-foreground">
          {t("admin.tpl.title", { defaultValue: "钉钉消息模板" })}
        </h2>
        <p className="mt-1 text-xs text-muted-light">
          {t("admin.tpl.subtitle", { defaultValue: "A17.4 — 订阅消息模板 + 变量预览" })}
        </p>
      </header>

      {saved && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">✓ 已保存</div>
      )}

      {/* 列表 */}
      {!editing && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button type="button" onClick={openNew}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
              + 新建模板
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {templates.map((tpl) => (
              <div key={tpl.id} className="rounded border border-slate-200 bg-white p-4">
                <div className="mb-2 flex items-start justify-between">
                  <div>
                    <h4 className="text-sm font-medium text-foreground">{tpl.name}</h4>
                    <div className="mt-0.5 flex gap-1">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-muted">{tpl.msgType}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-muted">{tpl.channel}</span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => openEdit(tpl)}
                      className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-muted hover:bg-slate-50">编辑</button>
                    <button type="button" onClick={() => remove(tpl.id)}
                      className="rounded border border-rose-200 bg-white px-2 py-0.5 text-xs text-rose-600 hover:bg-rose-50">删除</button>
                  </div>
                </div>
                <div className="rounded bg-slate-50 p-2 text-xs text-muted">
                  <div className="mb-1 font-medium text-foreground">{tpl.title}</div>
                  <div className="whitespace-pre-wrap">{tpl.body.slice(0, 120)}{tpl.body.length > 120 ? "…" : ""}</div>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {tpl.variables.map((v) => (
                    <span key={v} className="rounded bg-blue-50 px-1 py-0.5 text-[10px] text-blue-600">{`{{${v}}}`}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 编辑器 */}
      {editing && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* 左：表单 */}
          <div className="space-y-3 rounded border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-medium text-foreground">{editId === "__new__" ? "新建模板" : "编辑模板"}</h3>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-light">模板名称</label>
              <input type="text" value={form.name ?? ""} onChange={(e) => updateForm({ name: e.target.value })}
                placeholder="例如：高风险工单告警"
                className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-foreground focus:border-blue-400 focus:outline-none" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-light">消息类型</label>
                <select value={form.msgType ?? "markdown"} onChange={(e) => updateForm({ msgType: e.target.value as MsgTemplate["msgType"] })}
                  className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-foreground focus:border-blue-400 focus:outline-none">
                  <option value="markdown">Markdown</option>
                  <option value="text">Text</option>
                  <option value="card">Card</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-light">Channel</label>
                <select value={form.channel ?? "dingtalk"} onChange={(e) => updateForm({ channel: e.target.value as MsgTemplate["channel"] })}
                  className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-foreground focus:border-blue-400 focus:outline-none">
                  <option value="dingtalk">钉钉群机器人</option>
                  <option value="corp_dingtalk">钉钉企业内部</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-light">标题</label>
              <input type="text" value={form.title ?? ""} onChange={(e) => updateForm({ title: e.target.value })}
                placeholder="例如：🚨 工单告警"
                className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-foreground focus:border-blue-400 focus:outline-none" />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-light">
                正文（支持 <code className="rounded bg-slate-100 px-0.5">{"{{变量名}}"}</code>）
              </label>
              <textarea value={form.body ?? ""} onChange={(e) => updateForm({ body: e.target.value })}
                rows={8}
                placeholder="## 工单告警&#10;&#10;- **工单**: {{work_order_id}}&#10;- **类别**: {{category}}"
                className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-foreground font-mono focus:border-blue-400 focus:outline-none resize-none" />
            </div>

            {/* 变量自动检测 */}
            {form.body && (
              <div className="rounded border border-blue-100 bg-blue-50 p-2">
                <p className="mb-1 text-[10px] font-medium text-blue-700">自动检测到的变量：</p>
                <div className="flex flex-wrap gap-1">
                  {(form.variables ?? []).map((v) => (
                    <span key={v} className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">{`{{${v}}}`}</span>
                  ))}
                </div>
              </div>
            )}

            {/* 可用变量参考 */}
            <details className="rounded border border-slate-200">
              <summary className="cursor-pointer px-2 py-1.5 text-xs text-muted-light hover:text-muted">可用变量参考</summary>
              <div className="flex flex-wrap gap-1 p-2">
                {VAR_HELP.map((v) => (
                  <button key={v} type="button"
                    onClick={() => updateForm({ body: (form.body ?? "") + `{{${v}}}` })}
                    className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-muted hover:bg-slate-50">
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
            </details>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setEditId(null)}
                className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-muted hover:bg-slate-50">
                取消
              </button>
              <button type="button" onClick={save} disabled={!form.name || !form.body}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                保存
              </button>
            </div>
          </div>

          {/* 右：预览 */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-foreground">预览</h3>

            {/* 变量值输入 */}
            <div className="rounded border border-slate-200 bg-white p-3">
              <p className="mb-2 text-xs font-medium text-muted-light">变量值（测试用）</p>
              <div className="grid grid-cols-2 gap-2">
                {(form.variables ?? []).map((v) => (
                  <div key={v}>
                    <label className="mb-0.5 block text-[10px] text-muted-light">{`{{${v}}}`}</label>
                    <input type="text" value={preview[v] ?? ""}
                      onChange={(e) => setPreview((p) => ({ ...p, [v]: e.target.value }))}
                      className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs text-foreground focus:border-blue-400 focus:outline-none" />
                  </div>
                ))}
              </div>
            </div>

            {/* 渲染预览 */}
            <div className="rounded border border-emerald-200 bg-emerald-50 p-3">
              <p className="mb-2 text-xs font-medium text-emerald-800">渲染结果（模拟钉钉显示）</p>
              <div className="rounded bg-white p-3 text-xs">
                {rendered ? (
                  <div className="space-y-1">
                    {(rendered.split("\n")).map((line, i) => (
                      <div key={i} className={line.startsWith("**") ? "font-bold" : ""}>{line}</div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-light">填写正文后预览</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
