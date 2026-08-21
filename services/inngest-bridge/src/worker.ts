/**
 * Inngest Bridge Worker
 * 主循环：1) dispatch_one 抢占一条 queued 事件
 *        2) 按 event_name 路由到 dispatcher
 *        3) mark_result 写回 succeeded/failed
 * 退出：SIGINT/SIGTERM 优雅退出；未捕获异常 5xx 让 supervisor 重启
 */
import { loadConfig } from "./config.js";
import { makeClient } from "./supabase-client.js";
import { dispatchEvent } from "./dispatchers/index.js";

interface DispatchedEvent {
  event_id: string;
  event_name: string;
  payload: Record<string, unknown>;
  attempts: number;
}

async function pollOnce(rpc: ReturnType<typeof makeClient>): Promise<DispatchedEvent | null> {
  const result = await rpc.rpc<DispatchedEvent[] | null>(
    "rpc_inngest_dispatch_one",
    { p_dispatched_to: process.env.DISPATCHED_TO ?? "worker" },
  );
  if (!result) return null;
  const rows = Array.isArray(result) ? result : [result];
  const row = rows[0];
  if (!row || !row.event_id) return null;
  return row;
}

let running = true;
let inFlight = false;

async function main(): Promise<void> {
  const cfg = loadConfig();
  const rpc = makeClient(cfg);

  console.log(
    `[inngest-bridge] started poll=${cfg.pollIntervalMs}ms batch=${cfg.batchSize} ` +
      `dryRun=${cfg.dryRun} supabase=${cfg.supabaseUrl}`,
  );

  const handleSignal = (sig: NodeJS.Signals) => {
    console.log(`[inngest-bridge] received ${sig}, draining...`);
    running = false;
    setTimeout(() => {
      if (inFlight) {
        console.error(`[inngest-bridge] in-flight task hung, force exit`);
        process.exit(1);
      }
      process.exit(0);
    }, 10000).unref();
  };
  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  while (running) {
    inFlight = true;
    try {
      const evt = await pollOnce(rpc);
      if (!evt) {
        await sleep(cfg.pollIntervalMs);
        continue;
      }
      console.log(
        `[inngest-bridge] dispatch ${evt.event_id} ${evt.event_name} attempt=${evt.attempts}`,
      );
      const started = Date.now();
      const payloadWithId = { ...evt.payload, event_id: evt.event_id };
      const result = await dispatchEvent(cfg, rpc, evt.event_name, payloadWithId);
      const elapsed = Date.now() - started;

      if (result.ok) {
        await rpc.rpc("rpc_inngest_mark_result", {
          p_event_id: evt.event_id,
          p_status: "succeeded",
          p_error: null,
        });
        console.log(
          `[inngest-bridge] ok ${evt.event_id} ${elapsed}ms` +
            (result.responseStatus ? ` http=${result.responseStatus}` : ""),
        );
      } else {
        await rpc.rpc("rpc_inngest_mark_result", {
          p_event_id: evt.event_id,
          p_status: "failed",
          p_error: result.error ?? "unknown",
        });
        console.warn(
          `[inngest-bridge] failed ${evt.event_id} ${elapsed}ms error=${result.error ?? "unknown"}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      console.error(`[inngest-bridge] loop error: ${msg}`);
      await sleep(Math.max(cfg.pollIntervalMs, 2000));
    } finally {
      inFlight = false;
    }
  }
  console.log(`[inngest-bridge] bye`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error(`[inngest-bridge] fatal:`, err);
  process.exit(1);
});