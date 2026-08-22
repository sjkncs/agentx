/**
 * VLM describe route — vitest machine gate for AC-10.
 *
 * Validates:
 *   - method = POST;
 *   - body parsing tolerates empty / malformed JSON;
 *   - the deterministic fallback returns canonical mood + response_length
 *     values and signals `fallback: true`;
 *   - the same image set always returns the same suggestion (deterministic).
 */

import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import type { IncomingMessage } from "node:http";

import { handleVlmDescribeRequest } from "./vlm-describe.js";

const fakeRequest = (method: string, body: unknown): IncomingMessage => {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const stream = new PassThrough();
  stream.end(raw);
  const req = Object.assign(stream, { method, headers: {}, url: "/api/v1/vlm/describe" });
  return req as unknown as IncomingMessage;
};

describe("vlm-describe route", () => {
  it("rejects non-POST", async () => {
    const req = fakeRequest("GET", { reference_images: [] });
    const res = await handleVlmDescribeRequest(req, {} as never);
    expect(res.status).toBe(405);
  });

  it("returns canonical fields + fallback flag on empty body", async () => {
    const req = fakeRequest("POST", { reference_images: [] });
    const res = await handleVlmDescribeRequest(req, {} as never);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: expect.objectContaining({
        fallback: true,
        provider: null,
      }),
    });
  });

  it("falls back to a 200/empty archetype when no images are provided", async () => {
    const req = fakeRequest("POST", {});
    const res = await handleVlmDescribeRequest(req, {} as never);
    expect(res.status).toBe(200);
    const body = res.body as { success: boolean; data: { mood: string; response_length: string; archetype: string } };
    expect(body.success).toBe(true);
    // mood is one of the eight canonical values
    expect([
      "outgoing", "shy", "attentive", "depressive", "playful", "stoic", "curious", "warm",
    ]).toContain(body.data.mood);
    expect([
      "one_sentence", "short", "paragraph", "long",
    ]).toContain(body.data.response_length);
    expect(typeof body.data.archetype).toBe("string");
  });

  it("is deterministic for the same image set", async () => {
    const hashes = [
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ];
    const req1 = fakeRequest("POST", { reference_images: hashes });
    const req2 = fakeRequest("POST", { reference_images: hashes });
    const r1 = await handleVlmDescribeRequest(req1, {} as never);
    const r2 = await handleVlmDescribeRequest(req2, {} as never);
    const d1 = (r1.body as { data: Record<string, unknown> }).data;
    const d2 = (r2.body as { data: Record<string, unknown> }).data;
    expect(d1.mood).toBe(d2.mood);
    expect(d1.response_length).toBe(d2.response_length);
    expect(d1.archetype).toBe(d2.archetype);
  });

  it("survives malformed JSON without throwing", async () => {
    const stream = new PassThrough();
    stream.end("not-json");
    const req = Object.assign(stream, {
      method: "POST",
      headers: {},
      url: "/api/v1/vlm/describe",
    }) as unknown as IncomingMessage;
    const res = await handleVlmDescribeRequest(req, {} as never);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
  });
});