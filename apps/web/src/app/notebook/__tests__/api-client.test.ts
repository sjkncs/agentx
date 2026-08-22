/**
 * Tests for `notebook/api-client.ts`. We stub `fetch` so we can assert the
 * URL, method, body shape, and ApiResult unwrapping without spinning up a
 * real server.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NotebookDashboardApiError,
  notebookDashboardApi,
} from "../api-client";

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function mockFetch(impl: (call: FetchCall) => Promise<Response> | Response) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return impl(calls[calls.length - 1]!);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("notebookDashboardApi", () => {
  it("lists notebooks and unwraps the data envelope", async () => {
    const calls = mockFetch(() =>
      jsonResponse({
        data: {
          items: [{ id: "nb-1", title: "Welcome", cells: [] }],
        },
      }),
    );
    const items = await notebookDashboardApi.listNotebooks();
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("nb-1");
    expect(calls[0]?.url).toBe("/api/v1/notebooks");
  });

  it("creates a notebook with POST", async () => {
    const calls = mockFetch(() =>
      jsonResponse({ data: { id: "nb-new", title: "New", cells: [] } }),
    );
    const nb = await notebookDashboardApi.createNotebook({ title: "New" });
    expect(nb.id).toBe("nb-new");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ title: "New" });
  });

  it("runs a notebook and returns the results", async () => {
    mockFetch(() =>
      jsonResponse({
        data: {
          results: [
            {
              cellId: "cell-1",
              status: "completed",
              outputs: [{ kind: "text", text: "ok" }],
              durationMs: 5,
            },
          ],
        },
      }),
    );
    const results = await notebookDashboardApi.runNotebook("nb-1");
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("completed");
  });

  it("raises NotebookDashboardApiError on a 4xx response", async () => {
    mockFetch(() =>
      jsonResponse(
        {
          error: { code: "RESOURCE_NOT_FOUND", message: "notebook not found" },
        },
        404,
      ),
    );
    await expect(notebookDashboardApi.getNotebook("nb-missing")).rejects.toThrow(
      NotebookDashboardApiError,
    );
  });

  it("wraps a non-JSON response in a friendly error", async () => {
    mockFetch(() => new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    await expect(notebookDashboardApi.listNotebooks()).rejects.toThrow(/Non-JSON/);
  });

  it("applies a dashboard template", async () => {
    const calls = mockFetch(() =>
      jsonResponse({ data: { id: "db-1", title: "Ops", widgets: [] } }),
    );
    const db = await notebookDashboardApi.applyDashboardTemplate("ops-overview");
    expect(db.title).toBe("Ops");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      templateId: "ops-overview",
    });
  });

  it("shares a notebook and returns a token", async () => {
    mockFetch(() =>
      jsonResponse({ data: { token: "abcdef1234567890abcdef" } }),
    );
    const { token } = await notebookDashboardApi.shareNotebook("nb-1");
    expect(token).toMatch(/^[a-z0-9]+$/);
  });
});