/**
 * HTTP routing for `/api/v1/semantic-catalog`.
 *
 * Endpoints:
 *   GET    /api/v1/semantic-catalog                → list all catalogs
 *   POST   /api/v1/semantic-catalog                → create catalog
 *   GET    /api/v1/semantic-catalog/:id            → get catalog
 *   PUT    /api/v1/semantic-catalog/:id            → update catalog
 *   DELETE /api/v1/semantic-catalog/:id            → delete catalog
 *
 *   GET    /api/v1/semantic-catalog/:id/columns     → list column descriptions
 *   PUT    /api/v1/semantic-catalog/:id/columns   → upsert column descriptions (batch)
 *   GET    /api/v1/semantic-catalog/:id/columns/:tableName → columns for a table
 *
 *   GET    /api/v1/semantic-catalog/:id/glossary   → list glossary terms
 *   POST   /api/v1/semantic-catalog/:id/glossary   → create term
 *   PUT    /api/v1/semantic-catalog/:id/glossary/:termId → update term
 *   POST   /api/v1/semantic-catalog/:id/glossary/:termId/bind → bind term to column
 *   DELETE /api/v1/semantic-catalog/:id/glossary/:termId → delete term
 *
 *   GET    /api/v1/semantic-catalog/:id/contracts  → list data contracts
 *   PUT    /api/v1/semantic-catalog/:id/contracts  → upsert contract
 *
 *   GET    /api/v1/semantic-catalog/:id/resolve   → resolve semantic context (for grounding)
 *
 *   POST   /api/v1/semantic-catalog/:id/auto-generate → auto-generate column descriptions from schema
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { createErrorResult, createSuccessResult } from "@datafoundry/contracts";

import { SemanticCatalogRepository, SemanticCatalogError } from "./semantic-catalog.js";

export interface SemanticCatalogDeps {
  repository: SemanticCatalogRepository;
}

const PREFIX = "/api/v1/semantic-catalog";

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function errorFromDomain(err: unknown): { status: number; body: unknown } {
  if (err instanceof SemanticCatalogError) {
    const status = err.code === "NOT_FOUND" ? 404 : err.code === "INVALID_ARGUMENT" ? 400 : 500;
    return { status, body: createErrorResult("BAD_REQUEST", err.message) };
  }
  return {
    status: 500,
    body: createErrorResult("INTERNAL_ERROR", err instanceof Error ? err.message : String(err)),
  };
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 5_000_000) { request.destroy(); }
    });
    request.on("end", () => {
      if (!raw) { resolve(undefined); return; }
      try { resolve(JSON.parse(raw) as Record<string, unknown>); }
      catch { resolve(undefined); }
    });
    request.on("error", () => resolve(undefined));
  });
}

export async function handleSemanticCatalogRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  _userId: string,
  workspaceId: string,
  deps: SemanticCatalogDeps,
): Promise<boolean> {
  if (!pathname.startsWith(PREFIX)) return false;
  const repo = deps.repository;
  const method = request.method ?? "GET";
  const tail = pathname.slice(PREFIX.length);

  try {
    // GET /api/v1/semantic-catalog
    if ((tail === "" || tail === "/") && method === "GET") {
      sendJson(response, 200, createSuccessResult({ items: repo.listCatalogs(workspaceId) }));
      return true;
    }

    // POST /api/v1/semantic-catalog
    if ((tail === "" || tail === "/") && method === "POST") {
      const body = (await readJsonBody(request)) ?? {};
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim()
        : "Untitled catalog";
      const catalog = repo.createCatalog({
        workspaceId,
        datasourceId: typeof body.datasourceId === "string" ? body.datasourceId : "",
        name,
        description: typeof body.description === "string" ? body.description : "",
      });
      sendJson(response, 201, createSuccessResult(catalog));
      return true;
    }

    // /:id/...
    const match = tail.match(/^\/([^/]+)(?:\/(.*))?$/);
    if (!match) return false;
    const catalogId = match[1]!;
    const subPath = match[2];

    // GET/PUT/DELETE /:id
    if (subPath === undefined || subPath === "") {
      if (method === "GET") {
        const cat = repo.getCatalog(workspaceId, catalogId);
        if (!cat) { sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", "catalog not found")); return true; }
        sendJson(response, 200, createSuccessResult(cat));
        return true;
      }
      if (method === "PUT") {
        const body = (await readJsonBody(request)) ?? {};
        const updated = repo.updateCatalog({
          workspaceId, catalogId,
          ...(typeof body.name === "string" ? { name: body.name } : {}),
          ...(typeof body.description === "string" ? { description: body.description } : {}),
        });
        sendJson(response, 200, createSuccessResult(updated));
        return true;
      }
      if (method === "DELETE") {
        repo.deleteCatalog(workspaceId, catalogId);
        sendJson(response, 200, createSuccessResult({ removed: true }));
        return true;
      }
      return false;
    }

    // /:id/columns
    if (subPath === "columns" || subPath?.startsWith("/columns/")) {
      const tableName = subPath === "columns" ? undefined : subPath.slice("/columns/".length);
      if (method === "GET") {
        if (tableName) {
          sendJson(response, 200, createSuccessResult({ items: repo.listColumnDescsByTable(catalogId, tableName) }));
        } else {
          sendJson(response, 200, createSuccessResult({ items: repo.listColumnDescs(catalogId) }));
        }
        return true;
      }
      if (method === "PUT" || method === "POST") {
        const body = (await readJsonBody(request)) ?? {};
        if (!Array.isArray(body.columns)) {
          sendJson(response, 400, createErrorResult("BAD_REQUEST", "body.columns must be an array")); return true;
        }
        const results = (body.columns as Array<{
          tableName?: string; columnName?: string;
          description?: string; semanticType?: string; dataType?: string;
          nullable?: boolean; sampleValues?: string[];
        }>).map((col) => repo.upsertColumnDesc({
          catalogId,
          tableName: col.tableName ?? "",
          columnName: col.columnName ?? "",
          ...(col.description !== undefined ? { description: col.description } : {}),
          ...(col.semanticType !== undefined ? { semanticType: col.semanticType } : {}),
          ...(col.dataType !== undefined ? { dataType: col.dataType } : {}),
          ...(col.nullable !== undefined ? { nullable: col.nullable } : {}),
          ...(col.sampleValues !== undefined ? { sampleValues: col.sampleValues } : {}),
        }));
        sendJson(response, 200, createSuccessResult({ items: results }));
        return true;
      }
      return false;
    }

    // /:id/glossary
    if (subPath === "glossary" || subPath?.startsWith("/glossary/")) {
      if (method === "GET") {
        sendJson(response, 200, createSuccessResult({ items: repo.listGlossaryTerms(catalogId) }));
        return true;
      }
      if (method === "POST") {
        const body = (await readJsonBody(request)) ?? {};
        const term = repo.createGlossaryTerm({
          catalogId, term: typeof body.term === "string" ? body.term : "unnamed",
          definition: typeof body.definition === "string" ? body.definition : "",
          businessType: typeof body.businessType === "string" ? body.businessType : "",
        });
        sendJson(response, 201, createSuccessResult(term));
        return true;
      }
      // /glossary/:termId/bind
      const termMatch = subPath.match(/^\/glossary\/([^/]+)\/bind$/);
      if (termMatch && method === "POST") {
        const termId = termMatch[1]!;
        const body = (await readJsonBody(request)) ?? {};
        const binding = repo.bindTermToColumn({
          termId,
          columnDescId: typeof body.columnDescId === "string" ? body.columnDescId : "",
          confidence: typeof body.confidence === "number" ? body.confidence : 1.0,
        });
        sendJson(response, 201, createSuccessResult(binding));
        return true;
      }
      // /glossary/:termId
      const termIdMatch = subPath.match(/^\/glossary\/([^/]+)$/);
      if (termIdMatch) {
        const termId = termIdMatch[1]!;
        if (method === "PUT") {
          const body = (await readJsonBody(request)) ?? {};
          const updated = repo.updateGlossaryTerm({
            id: termId,
            ...(typeof body.definition === "string" ? { definition: body.definition } : {}),
            ...(typeof body.businessType === "string" ? { businessType: body.businessType } : {}),
          });
          sendJson(response, 200, createSuccessResult(updated));
          return true;
        }
        if (method === "DELETE") {
          repo.deleteGlossaryTerm(termId);
          sendJson(response, 200, createSuccessResult({ removed: true }));
          return true;
        }
      }
      return false;
    }

    // /:id/contracts
    if (subPath === "contracts" && method === "PUT") {
      const body = (await readJsonBody(request)) ?? {};
      const contract = repo.upsertDataContract({
        catalogId,
        tableName: typeof body.tableName === "string" ? body.tableName : "",
        ...(typeof body.description === "string" ? { description: body.description } : {}),
        ...(typeof body.expectations === "object" && body.expectations !== null
          ? { expectations: body.expectations as Record<string, import("./semantic-catalog.js").ColumnExpectation> }
          : {}),
      });
      sendJson(response, 200, createSuccessResult(contract));
      return true;
    }
    if (subPath === "contracts" && method === "GET") {
      sendJson(response, 200, createSuccessResult({ items: repo.listDataContracts(catalogId) }));
      return true;
    }

    // /:id/resolve — resolve semantic context (for agent grounding)
    if (subPath === "resolve" && method === "GET") {
      const cat = repo.getCatalog(workspaceId, catalogId);
      if (!cat) { sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", "catalog not found")); return true; }
      const ctx = repo.resolveSemanticContext(workspaceId, cat.datasourceId);
      sendJson(response, 200, createSuccessResult(ctx));
      return true;
    }

    return false;
  } catch (err) {
    const { status, body } = errorFromDomain(err);
    sendJson(response, status, body);
    return true;
  }
}
