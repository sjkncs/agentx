import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseClient } from "./supabase.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("supabase client", () => {
  it("is disabled without env config and no-ops", async () => {
    const client = createSupabaseClient();
    expect(client.enabled).toBe(false);
    expect(await client.listTasks("u")).toEqual([]);
    await client.upsertTask({} as never); // should not throw
    await client.deleteTask("x"); // should not throw
  });

  it("maps list/upsert/delete to PostgREST endpoints when configured", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co/");
    vi.stubEnv("SUPABASE_ANON_KEY", "test-key");

    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string }) => {
        calls.push({ url, method: init?.method ?? "GET" });
        return { ok: true, json: async () => [{ id: "a", user_id: "u", name: "n", prompt: "p", interval_minutes: 5, enabled: true, created_at: 1, next_run_at: 2 }] };
      }),
    );

    const client = createSupabaseClient();
    expect(client.enabled).toBe(true);

    const rows = await client.listTasks("u");
    expect(rows).toHaveLength(1);
    expect(calls[0]!.url).toContain("https://example.supabase.co/rest/v1/scheduled_tasks?user_id=eq.u");

    await client.upsertTask({ id: "a", user_id: "u", name: "n", prompt: "p", interval_minutes: 5, enabled: true, created_at: 1, next_run_at: 2 });
    expect(calls[1]!.method).toBe("POST");

    await client.deleteTask("a");
    expect(calls[2]!.method).toBe("DELETE");
    expect(calls[2]!.url).toContain("id=eq.a");
  });
});
