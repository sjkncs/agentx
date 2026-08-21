/**
 * verify-loop.ts — A23.1 SLA 超时检测 + 事件投递循环
 *
 * 每 VERIFY_INTERVAL_MS 执行一次：
 *   1) rpc_sla_check_and_escalate() 扫描所有 open/investigating 工单
 *      → 超时 → status=breached + escalated + fsf_inngest_events
 *      → 预警 → status=warning
 *   2) 对每个新插入的 work_order.escalated 事件：
 *      → rpc_inngest_dispatch_one()
 *      → dispatcher（钉钉/email/webhook）
 *      → rpc_inngest_mark_result
 *
 * DISPATCHED_TO=verifier 时激活。
 * VERIFY_INTERVAL_MS 来自环境变量（默认 30s）。
 *
 * 与 subscribe_loop 的区别：
 *   - subscribe_loop：poll fsf_inngest_events (status=queued) + 匹配订阅
 *   - verify-loop：主动扫描 SLA + 注入 work_order.escalated 事件
 */
import { loadConfig } from "./config.js";
import { makeClient } from "./supabase-client.js";
import { dispatchEvent } from "./dispatchers/index.js";

interface SlaCheckResult {
  ok?: boolean;
  checked_at:    string;
  total_updated: number;
  breached:      number;
  warning:      number;
  ok_count:     number;
}

interface EscalatedEvent {
  event_id:   string;
  event_name: string;
  payload:    Record<string, unknown>;
  source:     string;
  created_at: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const cfg = loadConfig();

  if (process.env.DISPATCHED_TO !== "verifier") {
    console.log("[verify-loop] DISPATCHED_TO != 'verifier', exiting (dry-run stub mode)");
    return;
  }

  const rpc = makeClient(cfg);
  const intervalMs = Number(process.env.VERIFY_INTERVAL_MS ?? 30_000);

  console.log(`[verify-loop] started interval=${intervalMs}ms dryRun=${cfg.dryRun}`);

  let running = true;
  process.on("SIGINT",  () => (running = false));
  process.on("SIGTERM", () => (running = false));

  while (running) {
    let slaReport: SlaCheckResult | null = null;

    try {
      // Step 1: SLA check + auto-escalate
      const raw = await rpc.rpc<SlaCheckResult | null>("rpc_sla_check_and_escalate");
      slaReport = raw as SlaCheckResult | null;

      if (slaReport && (slaReport.total_updated ?? 0) > 0) {
        console.log(
          `[verify-loop] SLA check: breached=${slaReport.breached ?? 0} ` +
          `warning=${slaReport.warning ?? 0} at ${slaReport.checked_at}`
        );
      }
    } catch (err) {
      console.error(`[verify-loop] SLA check error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Step 2: dispatch newly-escalated events
    if ((slaReport?.breached ?? 0) > 0 || (slaReport?.total_updated ?? 0) > 0) {
      try {
        const events = await rpc.rpc<EscalatedEvent[] | null>(
          "rpc_inngest_dispatch_one",
          { p_dispatched_to: "verifier" }
        );
        const rows: EscalatedEvent[] = Array.isArray(events)
          ? events
          : events ? [events] : [];

        for (const row of rows) {
          try {
            console.log(`[verify-loop] dispatch event=${row.event_id} name=${row.event_name}`);
            const result = await dispatchEvent(cfg, rpc, row.event_name, {
              ...row.payload,
              event_id: row.event_id,
            });

            if (result.ok) {
              await rpc.rpc("rpc_inngest_mark_result", {
                p_event_id: row.event_id,
                p_status:   "succeeded",
                p_error:    null,
              });
              console.log(`[verify-loop]   → succeeded`);
            } else {
              await rpc.rpc("rpc_inngest_mark_result", {
                p_event_id: row.event_id,
                p_status:   "failed",
                p_error:    result.error ?? "dispatch failed",
              });
              console.warn(`[verify-loop]   → failed: ${result.error}`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[verify-loop] dispatch error: ${msg}`);
            try {
              await rpc.rpc("rpc_inngest_mark_result", {
                p_event_id: row.event_id,
                p_status:   "failed",
                p_error:    msg,
              });
            } catch {
              // best-effort
            }
          }
        }
      } catch (err) {
        console.error(`[verify-loop] dispatch_one error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await sleep(intervalMs);
  }

  console.log("[verify-loop] bye");
}

main().catch((err) => {
  console.error("[verify-loop] fatal:", err);
  process.exit(1);
});
