import { loadConfig } from "./config.js";
import { makeClient } from "./supabase-client.js";
import { dispatchEvent } from "./dispatchers/index.js";

async function main() {
  process.env.DRY_RUN = "true";
  const cfg = loadConfig();
  const rpc = makeClient(cfg);
  console.log("[verify] start");

  console.log("[verify] 1) enqueue");
  const enq = await rpc.rpc<{ ok: boolean; event_id: string }>(
    "rpc_inngest_enqueue_notification",
    {
      p_work_order_id: "WO-VERIFY-001",
      p_title: "verify-loop",
      p_body: "verify-loop auto-test",
      p_channel: "dingtalk",
      p_priority: "normal",
    },
  );
  if (!enq?.ok) throw new Error("enqueue failed");
  console.log("[verify]   event_id =", enq.event_id);

  console.log("[verify] 2) dispatch_one");
  const dispatched = await rpc.rpc<
    { event_id: string; event_name: string; payload: Record<string, unknown> }[]
  >("rpc_inngest_dispatch_one", { p_dispatched_to: "verify" });
  const rows = Array.isArray(dispatched) ? dispatched : dispatched ? [dispatched] : [];
  const row = rows[0];
  if (!row) throw new Error("dispatch returned nothing");
  console.log("[verify]   got event =", row.event_id);

  console.log("[verify] 3) dispatcher dryRun");
  const result = await dispatchEvent(
    cfg,
    rpc,
    row.event_name,
    { ...row.payload, event_id: row.event_id },
  );
  console.log("[verify]   result =", JSON.stringify(result));
  if (!result.ok) throw new Error("dispatcher failed");

  console.log("[verify] 4) mark_result");
  await rpc.rpc("rpc_inngest_mark_result", {
    p_event_id: row.event_id,
    p_status: "succeeded",
    p_error: null,
  });

  console.log("[verify] PASS");
}

main().catch((err) => {
  console.error("[verify] FAIL:", err);
  process.exit(1);
});
