import { NextResponse } from "next/server";
import { getSubagentInboxStore } from "./store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const fetchCache = "force-no-store";

/**
 * GET /api/subagents/list
 *   { ok: true, data: { subs: SubagentSummary[] } }
 *   { ok: false, error: string }
 *
 * GET /api/subagents/messages?id=<subagentId>
 *   { ok: true, data: { messages: InboxMessage[] } }
 */

interface ListOk {
  ok: true;
  data: { subs: ReturnType<ReturnType<typeof getSubagentInboxStore>["list"]> };
}
interface MsgsOk {
  ok: true;
  data: { messages: ReturnType<ReturnType<typeof getSubagentInboxStore>["messagesOf"]> };
}
interface Err {
  ok: false;
  error: string;
}

export async function GET(request: Request): Promise<NextResponse<ListOk | MsgsOk | Err>> {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "list";

  if (action === "messages") {
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json<Err>({ ok: false, error: "Missing 'id'" }, { status: 400 });
    const messages = getSubagentInboxStore().messagesOf(id);
    return NextResponse.json<MsgsOk>({ ok: true, data: { messages } });
  }

  // default: list
  const subs = getSubagentInboxStore().list();
  return NextResponse.json<ListOk>({ ok: true, data: { subs } });
}