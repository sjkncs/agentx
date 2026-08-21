/**
 * subscribe_loop.ts — A9/A10/A17 订阅 worker
 *
 * 主循环：
 *   1) rpc_subscription_poll_match(workspace_id) 一次拿 1 条 queued 事件 + 全部订阅匹配
 *   2) 对每个 (event_id, subscription_id) 调用 dispatcher
 *   3) 钉钉 dingtalk channel → signDingtalkUrl(target_id, DINGTALK_ROBOT_SECRET)
 *   4) 调 rpc_subscription_record_delivery 写结果
 *   5) A17: 失败时调用 rpc_subscription_delivery_resend + 指数退避重试
 *
 * A17 backoff 策略：
 *   - 初始延迟: base_delay_s (来自 rpc_workspace_config 或环境变量)
 *   - 乘数: backoff_multiplier (默认 2.0)
 *   - 最大延迟: max_delay_s (默认 3600s)
 *   - 最大次数: max_attempts (默认 5)
 *   - 退避序列: base × 2^n (cap at max)
 *
 * Inngest Cloud 签名校验: apps/api/src/webhooks/index.ts 用 inngest-signature.ts
 */
import { loadConfig } from "./config.js";
import { makeClient } from "./supabase-client.js";
import { post } from "./http.js";
import { signDingtalkUrl } from "./dingtalk-signature.js";

interface MatchRow {
  event_id: string;
  event_name: string;
  payload: Record<string, unknown>;
  subscription_id: number;
  target_channel: string;
  target_id: string;
  cooldown_seconds: number;
  filter_json: Record<string, unknown>;
  work_order_id: string | null;
}

interface RetryConfig {
  maxAttempts: number;
  baseDelaySeconds: number;
  maxDelaySeconds: number;
  multiplier: number;
}

const DEFAULT_RETRY: RetryConfig = {
  maxAttempts:      5,
  baseDelaySeconds: 30,
  maxDelaySeconds:  3600,
  multiplier:       2.0,
};

async function pollOnce(rpc: ReturnType<typeof makeClient>): Promise<MatchRow[]> {
  const result = await rpc.rpc<MatchRow[] | null>("rpc_subscription_poll_match", {
    p_dispatched_to: process.env.DISPATCHED_TO ?? "subscriber",
    p_workspace_id: process.env.SUBSCRIBER_WORKSPACE_ID ?? "default",
  });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

async function fetchRetryConfig(
  rpc: ReturnType<typeof makeClient>,
  channel: string,
): Promise<RetryConfig> {
  const wsId = process.env.SUBSCRIBER_WORKSPACE_ID ?? "default";
  const key = `retry_${channel}`;
  try {
    const r = await rpc.rpc<{ value: string }[] | null>(
      "rpc_workspace_config_get",
      { p_workspace_id: wsId, p_key: key },
    );
    if (r && typeof r === "object" && "value" in r) {
      const cfg = JSON.parse(String((r as { value: string }).value));
      return {
        maxAttempts:     Number(cfg.max_attempts      ?? DEFAULT_RETRY.maxAttempts),
        baseDelaySeconds: Number(cfg.base_delay_s     ?? DEFAULT_RETRY.baseDelaySeconds),
        maxDelaySeconds:  Number(cfg.max_delay_s      ?? DEFAULT_RETRY.maxDelaySeconds),
        multiplier:       Number(cfg.backoff_multiplier ?? DEFAULT_RETRY.multiplier),
      };
    }
  } catch {
    // fall through to env-var defaults
  }
  // Fall back to env-var overrides
  return {
    maxAttempts:      Number(process.env[`RETRY_MAX_${channel.toUpperCase()}`] ?? DEFAULT_RETRY.maxAttempts),
    baseDelaySeconds: Number(process.env[`RETRY_BASE_${channel.toUpperCase()}`] ?? DEFAULT_RETRY.baseDelaySeconds),
    maxDelaySeconds:  Number(process.env[`RETRY_MAX_DELAY`] ?? DEFAULT_RETRY.maxDelaySeconds),
    multiplier:       Number(process.env["RETRY_MULTIPLIER"] ?? DEFAULT_RETRY.multiplier),
  };
}

function calcBackoff(attempt: number, cfg: RetryConfig): number {
  const raw = cfg.baseDelaySeconds * Math.pow(cfg.multiplier, attempt - 1);
  return Math.min(Math.round(raw), cfg.maxDelaySeconds);
}

function bodyFor(targetChannel: string, payload: Record<string, unknown>): string {
  const caseNo = String(payload.work_order_id ?? payload.case_no ?? payload.id ?? "unknown");

  if (targetChannel === "email") {
    const body = String(payload.body ?? "");
    return JSON.stringify({
      subject: `[喜茶食安] ${caseNo}`,
      text: `${body}\n\n工单: ${caseNo}\n时间: ${new Date().toISOString()}`,
    });
  }

  // Rich markdown for dingtalk / corp_dingtalk
  // A24: Fall back to rpc_work_order_markdown_card via server-side render.
  // Client should call rpc_work_order_markdown_card(p_case_no) first and pass
  // rendered_markdown in payload; here we build a fallback client-side card.
  const title = String(payload.title ?? `食品安全工单 ${caseNo}`);
  const body  = String(payload.body ?? "");
  const riskLevel  = String(payload.risk_level  ?? "");
  const slaStatus  = String(payload.sla_status  ?? "");
  const category    = String(payload.category    ?? "");
  const status      = String(payload.status      ?? "");

  const riskIcon  = riskLevel === "high"   ? "🔴" : riskLevel === "medium" ? "🟡" : "🟢";
  const slaIcon   = slaStatus === "breached" ? "⏰" : slaStatus === "warning" ? "⚠️"  : "✅";
  const statusIcon = status === "escalated" ? "🚨" : status === "resolved" ? "✅" : "📋";

  const header = `> **${riskIcon} ${riskLevel.toUpperCase()}**  |  **${slaIcon} ${slaStatus}**  |  **${statusIcon} ${status}**`;
  const description = body ? `\n### 问题描述\n${body}` : "";

  const markdownText = [
    `## ${title}`,
    "",
    header,
    "",
    `| 工单号 | **${caseNo}** |`,
    `| 类别 | ${category} |`,
    `| 风险 | ${riskIcon} ${riskLevel} |`,
    `| SLA | ${slaIcon} ${slaStatus} |`,
    `| 状态 | ${statusIcon} ${status} |`,
    "",
    description,
    "",
    `> 系统: DataFoundry × 喜茶食安  |  ${new Date().toLocaleString("zh-CN")}`,
  ].filter(Boolean).join("\n");

  return JSON.stringify({
    msgtype: "markdown",
    markdown: {
      title,
      text: markdownText,
    },
  });
}

async function recordDelivery(
  rpc: ReturnType<typeof makeClient>,
  row: MatchRow,
  ok: boolean,
  status: number,
  bodyText: string,
): Promise<void> {
  try {
    await rpc.rpc("rpc_subscription_record_delivery", {
      p_event_id:           row.event_id,
      p_subscription_id:   row.subscription_id,
      p_target_channel:    row.target_channel,
      p_target_id:         row.target_id,
      p_request_body:      { title: row.payload.title, body: row.payload.body },
      p_response_status:   status,
      p_response_body:     bodyText.slice(0, 2_000),
      p_success:           ok,
      p_work_order_id:     row.work_order_id ?? "",
    });
  } catch (err) {
    console.error(`[sub] record_delivery failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function dispatchOne(
  cfg: Awaited<ReturnType<typeof loadConfig>>,
  rpc: ReturnType<typeof makeClient>,
  row: MatchRow,
): Promise<{ ok: boolean; status: number; text: string }> {
  if (cfg.dryRun) {
    console.log(`[sub-dry-run] ${row.target_channel} -> ${row.target_id} sub=${row.subscription_id}`);
    return { ok: true, status: 200, text: "dry-run" };
  }

  // corp_dingtalk: 调 RPC（不走 HTTP webhook）
  if (row.target_channel === "corp_dingtalk") {
    const filter = row.filter_json ?? {};
    const body   = bodyFor("dingtalk", row.payload);
    const parsed = JSON.parse(body);
    try {
      const r = await rpc.rpc<{ ok: boolean; task_id?: number; error?: string }>(
        "rpc_corp_dingtalk_send",
        {
          p_agent_id:     Number(filter.agent_id ?? row.target_id),
          p_userid_list:  String(filter.userid_list ?? ""),
          p_dept_id_list: Number(filter.dept_id_list ?? 0) || null,
          p_msg_type:     "markdown",
          p_content:      parsed.markdown?.text ?? "",
          p_title:        parsed.markdown?.title ?? "",
          p_app_key:      process.env.DINGTALK_APP_KEY ?? null,
          p_app_secret:   process.env.DINGTALK_APP_SECRET ?? null,
          p_correlation:  { event_id: row.event_id, subscription_id: row.subscription_id },
        },
      );
      return { ok: !!r?.ok, status: r?.ok ? 200 : 400, text: JSON.stringify(r) };
    } catch (err) {
      return { ok: false, status: 500, text: String(err) };
    }
  }

  let targetUrl = row.target_id;
  if (row.target_channel === "dingtalk" && cfg.dingtalkRobotSecret) {
    targetUrl = signDingtalkUrl(row.target_id, cfg.dingtalkRobotSecret);
    if (process.env.DEBUG_SIGN) {
      console.log(`[sub] dingtalk signed url = ${targetUrl}`);
    }
  }

  const body = bodyFor(row.target_channel, row.payload);
  return post(targetUrl, body, cfg.httpTimeoutMs);
}

async function handleRow(
  cfg: Awaited<ReturnType<typeof loadConfig>>,
  rpc: ReturnType<typeof makeClient>,
  row: MatchRow,
  attempt: number,
): Promise<void> {
  const r = await dispatchOne(cfg, rpc, row);
  await recordDelivery(rpc, row, r.ok, r.status, r.text);

  if (!r.ok) {
    const retryCfg = await fetchRetryConfig(rpc, row.target_channel);
    const backoffSec = calcBackoff(attempt, retryCfg);
    const deliveryId = await getDeliveryId(rpc, row);

    if (deliveryId !== null) {
      if (attempt < retryCfg.maxAttempts) {
        console.log(`[sub-retry] ${row.event_name} sub=${row.subscription_id} attempt=${attempt} backoff=${backoffSec}s -> rescheduling`);
        await rpc.rpc("rpc_subscription_delivery_resend", {
          p_delivery_id: deliveryId,
        });
        await sleep(backoffSec * 1_000);
      } else {
        console.warn(`[sub-retry] ${row.event_name} sub=${row.subscription_id} attempt=${attempt} MAX — giving up`);
        await rpc.rpc("rpc_subscription_record_delivery", {
          p_event_id:         row.event_id,
          p_subscription_id:  row.subscription_id,
          p_target_channel:   row.target_channel,
          p_target_id:        row.target_id,
          p_request_body:     { title: row.payload.title, body: row.payload.body },
          p_response_status:  r.status,
          p_response_body:    r.text.slice(0, 2_000),
          p_success:          false,
          p_work_order_id:    row.work_order_id ?? "",
        });
      }
    }
  }
}

async function getDeliveryId(
  rpc: ReturnType<typeof makeClient>,
  row: MatchRow,
): Promise<number | null> {
  try {
    const r = await rpc.rpc<{ id: number }[] | null>(
      "rpc_subscription_get_latest_delivery",
      {
        p_event_id:         row.event_id,
        p_subscription_id:   row.subscription_id,
      },
    );
    if (r && Array.isArray(r) && r.length > 0) return r[0].id;
  } catch {
    // ignore
  }
  return null;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const rpc = makeClient(cfg);
  const ws  = process.env.SUBSCRIBER_WORKSPACE_ID ?? "default";
  console.log(`[subscribe-loop] started ws=${ws} poll=${cfg.pollIntervalMs}ms dryRun=${cfg.dryRun}`);

  let running = true;
  process.on("SIGINT",  () => (running = false));
  process.on("SIGTERM", () => (running = false));

  while (running) {
    let rows: MatchRow[] = [];
    try {
      rows = await pollOnce(rpc);
    } catch (err) {
      console.error(`[subscribe-loop] poll error: ${err instanceof Error ? err.message : String(err)}`);
      await sleep(Math.max(cfg.pollIntervalMs, 2_000));
      continue;
    }

    if (rows.length === 0) {
      await sleep(cfg.pollIntervalMs);
      continue;
    }

    // A17 retry loop: for each event, retry failed dispatches up to maxAttempts
    const pendingRetries: Array<{ row: MatchRow; attempt: number }> = [];
    const seenEventIds = new Set<string>();

    for (const row of rows) {
      if (seenEventIds.has(row.event_id)) continue;
      seenEventIds.add(row.event_id);
      try {
        await handleRow(cfg, rpc, row, 1);
      } catch (err) {
        console.error(`[subscribe-loop] handleRow error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // A17: scan for pending retries from fsf_subscription_deliveries (status='pending' and resend_requested_at is set)
    try {
      const retryRows = await rpc.rpc<MatchRow[] | null>("rpc_subscription_poll_retries", {
        p_workspace_id:  ws,
        p_limit:         cfg.batchSize,
      });
      if (retryRows && Array.isArray(retryRows)) {
        for (const rrow of retryRows) {
          try {
            // get attempt count from deliveries
            const attempt = await getAttemptCount(rpc, rrow.event_id, rrow.subscription_id);
            await handleRow(cfg, rpc, rrow, attempt + 1);
          } catch (err) {
            console.error(`[subscribe-loop] retry handleRow error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    } catch {
      // poll_retries is optional — skip if RPC not yet deployed
    }
  }

  console.log(`[subscribe-loop] bye`);
}

async function getAttemptCount(
  rpc: ReturnType<typeof makeClient>,
  eventId: string,
  subId: number,
): Promise<number> {
  try {
    const r = await rpc.rpc<{ attempt: number }[] | null>(
      "rpc_subscription_get_attempt_count",
      { p_event_id: eventId, p_subscription_id: subId },
    );
    if (r && Array.isArray(r) && r.length > 0) return Number(r[0].attempt);
  } catch {
    // ignore
  }
  return 1;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(`[subscribe-loop] fatal:`, err);
  process.exit(1);
});
