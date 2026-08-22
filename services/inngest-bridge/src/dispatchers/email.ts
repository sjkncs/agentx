import type { WorkerConfig } from "../config.js";
import type { DispatchResult } from "./index.js";
import type { SupabaseClient } from "../supabase-client.js";
import { post } from "../http.js";

interface EmailPayload {
  case_no?: string;
  work_order_id?: string;
  subject?: string;
  body?: string;
  priority?: string;
  event_id?: string;
  [key: string]: unknown;
}

export async function handleEmail(
  cfg: WorkerConfig,
  _rpc: SupabaseClient,
  payload: EmailPayload,
): Promise<DispatchResult> {
  const caseNo = String(payload.case_no ?? payload.work_order_id ?? "unknown");
  const subject = String(payload.subject ?? `Work Order Notification ${caseNo}`);
  const body    = String(payload.body ?? "");

  // A26.4: Render email body from payload
  const emailBody: Record<string, string> = {
    subject,
    text: [
      body,
      "",
      `工单号: ${caseNo}`,
      `优先级: ${payload.priority ?? "normal"}`,
      `发送时间: ${new Date().toLocaleString("zh-CN")}`,
      "",
      "— DataFoundry",
    ].join("\n"),
  };

  if (cfg.dryRun) {
    console.log(`[dry-run] email for ${caseNo}:`, emailBody.subject);
    return { ok: true };
  }

  // A26.4: Route via rpc_inngest_pick_notification_route or env email webhook
  const webhookUrl = process.env.EMAIL_WEBHOOK_URL ?? "";
  if (!webhookUrl) {
    // Fallback: log and return success (email delivery is non-critical in dev)
    console.log(`[email] no EMAIL_WEBHOOK_URL configured, skipping for ${caseNo}`);
    return { ok: true, responseBody: "no EMAIL_WEBHOOK_URL" };
  }

  const { status, text, ok } = await post(
    webhookUrl,
    JSON.stringify(emailBody),
    cfg.httpTimeoutMs,
  );

  return ok
    ? { ok: true, responseStatus: status, responseBody: text.slice(0, 200) }
    : { ok: false, error: `email http ${status}`, responseStatus: status };
}
