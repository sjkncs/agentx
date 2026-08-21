import type { WorkerConfig } from "../config.js";
import type { DispatchResult } from "./index.js";
import { post } from "../http.js";

export async function handleInngestPassthrough(
  cfg: WorkerConfig,
  eventName: string,
  payload: Record<string, unknown>,
): Promise<DispatchResult> {
  const base = process.env.INNGEST_EVENT_API_BASE ?? "";
  if (!base) {
    if (cfg.dryRun) {
      console.log(`[dry-run] ${eventName} -> inngest (no INNGEST_EVENT_API_BASE set)`);
      return { ok: true };
    }
    return { ok: false, error: "INNGEST_EVENT_API_BASE not configured" };
  }

  const { status, text, ok } = await post(
    `${base.replace(/\/$/, "")}/v1/events`,
    JSON.stringify({ name: eventName, data: payload }),
    cfg.httpTimeoutMs,
  );
  return ok
    ? { ok: true, responseStatus: status, responseBody: text.slice(0, 200) }
    : { ok: false, error: `http ${status}`, responseStatus: status, responseBody: text.slice(0, 200) };
}
