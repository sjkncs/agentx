"use client";

/**
 * admin-webhooks-panel.tsx — A9 Webhooks / 事件订阅 Inbox
 * 展示：
 *   - 订阅列表 (fsf_event_subscriptions)
 *   - 投递日志 (fsf_subscription_deliveries)
 *   - 失败重发按钮 → rpc_subscription_delivery_resend
 */
import { useCallback, useEffect, useState } from "react";
import { useT } from "../../i18n/locale-context";
import { callRpc } from "./supabase-rpc";
import { EVENT_NAMES, CHANNEL_NAMES, EVENT_LABELS, CHANNEL_LABELS } from "./event-names";

interface SubscriptionRow {
  id: number;
  subscription_name: string;
  event_name: string;
  filter_json: Record<string, unknown>;
  target_channel: string;
  target_id: string;
  enabled: boolean;
  cooldown_seconds: number;
  trigger_count: number;
  last_triggered_at: string | null;
  created_at: string;
}

interface DeliveryRow {
  id: number;
  subscription_id: number;
  subscription_name: string;
  event_name: string;
  event_id: string;
  work_order_id: string | null;
  target_channel: string;
  target_id: string;
  status: string;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  failed_at: string | null;
  resend_count: number;
  created_at: string;
}

const STATUS_BADGE: Record<string, string> = {
  pending: "border border-slate-200 bg-slate-50 text-slate-700",
  sent:    "border border-emerald-200 bg-emerald-50 text-emerald-700",
  failed:  "border border-rose-200 bg-rose-50 text-rose-700",
  skipped: "border border-amber-200 bg-amber-50 text-amber-700",
};

export function AdminWebhooksPanel() {
  const t = useT();
  const [subs, setSubs] = useState<SubscriptionRow[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [wsId, setWsId] = useState("default");
  const [formName, setFormName] = useState("");
  const [formEvent, setFormEvent] = useState<string>(EVENT_NAMES[0]);
  const [formChannel, setFormChannel] = useState<string>(CHANNEL_NAMES[0]);
  const [formTarget, setFormTarget] = useState("");
  const [formFilter, setFormFilter] = useState("");
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [s, d] = await Promise.all([
      callRpc<SubscriptionRow[]>("rpc_event_subscription_list", {
        p_workspace_id: "default",
        p_include_disabled: true,
      }),
      callRpc<DeliveryRow[]>("rpc_subscription_list_deliveries", {
        p_workspace_id: "default",
        p_limit: 100,
        p_status: null,
      }),
    ]);
    if (s.error) setError(s.error);
    else setSubs(s.data ?? []);
    if (d.error && !error) setError(d.error);
    setDeliveries(d.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleSub = async (id: number, enabled: boolean) => {
    const r = await callRpc<{ ok: boolean }>("rpc_event_subscription_toggle", {
      p_id: id,
      p_enabled: enabled,
    });
    if (r.ok !== undefined) void refresh();
  };

  const resend = async (deliveryId: number) => {
    setResendingId(deliveryId);
    await callRpc("rpc_subscription_delivery_resend", { p_delivery_id: deliveryId });
    setResendingId(null);
    void refresh();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    const filterJson = formFilter
      ? Object.fromEntries(formFilter.split(",").map((s) => s.split("=").map((x) => x.trim())))
      : {};
    const r = await callRpc<{ ok: boolean; subscription_name?: string }>(
      "rpc_event_subscription_create",
      {
        p_workspace_id: wsId,
        p_subscription_name: formName || null,
        p_event_name: formEvent,
        p_target_channel: formChannel,
        p_target_id: formTarget,
        p_filter: filterJson,
        p_cooldown_seconds: 0,
      },
    );
    setCreating(false);
    if (r.ok) {
      setShowCreate(false);
      setFormName(""); setFormTarget(""); setFormFilter("");
      void refresh();
    } else {
      setError(r.error ?? "create failed");
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-base font-semibold text-foreground">
          {t("admin.webhooks.title", { defaultValue: "Webhooks / 事件订阅" })}
        </h2>
        <p className="mt-1 text-xs text-muted-light">
          {t("admin.webhooks.subtitle", {
            defaultValue: "A9 — 跨工作区事件订阅 + 投递 Inbox",
          })}
        </p>
      </header>

      {error ? (
        <div className="border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </div>
      ) : null}

      {showCreate ? (
        <form onSubmit={handleCreate} className="rounded border border-blue-200 bg-blue-50 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-blue-900">New Subscription</h3>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <label className="flex flex-col gap-1">
              <span className="text-muted-light">workspace</span>
              <select value={wsId} onChange={(e) => setWsId(e.target.value)} className="rounded border border-slate-200 bg-white px-2 py-1">
                <option value="default">default</option>
                <option value="heytea-bj">heytea-bj</option>
                <option value="heytea-sh">heytea-sh</option>
                <option value="heytea-sz">heytea-sz</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-light">name (auto if blank)</span>
              <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="sub_abc123"
                className="rounded border border-slate-200 bg-white px-2 py-1 font-mono" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-light">event</span>
              <select value={formEvent} onChange={(e) => setFormEvent(e.target.value)} className="rounded border border-slate-200 bg-white px-2 py-1">
                {EVENT_NAMES.map((n) => <option key={n} value={n}>{EVENT_LABELS[n] ?? n}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-light">channel</span>
              <select value={formChannel} onChange={(e) => setFormChannel(e.target.value)} className="rounded border border-slate-200 bg-white px-2 py-1">
                {CHANNEL_NAMES.map((n) => <option key={n} value={n}>{CHANNEL_LABELS[n] ?? n}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-muted-light">target (webhook URL / email / etc.)</span>
              <input value={formTarget} onChange={(e) => setFormTarget(e.target.value)} required placeholder="https://..."
                className="rounded border border-slate-200 bg-white px-2 py-1 font-mono" />
            </label>
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-muted-light">filter (optional, e.g. risk_level=high)</span>
              <input value={formFilter} onChange={(e) => setFormFilter(e.target.value)} placeholder="key=value,key2=value2"
                className="rounded border border-slate-200 bg-white px-2 py-1 font-mono" />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={creating}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50">
              {creating ? "…" : "Create"}
            </button>
            <button type="button" onClick={() => setShowCreate(false)}
              className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-muted">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mb-3">
          <button type="button" onClick={() => setShowCreate(true)}
            className="rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-100">
            + New Subscription
          </button>
        </div>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">
            {t("admin.webhooks.subs.title", { defaultValue: "Subscriptions" })}
          </h3>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-muted hover:text-foreground disabled:opacity-50"
          >
            {loading ? "…" : t("admin.webhooks.refresh", { defaultValue: "Refresh" })}
          </button>
        </div>
        <div className="overflow-hidden rounded border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-muted-light">
              <tr>
                <th className="px-3 py-2 font-medium">name</th>
                <th className="px-3 py-2 font-medium">event</th>
                <th className="px-3 py-2 font-medium">channel</th>
                <th className="px-3 py-2 font-medium">target</th>
                <th className="px-3 py-2 font-medium text-right">triggers</th>
                <th className="px-3 py-2 font-medium">enabled</th>
              </tr>
            </thead>
            <tbody>
              {subs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-muted-light">
                    {loading ? "Loading…" : "no subscriptions"}
                  </td>
                </tr>
              ) : null}
              {subs.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-foreground">{s.subscription_name}</td>
                  <td className="px-3 py-2 text-muted">{s.event_name}</td>
                  <td className="px-3 py-2 text-muted">{s.target_channel}</td>
                  <td className="px-3 py-2 truncate font-mono text-muted">{s.target_id}</td>
                  <td className="px-3 py-2 text-right text-muted">{s.trigger_count}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleSub(s.id, !s.enabled)}
                      className={
                        s.enabled
                          ? "rounded bg-emerald-100 px-2 py-0.5 text-emerald-800"
                          : "rounded bg-slate-100 px-2 py-0.5 text-slate-600"
                      }
                    >
                      {s.enabled ? "on" : "off"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-medium text-foreground">
          {t("admin.webhooks.deliveries.title", { defaultValue: "Recent Deliveries" })}
        </h3>
        <div className="overflow-hidden rounded border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-muted-light">
              <tr>
                <th className="px-3 py-2 font-medium">sub</th>
                <th className="px-3 py-2 font-medium">event</th>
                <th className="px-3 py-2 font-medium">channel</th>
                <th className="px-3 py-2 font-medium">status</th>
                <th className="px-3 py-2 font-medium">attempts</th>
                <th className="px-3 py-2 font-medium text-right">when</th>
                <th className="px-3 py-2 font-medium">actions</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-center text-muted-light">
                    {loading ? "Loading…" : "no deliveries yet"}
                  </td>
                </tr>
              ) : null}
              {deliveries.map((d) => (
                <tr key={d.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-foreground">{d.subscription_name}</td>
                  <td className="px-3 py-2 text-muted">{d.event_name}</td>
                  <td className="px-3 py-2 text-muted">{d.target_channel}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${STATUS_BADGE[d.status] ?? "border border-slate-200 bg-slate-50"}`}
                    >
                      {d.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted">{d.attempts}</td>
                  <td className="px-3 py-2 text-right text-muted-light">
                    {d.sent_at ?? d.failed_at ?? d.created_at}
                  </td>
                  <td className="px-3 py-2">
                    {(d.status === "failed" || d.status === "pending") ? (
                      <button
                        type="button"
                        onClick={() => resend(d.id)}
                        disabled={resendingId === d.id}
                        className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                      >
                        {resendingId === d.id ? "…" : "resend"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}