/**
 * subscribe_loop.ts — A9 订阅 worker
 *
 * 与 A8 worker.ts 并行运行（2 个 process 或 1 个 process 2 个 loop 都行）
 * 主循环：
 *   1) rpc_subscription_poll_match 一次拿 1 条 queued 事件 + 全部订阅匹配
 *      （FOR UPDATE SKIP LOCKED 让多 worker 安全）
 *   2) 对每个 (event_id, subscription_id) 调用 dispatcher 模板
 *   3) 调 rpc_subscription_record_delivery 写结果
 */
import { loadConfig } from "./config.js";
import { makeClient } from "./supabase-client.js";
import { post } from "./http.js";

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
  const body = bodyFor(row.target_channel, row.payload);

  if (cfg.dryRun) {
    console.log(`[sub-dry-run] ${row.target_channel} -> ${row.target_id} sub=${row.subscription_id}`);
    return { ok: true, status: 200, text: "dry-run" };
  }

  const { status, text, ok } = await post(row.target_id, body, cfg.httpTimeoutMs);

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
  console.log(`[subscribe-loop] started poll=${cfg.pollIntervalMs}ms dryRun=${cfg.dryRun}`);

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