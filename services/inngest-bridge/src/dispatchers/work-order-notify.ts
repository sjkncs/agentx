import type { WorkerConfig } from "../config.js";
import type { DispatchResult } from "./index.js";
import type { SupabaseClient } from "../supabase-client.js";
import { post } from "../http.js";

interface MarkdownCardPayload {
  case_no?: string;
  work_order_id?: string;
  event_id?: string;
  priority?: string;
  [key: string]: unknown;
}

interface MarkdownCardResult {
  ok: boolean;
  title?: string;
  markdown?: string;
  error?: string;
}

export async function handleWorkOrderNotify(
  cfg: WorkerConfig,
  rpc: SupabaseClient,
  payload: MarkdownCardPayload,
): Promise<DispatchResult> {
  const caseNo = String(payload.case_no ?? payload.work_order_id ?? "");

  // A25.1: Step 1 — server-side render full markdown card via RPC
  let markdownText: string;
  let cardTitle: string;

  try {
    const card = await rpc.rpc<MarkdownCardResult | null>(
      "rpc_work_order_markdown_card",
      { p_case_no: caseNo },
    );
    if (card && typeof card === "object" && "ok" in card && (card as MarkdownCardResult).ok) {
      const c = card as MarkdownCardResult;
      cardTitle  = c.title  ?? `食安工单 ${caseNo}`;
      markdownText = c.markdown ?? `## ${caseNo}`;
    } else {
      // A24 fallback: client-side rich card
      const body     = String(payload.body ?? "");
      const riskLevel = String(payload.risk_level ?? "");
      const slaStatus = String(payload.sla_status ?? "");
      const category   = String(payload.category    ?? "");
      const status     = String(payload.status      ?? "");

      const riskIcon  = riskLevel === "high"   ? "🔴" : riskLevel === "medium" ? "🟡" : "🟢";
      const slaIcon   = slaStatus === "breached" ? "⏰" : slaStatus === "warning" ? "⚠️"  : "✅";
      const statusIcon = status === "escalated" ? "🚨" : status === "resolved" ? "✅" : "📋";

      cardTitle = `食安工单 ${caseNo}`;
      markdownText = [
        `## ${cardTitle}`,
        "",
        `> **${riskIcon} ${riskLevel.toUpperCase()}**  |  **${slaIcon} ${slaStatus}**  |  **${statusIcon} ${status}**`,
        "",
        `| 工单号 | **${caseNo}** |`,
        `| 类别 | ${category} |`,
        `| 风险 | ${riskIcon} ${riskLevel} |`,
        `| SLA | ${slaIcon} ${slaStatus} |`,
        body ? `\n### 问题描述\n${body}` : "",
        "",
        `> AgentX  |  ${new Date().toLocaleString("en-US")}`,
      ].filter(Boolean).join("\n");
    }
  } catch (err) {
    // Fallback on RPC error
    const body = String(payload.body ?? "");
    cardTitle   = `食安工单 ${caseNo}`;
    markdownText = `## ${cardTitle}\n\n${body}\n\n> 工单: ${caseNo}`;
  }

  const requestBody = {
    msgtype: "markdown",
    markdown: {
      title: cardTitle,
      text:  markdownText,
    },
  };
  const body = JSON.stringify(requestBody);

  if (cfg.dryRun) {
    console.log(`[dry-run] work_order.notify -> dingtalk case=${caseNo}`, markdownText.slice(0, 200));
    return { ok: true };
  }

  // A25.1: Step 2 — pick DingTalk route
  const routes = await rpc.rpc<{ route_id: number; channel: string; target_id: string }[]>(
    "rpc_inngest_pick_notification_route",
    { p_channel: "dingtalk" },
  );
  const route = Array.isArray(routes) ? routes[0] : null;

  if (!route) {
    // Try robot route from env
    const targetUrl = process.env.DINGTALK_ROBOT_WEBHOOK_URL ?? "";
    if (!targetUrl) return { ok: false, error: "no dingtalk route configured" };

    const { status, text, ok: okFlag } = await post(targetUrl, body, cfg.httpTimeoutMs);
    return okFlag
      ? { ok: true, responseStatus: status, responseBody: text.slice(0, 200) }
      : { ok: false, error: `http ${status}`, responseStatus: status };
  }

  const { status, text, ok: okFlag } = await post(
    route.target_id,
    body,
    cfg.httpTimeoutMs,
  );

  // Record delivery
  try {
    await rpc.rpc("rpc_inngest_record_delivery", {
      p_event_id:       String(payload.event_id ?? ""),
      p_route_id:       route.route_id,
      p_channel:        route.channel,
      p_target:         route.target_id,
      p_request_body:   requestBody,
      p_response_status: status,
      p_response_body:  text.slice(0, 2_000),
      p_success:        okFlag,
    });
  } catch {
    // best-effort
  }

  return okFlag
    ? { ok: true, responseStatus: status, responseBody: text.slice(0, 200), routeId: route.route_id }
    : { ok: false, error: `http ${status}`, responseStatus: status, routeId: route.route_id };
}
