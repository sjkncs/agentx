/**
 * HTTP routing for the semantic layer MVP.
 *
 * Three sub-resources:
 *   • /api/v1/semantic/metrics      — first-class metric definitions
 *   • /api/v1/semantic/entities     — entity catalog
 *   • /api/v1/semantic/lineage      — lineage graph
 *
 * Endpoints:
 *   GET/POST/PUT/DELETE /api/v1/semantic/metrics
 *   GET/POST/PUT/DELETE /api/v1/semantic/entities
 *   GET/POST/DELETE /api/v1/semantic/lineage
 *   GET /api/v1/semantic/resolve?query=...
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createErrorResult, createSuccessResult } from "@datafoundry/contracts";
import { SemanticLayerRepository } from "./semantic-layer.js";

export interface SemanticLayerDeps {
  repository: SemanticLayerRepository;
}

const PREFIX = "/api/v1/semantic";

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) request.destroy();
    });
    request.on("end", () => {
      if (!raw) return resolve(undefined);
      try { resolve(JSON.parse(raw) as Record<string, unknown>); }
      catch { resolve(undefined); }
    });
    request.on("error", () => resolve(undefined));
  });
}

export async function handleSemanticLayerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  _userId: string,
  workspaceId: string,
  deps: SemanticLayerDeps,
): Promise<boolean> {
  if (!pathname.startsWith(PREFIX)) return false;
  const repo = deps.repository;
  const method = request.method ?? "GET";
  const tail = pathname.slice(PREFIX.length).replace(/^\/+/, "");
  const pathParts = tail.split("/").filter(Boolean);

  try {
    // GET /api/v1/semantic/resolve?query=...&catalogId=...
    if (pathParts[0] === "resolve" && method === "GET") {
      const url = new URL(request.url ?? "/", "http://localhost");
      const query = url.searchParams.get("query") ?? "";
      const catalogId = url.searchParams.get("catalogId") ?? workspaceId;
      const result = repo.resolveForQuery(catalogId, query);
      sendJson(response, 200, createSuccessResult(result));
      return true;
    }

    // ── /metrics ────────────────────────────────────────────────────────────
    if (pathParts[0] === "metrics") {
      const id = pathParts[1];

      if (method === "GET" && id === undefined) {
        const url = new URL(request.url ?? "/", "http://localhost");
        const query = url.searchParams.get("query");
        const catalogId = url.searchParams.get("catalogId") ?? workspaceId;
        const metrics = query ? repo.searchMetrics(catalogId, query) : repo.listMetrics(catalogId);
        sendJson(response, 200, createSuccessResult({ metrics }));
        return true;
      }

      if (method === "GET" && id) {
        const metric = repo.getMetric(id);
        if (!metric) {
          sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", `Metric '${id}' not found`));
        } else {
          sendJson(response, 200, createSuccessResult(metric));
        }
        return true;
      }

      if ((method === "POST" || method === "PUT") && id) {
        const body = await readBody(request);
        if (!body) {
          sendJson(response, 400, createErrorResult("BAD_REQUEST", "Invalid JSON body"));
          return true;
        }
        const metric = repo.upsertMetric({
          id: String(id),
          catalogId: String(body.catalogId ?? workspaceId),
          name: String(body.name ?? ""),
          displayName: String(body.displayName ?? body.name ?? ""),
          description: String(body.description ?? ""),
          metricType: (body.metricType ?? "custom") as never,
          expression: String(body.expression ?? ""),
          baseQuery: String(body.baseQuery ?? ""),
          dimensions: Array.isArray(body.dimensions) ? body.dimensions as string[] : [],
          filters: Array.isArray(body.filters) ? body.filters as string[] : [],
          aggregationTimeframe: String(body.aggregationTimeframe ?? ""),
          unitOfMeasurement: String(body.unitOfMeasurement ?? ""),
          ownerEmail: String(body.ownerEmail ?? ""),
          status: (body.status ?? "draft") as "draft" | "active" | "deprecated",
          approvedBy: String(body.approvedBy ?? ""),
          approvedAt: String(body.approvedAt ?? ""),
        });
        sendJson(response, 200, createSuccessResult(metric));
        return true;
      }

      if (method === "DELETE" && id) {
        const ok = repo.deleteMetric(id);
        sendJson(response, 200, createSuccessResult({ deleted: ok }));
        return true;
      }
    }

    // ── /entities ────────────────────────────────────────────────────────────
    if (pathParts[0] === "entities") {
      const id = pathParts[1];

      if (method === "GET" && id === undefined) {
        const catalogId = new URL(request.url ?? "/", "http://localhost").searchParams.get("catalogId") ?? workspaceId;
        const entities = repo.listEntities(catalogId);
        sendJson(response, 200, createSuccessResult({ entities }));
        return true;
      }

      if (method === "GET" && id) {
        const entity = repo.getEntity(id);
        if (!entity) {
          sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", `Entity '${id}' not found`));
        } else {
          sendJson(response, 200, createSuccessResult(entity));
        }
        return true;
      }

      if ((method === "POST" || method === "PUT") && id) {
        const body = await readBody(request);
        if (!body) {
          sendJson(response, 400, createErrorResult("BAD_REQUEST", "Invalid JSON body"));
          return true;
        }
        const entity = repo.upsertEntity({
          id: String(id),
          catalogId: String(body.catalogId ?? workspaceId),
          name: String(body.name ?? ""),
          displayName: String(body.displayName ?? body.name ?? ""),
          description: String(body.description ?? ""),
          classification: (body.classification ?? "core") as "core" | "supporting" | "lookup" | "log",
          primaryKeyColumns: Array.isArray(body.primaryKeyColumns) ? body.primaryKeyColumns as string[] : [],
          memberTables: Array.isArray(body.memberTables) ? body.memberTables as string[] : [],
          joinPaths: String(body.joinPaths ?? ""),
          ownerEmail: String(body.ownerEmail ?? ""),
        });
        sendJson(response, 200, createSuccessResult(entity));
        return true;
      }

      if (method === "DELETE" && id) {
        const ok = repo.deleteEntity(id);
        sendJson(response, 200, createSuccessResult({ deleted: ok }));
        return true;
      }
    }

    // ── /lineage ─────────────────────────────────────────────────────────────
    if (pathParts[0] === "lineage") {
      const nodeId = pathParts[1];

      if (method === "GET" && nodeId) {
        const result = repo.getLineageAt(nodeId);
        if (!result) {
          sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", `Lineage node '${nodeId}' not found`));
        } else {
          sendJson(response, 200, createSuccessResult(result));
        }
        return true;
      }

      if (method === "DELETE" && nodeId) {
        const removed = repo.deleteLineageForNode(nodeId);
        sendJson(response, 200, createSuccessResult({ removed }));
        return true;
      }
    }

    sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", `Unsupported semantic route: ${pathname}`));
    return true;
  } catch (err) {
    console.error("[semantic-layer-routes] error", err);
    sendJson(response, 500, createErrorResult("INTERNAL_ERROR",
      err instanceof Error ? err.message : String(err)));
    return true;
  }
}
