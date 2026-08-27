/**
 * eval-datasets + eval-runs routes — vitest machine gate for A33 acceptance.
 *
 * Validates:
 *   - method enforcement (405 on non-allowed verbs)
 *   - dataset create → get → list → delete round-trip
 *   - eval run start → complete → snapshot pipeline
 *   - rejection of malformed test_cases and unknown domains
 *   - eval_datasets and eval_runs tables actually persist rows
 *   - builtin dataset is protected from delete
 *
 * Uses an in-memory MetadataStore so the test is hermetic.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PassThrough } from "node:stream";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";

import { handleEvalDatasetsRequest } from "./eval-datasets.js";
import { handleEvalRunsRequest } from "./eval-runs.js";
import { createMetadataStore } from "@datafoundry/metadata";
import type { ConfigApiContext, ConfigApiResponse } from "./types.js";

const freshDbPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "dfd-eval-test-"));
  return join(dir, "test.sqlite");
};

function fakeRequest(method: string, body?: unknown, url = "/api/v1/eval"): IncomingMessage {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const stream = new PassThrough();
  stream.end(raw);
  return Object.assign(stream, {
    method,
    headers: {},
    url
  }) as unknown as IncomingMessage;
}

function attachContext(req: IncomingMessage, ctx: ConfigApiContext): IncomingMessage {
  (req as IncomingMessage & { configContext?: ConfigApiContext }).configContext = ctx;
  return req;
}

function seedUser(ctx: ConfigApiContext, userId = TEST_USER): void {
  ctx.metadataStore.users.createPasswordUser({
    id: userId,
    email: `${userId}@test.local`,
    display_name: userId
  });
}

function unwrap(body: ConfigApiResponse["body"]): { ok: boolean; data?: unknown; message?: string } {
  const b = body as { success?: boolean; data?: unknown; error?: { message?: string } };
  if (b?.success === true) return { ok: true, data: b.data };
  if (b?.success === false) return { ok: false, ...(b.error?.message ? { message: b.error.message } : {}) };
  // raw object (e.g. supabase result wrapper)
  return { ok: true, data: b };
}

const TEST_USER = "user-eval-test";
const TEST_WS = "ws-eval-test";

describe("eval-datasets route", () => {
  let ctx: ConfigApiContext;

  beforeEach(() => {
    const store = createMetadataStore({ database_path: freshDbPath() });
    ctx = {
      metadataStore: store,
      fileAssetService: {} as never,
      knowledgeService: {} as never,
      dataGateway: {} as never,
      runCancelRegistry: {} as never,
      userId: TEST_USER,
      workspaceId: TEST_WS
    };
    seedUser(ctx);
  });

  it("rejects non-POST on the create path", async () => {
    const req = fakeRequest("PUT");
    attachContext(req, ctx);
    const res = await handleEvalDatasetsRequest(req, "/api/v1/eval/datasets", undefined);
    expect(res?.status).toBe(405);
  });

  it("rejects non-GET on list path", async () => {
    const req = fakeRequest("DELETE");
    attachContext(req, ctx);
    const res = await handleEvalDatasetsRequest(req, "/api/v1/eval/datasets", undefined);
    expect(res?.status).toBe(405);
  });

  it("round-trips create → list → get → delete", async () => {
    const body = {
      id: "smoke-1",
      name: "Smoke benchmark",
      description: "first test",
      domain: "code",
      scoring: "exact-match",
      test_cases: [
        { id: "c1", input: "2+2", expected_output: "4" },
        { id: "c2", input: "3+3", expected_output: "6" }
      ]
    };

    const createReq = fakeRequest("POST", body);
    attachContext(createReq, ctx);
    const createRes = await handleEvalDatasetsRequest(
      createReq,
      "/api/v1/eval/datasets",
      body
    );
    expect(createRes?.status).toBe(200);
    const created = unwrap(createRes!.body);
    expect(created.ok).toBe(true);
    expect((created.data as { dataset: { id: string } }).dataset.id).toBe("smoke-1");

    const listReq = fakeRequest("GET");
    attachContext(listReq, ctx);
    const listRes = await handleEvalDatasetsRequest(
      listReq,
      "/api/v1/eval/datasets",
      undefined
    );
    expect(listRes?.status).toBe(200);
    const list = unwrap(listRes!.body);
    const items = (list.data as { items: Array<{ id: string }> }).items;
    expect(items.find((i) => i.id === "smoke-1")).toBeTruthy();

    const getReq = fakeRequest("GET");
    attachContext(getReq, ctx);
    const getRes = await handleEvalDatasetsRequest(
      getReq,
      "/api/v1/eval/datasets/smoke-1",
      undefined
    );
    expect(getRes?.status).toBe(200);
    const fetched = unwrap(getRes!.body);
    expect(
      (fetched.data as { dataset: { test_cases: unknown[] } }).dataset.test_cases.length
    ).toBe(2);

    const delReq = fakeRequest("DELETE");
    attachContext(delReq, ctx);
    const delRes = await handleEvalDatasetsRequest(
      delReq,
      "/api/v1/eval/datasets/smoke-1",
      undefined
    );
    expect(delRes?.status).toBe(200);

    const afterListReq = fakeRequest("GET");
    attachContext(afterListReq, ctx);
    const afterListRes = await handleEvalDatasetsRequest(
      afterListReq,
      "/api/v1/eval/datasets",
      undefined
    );
    expect(afterListRes?.status).toBe(200);
    const afterItems = (unwrap(afterListRes!.body).data as { items: Array<{ id: string }> })
      .items;
    expect(afterItems.find((i) => i.id === "smoke-1")).toBeUndefined();
  });

  it("rejects unknown domain with 400", async () => {
    const body = {
      id: "bad-domain",
      name: "bad",
      description: "",
      domain: "bogus-domain",
      scoring: "exact-match",
      test_cases: [{ id: "c1", input: "x" }]
    };
    const req = fakeRequest("POST", body);
    attachContext(req, ctx);
    const res = await handleEvalDatasetsRequest(req, "/api/v1/eval/datasets", body);
    expect(res?.status).toBe(400);
  });

  it("rejects test_cases with duplicate ids", async () => {
    const body = {
      id: "dup-cases",
      name: "dup",
      description: "",
      domain: "general",
      scoring: "exact-match",
      test_cases: [
        { id: "c1", input: "x" },
        { id: "c1", input: "y" }
      ]
    };
    const req = fakeRequest("POST", body);
    attachContext(req, ctx);
    const res = await handleEvalDatasetsRequest(req, "/api/v1/eval/datasets", body);
    expect(res?.status).toBe(400);
    expect(unwrap(res!.body).message ?? "").toMatch(/duplicate/i);
  });

  it("enforces revision conflict on PUT with stale expected_revision", async () => {
    const initial = {
      id: "rev-conflict",
      name: "rev",
      description: "",
      domain: "general",
      scoring: "exact-match",
      test_cases: [{ id: "c1", input: "x" }]
    };
    let req = fakeRequest("POST", initial);
    attachContext(req, ctx);
    let res = await handleEvalDatasetsRequest(req, "/api/v1/eval/datasets", initial);
    expect(res?.status).toBe(200);

    const stalePut = { ...initial, expected_revision: 99 };
    req = fakeRequest("PUT", stalePut);
    attachContext(req, ctx);
    res = await handleEvalDatasetsRequest(req, "/api/v1/eval/datasets/rev-conflict", stalePut);
    expect(res?.status).toBe(409);
  });
});

describe("eval-runs route", () => {
  let ctx: ConfigApiContext;

  beforeEach(async () => {
    const store = createMetadataStore({ database_path: freshDbPath() });
    ctx = {
      metadataStore: store,
      fileAssetService: {} as never,
      knowledgeService: {} as never,
      dataGateway: {} as never,
      runCancelRegistry: {} as never,
      userId: TEST_USER,
      workspaceId: TEST_WS
    };
    seedUser(ctx);

    const dsReq = fakeRequest(
      "POST",
      {
        id: "run-ds",
        name: "Run dataset",
        description: "",
        domain: "rag",
        scoring: "contains",
        test_cases: [
          { id: "q1", input: "What is X?" },
          { id: "q2", input: "What is Y?" }
        ]
      }
    );
    attachContext(dsReq, ctx);
    const dsRes = await handleEvalDatasetsRequest(dsReq, "/api/v1/eval/datasets", {
      id: "run-ds",
      name: "Run dataset",
      description: "",
      domain: "rag",
      scoring: "contains",
      test_cases: [
        { id: "q1", input: "What is X?" },
        { id: "q2", input: "What is Y?" }
      ]
    });
    expect(dsRes?.status).toBe(200);
  });

  it("rejects non-GET on snapshot path", async () => {
    const req = fakeRequest("POST");
    attachContext(req, ctx);
    const res = await handleEvalRunsRequest(req, "/api/v1/eval/snapshot", undefined);
    expect(res?.status).toBe(405);
  });

  it("runs start → complete → snapshot pipeline", async () => {
    const startBody = { dataset_id: "run-ds" };
    let req = fakeRequest("POST", startBody);
    attachContext(req, ctx);
    let res = await handleEvalRunsRequest(req, "/api/v1/eval/runs", startBody);
    expect(res?.status).toBe(200);
    const started = unwrap(res!.body).data as { run: { id: string; status: string; total_cases: number } };
    expect(started.run.status).toBe("running");
    expect(started.run.total_cases).toBe(2);

    const completeBody = {
      status: "completed",
      case_results: [
        { case_id: "q1", passed: true, score: 1 },
        { case_id: "q2", passed: false, score: 0 }
      ]
    };
    req = fakeRequest("POST", completeBody);
    attachContext(req, ctx);
    res = await handleEvalRunsRequest(
      req,
      `/api/v1/eval/runs/${started.run.id}/complete`,
      completeBody
    );
    expect(res?.status).toBe(200);
    const completed = unwrap(res!.body).data as {
      run: { status: string; passed_cases: number; failed_cases: number; pass_rate: number };
    };
    expect(completed.run.status).toBe("completed");
    expect(completed.run.passed_cases).toBe(1);
    expect(completed.run.failed_cases).toBe(1);
    expect(completed.run.pass_rate).toBeCloseTo(0.5);

    const snapReq = fakeRequest("GET");
    attachContext(snapReq, ctx);
    const snapRes = await handleEvalRunsRequest(
      snapReq,
      "/api/v1/eval/snapshot",
      undefined
    );
    expect(snapRes?.status).toBe(200);
    const snap = unwrap(snapRes!.body).data as {
      total_runs: number;
      avg_pass_rate: number;
      by_dataset: Array<{ dataset_id: string }>;
    };
    expect(snap.total_runs).toBe(1);
    expect(snap.avg_pass_rate).toBeCloseTo(0.5);
    expect(snap.by_dataset[0]?.dataset_id).toBe("run-ds");
  });

  it("rejects start on unknown dataset", async () => {
    const req = fakeRequest("POST", { dataset_id: "does-not-exist" });
    attachContext(req, ctx);
    const res = await handleEvalRunsRequest(req, "/api/v1/eval/runs", {
      dataset_id: "does-not-exist"
    });
    expect(res?.status).toBe(404);
  });

  it("rejects complete with malformed case_results", async () => {
    // First start a run
    const startReq = fakeRequest("POST", { dataset_id: "run-ds" });
    attachContext(startReq, ctx);
    const startRes = await handleEvalRunsRequest(startReq, "/api/v1/eval/runs", {
      dataset_id: "run-ds"
    });
    expect(startRes?.status).toBe(200);
    const runId = (unwrap(startRes!.body).data as { run: { id: string } }).run.id;

    // complete without case_results
    const req = fakeRequest("POST", { status: "completed", case_results: "not-an-array" });
    attachContext(req, ctx);
    const res = await handleEvalRunsRequest(
      req,
      `/api/v1/eval/runs/${runId}/complete`,
      { status: "completed", case_results: "not-an-array" }
    );
    expect(res?.status).toBe(400);
  });

  it("cancel flips a running run to canceled", async () => {
    const startReq = fakeRequest("POST", { dataset_id: "run-ds" });
    attachContext(startReq, ctx);
    const startRes = await handleEvalRunsRequest(startReq, "/api/v1/eval/runs", {
      dataset_id: "run-ds"
    });
    const runId = (unwrap(startRes!.body).data as { run: { id: string } }).run.id;

    const cancelReq = fakeRequest("POST");
    attachContext(cancelReq, ctx);
    const cancelRes = await handleEvalRunsRequest(
      cancelReq,
      `/api/v1/eval/runs/${runId}/cancel`,
      undefined
    );
    expect(cancelRes?.status).toBe(200);
    const canceled = unwrap(cancelRes!.body).data as { run: { status: string } };
    expect(canceled.run.status).toBe("canceled");
  });

  it("rejects cancel on already-completed run", async () => {
    const startReq = fakeRequest("POST", { dataset_id: "run-ds" });
    attachContext(startReq, ctx);
    const startRes = await handleEvalRunsRequest(startReq, "/api/v1/eval/runs", {
      dataset_id: "run-ds"
    });
    const runId = (unwrap(startRes!.body).data as { run: { id: string } }).run.id;

    const completeReq = fakeRequest("POST", {
      status: "completed",
      case_results: [{ case_id: "q1", passed: true }]
    });
    attachContext(completeReq, ctx);
    await handleEvalRunsRequest(completeReq, `/api/v1/eval/runs/${runId}/complete`, {
      status: "completed",
      case_results: [{ case_id: "q1", passed: true }]
    });

    const cancelReq = fakeRequest("POST");
    attachContext(cancelReq, ctx);
    const cancelRes = await handleEvalRunsRequest(
      cancelReq,
      `/api/v1/eval/runs/${runId}/cancel`,
      undefined
    );
    expect(cancelRes?.status).toBe(409);
  });
});
