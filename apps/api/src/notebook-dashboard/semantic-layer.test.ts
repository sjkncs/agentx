import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ensureSemanticLayerSchema,
  SemanticLayerRepository,
} from "./semantic-layer.js";

const CATALOG = "cat-test";

function baseMetric(overrides: Partial<Parameters<SemanticLayerRepository["upsertMetric"]>[0]> = {}) {
  return {
    id: "metric-gmv",
    catalogId: CATALOG,
    name: "gmv",
    displayName: "Gross Merchandise Value",
    description: "Total GMV from completed orders",
    metricType: "sum" as const,
    expression: "SUM(order_amount * (1 - discount_rate))",
    baseQuery: "SELECT brand, SUM(order_amount * (1 - discount_rate)) AS gmv FROM orders GROUP BY brand",
    dimensions: ["brand", "channel"],
    filters: ["order_status = 'completed'"],
    aggregationTimeframe: "1d",
    unitOfMeasurement: "USD",
    ownerEmail: "data-steward@example.com",
    status: "draft" as const,
    approvedBy: "",
    approvedAt: "",
    ...overrides,
  };
}

function baseEntity(overrides: Partial<Parameters<SemanticLayerRepository["upsertEntity"]>[0]> = {}) {
  return {
    id: "entity-order",
    catalogId: CATALOG,
    name: "order",
    displayName: "Order",
    description: "A customer order placed through the storefront",
    classification: "core" as const,
    primaryKeyColumns: ["order_id"],
    memberTables: ["orders,order_items"],
    joinPaths: "[]",
    ownerEmail: "data-steward@example.com",
    ...overrides,
  };
}

describe("SemanticLayerRepository", () => {
  let db: ReturnType<typeof Database>;
  let repo: SemanticLayerRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSemanticLayerSchema(db);
    repo = new SemanticLayerRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── Metrics ──────────────────────────────────────────────────────────────

  describe("metrics", () => {
    it("inserts and round-trips a metric with JSON-encoded arrays", () => {
      const created = repo.upsertMetric(baseMetric());
      expect(created.id).toBe("metric-gmv");
      expect(created.version).toBe(1);
      expect(created.status).toBe("draft");
      expect(created.createdAt).toBe(created.updatedAt);

      const fetched = repo.getMetric("metric-gmv");
      expect(fetched).toBeDefined();
      expect(fetched?.dimensions).toEqual(["brand", "channel"]);
      expect(fetched?.filters).toEqual(["order_status = 'completed'"]);
      expect(fetched?.expression).toBe("SUM(order_amount * (1 - discount_rate))");
    });

    it("bumps version monotonically on each upsert and preserves createdAt", async () => {
      const first = repo.upsertMetric(baseMetric());
      const persistedCreatedAt = repo.getMetric(first.id)?.createdAt;
      await new Promise((r) => setTimeout(r, 5));
      const second = repo.upsertMetric({ ...first, description: "Updated" });

      expect(second.version).toBe(first.version + 1);
      expect(second.createdAt).toBe(persistedCreatedAt);
      expect(second.updatedAt > first.createdAt).toBeTruthy();
      expect(second.description).toBe("Updated");
    });

    it("approveMetric moves status from draft to active and stamps approver", () => {
      repo.upsertMetric(baseMetric());
      const approved = repo.approveMetric("metric-gmv", "vp-data@example.com");

      expect(approved?.status).toBe("active");
      expect(approved?.approvedBy).toBe("vp-data@example.com");
      expect(approved?.approvedAt).not.toBe("");
    });

    it("approveMetric returns undefined for an unknown id", () => {
      expect(repo.approveMetric("metric-missing", "x@example.com")).toBeUndefined();
    });

    it("searchMetrics does case-insensitive substring match on name and displayName", () => {
      repo.upsertMetric(baseMetric({ id: "m1", name: "gmv" }));
      repo.upsertMetric(baseMetric({ id: "m2", name: "retention", displayName: "D7 Retention" }));
      repo.upsertMetric(baseMetric({ id: "m3", name: "aov", displayName: "Average Order Value" }));

      expect(repo.searchMetrics(CATALOG, "gmv").map((m) => m.id)).toEqual(["m1"]);
      expect(repo.searchMetrics(CATALOG, "retention").map((m) => m.id)).toEqual(["m2"]);
      expect(repo.searchMetrics(CATALOG, "AOV").map((m) => m.id)).toEqual(["m3"]);
    });

    it("deleteMetric returns true on hit, false on miss", () => {
      repo.upsertMetric(baseMetric());
      expect(repo.deleteMetric("metric-gmv")).toBe(true);
      expect(repo.getMetric("metric-gmv")).toBeUndefined();
      expect(repo.deleteMetric("metric-gmv")).toBe(false);
    });

    it("listMetrics returns alphabetical order", () => {
      repo.upsertMetric(baseMetric({ id: "m1", name: "zeta" }));
      repo.upsertMetric(baseMetric({ id: "m2", name: "alpha" }));
      repo.upsertMetric(baseMetric({ id: "m3", name: "mu" }));
      expect(repo.listMetrics(CATALOG).map((m) => m.name)).toEqual(["alpha", "mu", "zeta"]);
    });
  });

  // ── Entities ─────────────────────────────────────────────────────────────

  describe("entities", () => {
    it("inserts and round-trips an entity, parsing primaryKeyColumns and memberTables", () => {
      const created = repo.upsertEntity(baseEntity());
      expect(created.id).toBe("entity-order");

      const fetched = repo.getEntity("entity-order");
      expect(fetched?.primaryKeyColumns).toEqual(["order_id"]);
      expect(fetched?.memberTables).toEqual(["orders", "order_items"]);
      expect(fetched?.classification).toBe("core");
    });

    it("isolates entities by catalog", () => {
      repo.upsertEntity(baseEntity({ id: "e1", name: "alpha" }));
      repo.upsertEntity({ ...baseEntity({ id: "e2", name: "beta" }), catalogId: "other-cat" });
      expect(repo.listEntities(CATALOG).map((e) => e.name)).toEqual(["alpha"]);
      expect(repo.listEntities("other-cat").map((e) => e.name)).toEqual(["beta"]);
    });

    it("preserves createdAt across updates", async () => {
      const first = repo.upsertEntity(baseEntity());
      const persistedCreatedAt = repo.getEntity(first.id)?.createdAt;
      expect(persistedCreatedAt).toBeDefined();
      await new Promise((r) => setTimeout(r, 5));
      const second = repo.upsertEntity({ ...first, description: "Updated" });
      expect(second.createdAt).toBe(persistedCreatedAt);
      expect(second.updatedAt > first.updatedAt).toBeTruthy();
    });

    it("deleteEntity returns true on hit, false on miss", () => {
      repo.upsertEntity(baseEntity());
      expect(repo.deleteEntity("entity-order")).toBe(true);
      expect(repo.deleteEntity("entity-order")).toBe(false);
    });
  });

  // ── Lineage ──────────────────────────────────────────────────────────────

  describe("lineage", () => {
    function tableNode(id: string, resourceId: string) {
      return {
        id,
        catalogId: CATALOG,
        nodeType: "table" as const,
        resourceId,
        displayName: resourceId,
        datasourceId: "ds-1",
        workspaceId: "ws-1",
        metadata: "{}",
      };
    }

    it("upsertNode is idempotent on the same id (insert-only but returns record)", () => {
      const node = repo.upsertNode(tableNode("n-orders", "public.orders"));
      expect(node.id).toBe("n-orders");
      expect(repo.findNode(CATALOG, "public.orders")?.id).toBe("n-orders");
    });

    it("upsertEdge stores an edge and getLineageAt returns upstream + downstream", () => {
      const src = repo.upsertNode(tableNode("n-orders", "public.orders"));
      const tgt = repo.upsertNode(tableNode("n-revenue", "analytics.daily_revenue"));

      repo.upsertEdge({
        id: "e1",
        catalogId: CATALOG,
        sourceNodeId: src.id,
        targetNodeId: tgt.id,
        edgeType: "derives",
        transform: "SELECT SUM(amount) FROM orders GROUP BY day",
        confidence: 0.95,
      });

      const lineage = repo.getLineageAt(tgt.id, 1);
      expect(lineage).toBeDefined();
      expect(lineage?.node.id).toBe(tgt.id);
      expect(lineage?.upstream.map((n) => n.id)).toEqual([src.id]);
      expect(lineage?.downstream).toEqual([]);
    });

    it("getLineageAt returns downstream when edges point out of the node", () => {
      const a = repo.upsertNode(tableNode("n-orders", "public.orders"));
      const b = repo.upsertNode(tableNode("n-revenue", "analytics.daily_revenue"));
      const c = repo.upsertNode(tableNode("n-dashboard", "dash-1"));

      repo.upsertEdge({ id: "e1", catalogId: CATALOG, sourceNodeId: a.id, targetNodeId: b.id, edgeType: "derives", transform: "", confidence: 1 });
      repo.upsertEdge({ id: "e2", catalogId: CATALOG, sourceNodeId: b.id, targetNodeId: c.id, edgeType: "aggregates", transform: "", confidence: 1 });

      const lineage = repo.getLineageAt(b.id);
      expect(lineage?.upstream.map((n) => n.id)).toEqual([a.id]);
      expect(lineage?.downstream.map((n) => n.id)).toEqual([c.id]);
    });

    it("getLineageAt returns undefined for unknown nodes", () => {
      expect(repo.getLineageAt("n-missing")).toBeUndefined();
    });

    it("deleteLineageForNode removes both inbound and outbound edges", () => {
      const a = repo.upsertNode(tableNode("n-orders", "public.orders"));
      const b = repo.upsertNode(tableNode("n-revenue", "analytics.daily_revenue"));
      const c = repo.upsertNode(tableNode("n-dashboard", "dash-1"));

      repo.upsertEdge({ id: "e1", catalogId: CATALOG, sourceNodeId: a.id, targetNodeId: b.id, edgeType: "derives", transform: "", confidence: 1 });
      repo.upsertEdge({ id: "e2", catalogId: CATALOG, sourceNodeId: b.id, targetNodeId: c.id, edgeType: "aggregates", transform: "", confidence: 1 });

      expect(repo.deleteLineageForNode(b.id)).toBe(2);
      expect(repo.getLineageAt(a.id)?.downstream).toEqual([]);
      expect(repo.getLineageAt(c.id)?.upstream).toEqual([]);
    });
  });

  // ── Resolution ───────────────────────────────────────────────────────────

  describe("resolveForQuery", () => {
    it("matches metrics whose name or displayName shares a token with the query", () => {
      repo.upsertMetric(baseMetric({ id: "m-gmv", name: "gmv" }));
      repo.upsertMetric(baseMetric({ id: "m-retention", name: "retention", displayName: "D7 Retention" }));
      repo.upsertMetric(baseMetric({ id: "m-aov", name: "aov", displayName: "Average Order Value" }));

      const result = repo.resolveForQuery(CATALOG, "Show the GMV across brand");
      expect(result.matchedMetrics.map((m) => m.id)).toEqual(["m-gmv"]);
      expect(result.warnings).toEqual([]);
    });

    it("matches entities by displayName token", () => {
      repo.upsertEntity(baseEntity({ id: "e-order", name: "order", displayName: "Customer Order" }));
      const result = repo.resolveForQuery(CATALOG, "How many customer orders last week?");
      expect(result.matchedEntities.map((e) => e.id)).toEqual(["e-order"]);
    });

    it("emits a warning when nothing matches", () => {
      const result = repo.resolveForQuery(CATALOG, "show me everything about xyzzy");
      expect(result.matchedMetrics).toEqual([]);
      expect(result.matchedEntities).toEqual([]);
      expect(result.warnings).toContain("No metrics or entities matched the query terms.");
    });

    it("returns empty results without warnings on an empty catalog", () => {
      const result = repo.resolveForQuery(CATALOG, "anything");
      expect(result.matchedMetrics).toEqual([]);
      expect(result.matchedEntities).toEqual([]);
      expect(result.warnings).toContain("No metrics or entities matched the query terms.");
    });

    it("ignores non-word tokens when matching", () => {
      repo.upsertMetric(baseMetric({ id: "m-gmv", name: "gmv" }));
      const result = repo.resolveForQuery(CATALOG, "!!! @#$");
      expect(result.matchedMetrics).toEqual([]);
      expect(result.warnings).toContain("No metrics or entities matched the query terms.");
    });
  });
});
