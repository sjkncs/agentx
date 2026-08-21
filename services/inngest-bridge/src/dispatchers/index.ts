import type { WorkerConfig } from "../config.js";
import type { SupabaseClient } from "../supabase-client.js";

export interface DispatchResult {
  ok: boolean;
  responseStatus?: number;
  responseBody?: string;
  routeId?: number;
  error?: string;
}

import { handleNotification } from "./notification.js";
import { handleInngestPassthrough } from "./inngest-passthrough.js";

export async function dispatchEvent(
  cfg: WorkerConfig,
  rpc: SupabaseClient,
  eventName: string,
  payload: Record<string, unknown>,
): Promise<DispatchResult> {
  switch (eventName) {
    case "notification.dispatch":
      return await handleNotification(cfg, rpc, payload);
    case "compensation.generate":
    case "escalation.dispatch":
    case "script.render":
      return await handleInngestPassthrough(cfg, eventName, payload);
    default:
      if (cfg.dryRun) {
        console.log(`[dry-run] ${eventName}`, JSON.stringify(payload));
        return { ok: true };
      }
      return { ok: false, error: `unknown event_name: ${eventName}` };
  }
}
