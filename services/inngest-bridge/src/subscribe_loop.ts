/**
 * subscribe_loop.ts — A9/A10 订阅 worker
 *
 * 与 A8 worker.ts 并行运行（2 个 process 或 1 个 process 2 个 loop 都行）
 * 主循环：
 *   1) rpc_subscription_poll_match(workspace_id) 一次拿 1 条 queued 事件 + 全部订阅匹配
 *      （FOR UPDATE SKIP LOCKED 让多 worker 安全）
 *   2) 对每个 (event_id, subscription_id) 调用 dispatcher 模板
 *   3) 钉钉 dingtalk channel → signDingtalkUrl(target_id, DINGTALK_ROBOT_SECRET)
 *   4) 调 rpc_subscription_record_delivery 写结果
 *
 * Inngest Cloud 签名校验: apps/api/src/webhooks/index.ts 用 inngest-signature.ts
 * （subscribe_loop 是 poll worker，不接收 webhook 回调）
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

async function pollOnce(rpc: ReturnType<typeof makeClient>): Promise<MatchRow[]> {
  const result = await rpc.rpc<MatchRow[] | null>("rpc_subscription_poll_match", {
    p_dispatched_to: process.env.DISPATCHED_TO ?? "subscriber",
    p_workspace_id: process.env.SUBSCRIBER_WORKSPACE_ID ?? "default",
  });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

function bodyFor(targetChannel: string, payload: Record<string, unknown>): string {
  const title = String(payload.title ?? payload.work_order_id ?? "subscription event");
  const body = String(payload.body ?? "");
  if (targetChannel === "email") {
    return JSON.stringify({
      subject: `[A9 sub] ${title}`,
      text: `${body}\n\nwork_order: ${payload.work_order_id ?? "(unknown)"}\nsent at: ${new Date().toISOString()}`,
    });
  }
  return JSON.stringify({
    msgtype: "markdown",
    markdown: {
      title,
      text: `## ${title}\n\n${body}\n\n> work_order: ${payload.work_order_id ?? "(unknown)"}`,
    },
  });
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
    const body = bodyFor("dingtalk", row.payload);
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
      await rpc.rpc("rpc_subscription_record_delivery", {
        p_event_id: row.event_id,
        p_subscription_id: row.subscription_id,
        p_target_channel: row.target_channel,
        p_target_id: row.target_id,
        p_request_body: { title: row.payload.title, body: row.payload.body },
        p_response_status: r.ok ? 200 : 400,
        p_response_body: JSON.stringify(r).slice(0, 2_000),
        p_success: r.ok,
        p_work_order_id: row.work_order_id ?? "",
      });
      return { ok: r.ok, status: r.ok ? 200 : 400, text: JSON.stringify(r) };
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
  const { status, text, ok } = await post(targetUrl, body, cfg.httpTimeoutMs);

  await rpc.rpc("rpc_subscription_record_delivery", {
    p_event_id: row.event_id,
    p_subscription_id: row.subscription_id,
    p_target_channel: row.target_channel,
    p_target_id: row.target_id,
    p_request_body: { title: row.payload.title, body: row.payload.body },
    p_response_status: status,
    p_response_body: text.slice(0, 2_000),
    p_success: ok,
    p_work_order_id: row.work_order_id ?? "",
  });

  return { ok, status, text };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const rpc = makeClient(cfg);
  const ws = process.env.SUBSCRIBER_WORKSPACE_ID ?? "default";
  console.log(`[subscribe-loop] started ws=${ws} poll=${cfg.pollIntervalMs}ms dryRun=${cfg.dryRun}`);

  let running = true;
  process.on("SIGINT", () => (running = false));
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

    // 去重：同一 event_id 一次只跑一条（其它 sub 在 record_delivery 时 dedupe 唯一索引保护）
    const seenEventIds = new Set<string>();
    for (const row of rows) {
      if (seenEventIds.has(row.event_id)) continue;
      seenEventIds.add(row.event_id);
      try {
        const r = await dispatchOne(cfg, rpc, row);
        console.log(`[subscribe-loop] ${r.ok ? "ok" : "fail"} ${row.event_name} sub=${row.subscription_id} http=${r.status}`);
      } catch (err) {
        console.error(`[subscribe-loop] dispatch error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  console.log(`[subscribe-loop] bye`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(`[subscribe-loop] fatal:`, err);
  process.exit(1);
});