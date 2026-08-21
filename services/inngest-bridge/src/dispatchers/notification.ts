import type { WorkerConfig } from "../config.js";
import type { DispatchResult } from "./index.js";
import type { SupabaseClient } from "../supabase-client.js";
import { post } from "../http.js";

const PH = /\{\{(\w+)\}\}/g;

interface RoutePick {
  route_id: number;
  channel: string;
  target_id: string;
  payload_template: Record<string, unknown>;
}

function render(tpl: Record<string, unknown>, p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(tpl)) {
    out[k] = typeof v === "string"
      ? v.replace(PH, (_m, key) => p[key] === undefined ? "" : String(p[key]))
      : v;
  }
  return out;
}

export async function handleNotification(
  cfg: WorkerConfig,
  rpc: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<DispatchResult> {
  const channel = String(payload.channel ?? "dingtalk");
  const routes = await rpc.rpc<RoutePick[]>(
    "rpc_inngest_pick_notification_route",
    { p_channel: channel },
  );
  const route = Array.isArray(routes) ? routes[0] : null;
  if (!route) return { ok: false, error: `no enabled route for channel=${channel}` };

  const title = String(payload.title ?? "Food Safety Event");
  const requestBody: Record<string, unknown> = {
    msgtype: "markdown",
    markdown: {
      title,
      text: `## ${title}\n\n${String(payload.body ?? "")}\n\n` +
            `> work_order: ${payload.work_order_id ?? "(unknown)"}\n` +
            `> priority: ${payload.priority ?? "normal"}`,
    },
    ...render(route.payload_template, payload),
  };
  const body = JSON.stringify(requestBody);

  if (cfg.dryRun) {
    console.log(`[dry-run] ${channel} -> ${route.target_id}`, body.slice(0, 200));
    return { ok: true, routeId: route.route_id };
  }

  const { status, text, ok: okFlag } = await post(
    route.target_id,
    body,
    cfg.httpTimeoutMs,
  );

  await rpc.rpc("rpc_inngest_record_delivery", {
    p_event_id: String(payload.event_id ?? ""),
    p_route_id: route.route_id,
    p_channel: channel,
    p_target: route.target_id,
    p_request_body: requestBody,
    p_response_status: status,
    p_response_body: text.slice(0, 2_000),
    p_success: okFlag,
  });

  return okFlag
    ? { ok: true, responseStatus: status, responseBody: text.slice(0, 200), routeId: route.route_id }
    : { ok: false, error: `http ${status || "network"}`, routeId: route.route_id };
}
