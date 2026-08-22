/**
 * Tests for the semantic catalog and grounder.
 */
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";

import { SemanticCatalogRepository } from "./semantic-catalog.js";
import {
  inferSemanticTypes,
  inferGlossaryTerms,
  groundDatasourceSchema,
  type PhysicalSchema,
} from "./semantic-grounder.js";

afterEach(() => { vi.restoreAllMocks(); });

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeRepo() {
  const db = new Database(":memory:");
  return new SemanticCatalogRepository(db as never);
}

const SAMPLE_SCHEMA: PhysicalSchema = {
  tables: [
    {
      name: "orders",
      columns: [
        { name: "order_id", type: "bigint", nullable: false, primaryKey: true },
        { name: "customer_id", type: "bigint", nullable: false },
        { name: "order_amount", type: "decimal(12,2)", nullable: false },
        { name: "created_at", type: "timestamp", nullable: false },
        { name: "status", type: "varchar(32)", nullable: false },
        { name: "email", type: "varchar(255)", nullable: true },
        { name: "n", type: "int", nullable: true },  // ambiguous
        { name: "data", type: "text", nullable: true },  // ambiguous
        { name: "latitude", type: "float8", nullable: true },
        { name: "longitude", type: "float8", nullable: true },
        { name: "tax_pct", type: "decimal(5,2)", nullable: false },
        { name: "quantity", type: "int", nullable: false },
        { name: "is_active", type: "boolean", nullable: false },
        { name: "description", type: "text", nullable: true },
      ],
    },
    {
      name: "customers",
      columns: [
        { name: "id", type: "uuid", nullable: false, primaryKey: true },
        { name: "full_name", type: "varchar(200)", nullable: false },
        { name: "phone", type: "varchar(32)", nullable: true },
        { name: "country", type: "varchar(64)", nullable: false },
        { name: "dob", type: "date", nullable: true },
        { name: "api_key", type: "varchar(128)", nullable: true },
      ],
    },
  ],
};

// ── Semantic grounder tests ─────────────────────────────────────────────────

describe("inferSemanticTypes", () => {
  it("infers identifier types for id columns", () => {
    const results = inferSemanticTypes(SAMPLE_SCHEMA);
    const orderId = results.find((r) => r.tableName === "orders" && r.columnName === "order_id")!;
    expect(orderId.inferredSemanticType).toMatch(/identifier/);
    expect(orderId.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("infers currency.amount for _amount columns", () => {
    const results = inferSemanticTypes(SAMPLE_SCHEMA);
    const amt = results.find((r) => r.tableName === "orders" && r.columnName === "order_amount")!;
    expect(amt.inferredSemanticType).toBe("currency.amount");
    expect(amt.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("infers time.timestamp for created_at", () => {
    const results = inferSemanticTypes(SAMPLE_SCHEMA);
    const ts = results.find((r) => r.tableName === "orders" && r.columnName === "created_at")!;
    expect(ts.inferredSemanticType).toBe("time.timestamp");
    expect(ts.confidence).toBe(0.95);
  });

  it("infers person.email for email columns", () => {
    const results = inferSemanticTypes(SAMPLE_SCHEMA);
    const email = results.find((r) => r.tableName === "orders" && r.columnName === "email")!;
    expect(email.inferredSemanticType).toBe("person.email");
    expect(email.confidence).toBe(0.95);
  });

  it("infers geo.coordinates for latitude/longitude", () => {
    const results = inferSemanticTypes(SAMPLE_SCHEMA);
    const lat = results.find((r) => r.tableName === "orders" && r.columnName === "latitude")!;
    const lng = results.find((r) => r.tableName === "orders" && r.columnName === "longitude")!;
    expect(lat.inferredSemanticType).toBe("geo.coordinates");
    expect(lng.inferredSemanticType).toBe("geo.coordinates");
  });

  it("infers ratio.percentage for _pct columns", () => {
    const results = inferSemanticTypes(SAMPLE_SCHEMA);
    const pct = results.find((r) => r.tableName === "orders" && r.columnName === "tax_pct")!;
    expect(pct.inferredSemanticType).toBe("ratio.percentage");
  });

  it("infers numeric.count for _quantity columns", () => {
    const results = inferSemanticTypes(SAMPLE_SCHEMA);
    const qty = results.find((r) => r.tableName === "orders" && r.columnName === "quantity")!;
    expect(qty.inferredSemanticType).toBe("numeric.count");
  });

  it("infers flag.boolean for is_active", () => {
    const results = inferSemanticTypes(SAMPLE_SCHEMA);
    const flag = results.find((r) => r.tableName === "orders" && r.columnName === "is_active")!;
    expect(flag.inferredSemanticType).toBe("flag.boolean");
  });

  it("infers text.description for description columns", () => {
    const results = inferSemanticTypes(SAMPLE_SCHEMA);
    const desc = results.find((r) => r.tableName === "orders" && r.columnName === "description")!;
    expect(desc.inferredSemanticType).toBe("text.description");
  });

  it("infers person.name for full_name", () => {
    const results = inferSemanticTypes(SAMPLE_SCHEMA);
    const name = results.find((r) => r.tableName === "customers" && r.columnName === "full_name")!;
    expect(name.inferredSemanticType).toBe("person.name");
  });

  it("infers person.phone for phone columns", () => {
    const results = inferSemanticTypes(SAMPLE_SCHEMA);
    const phone = results.find((r) => r.tableName === "customers" && r.columnName === "phone")!;
    expect(phone.inferredSemanticType).toBe("person.phone");
  });

  it("infers geo.region for country columns", () => {
    const results = inferSemanticTypes(SAMPLE_SCHEMA);
    const country = results.find((r) => r.tableName === "customers" && r.columnName === "country")!;
    expect(country.inferredSemanticType).toBe("geo.region");
  });

  it("infers time.date_of_birth for dob", () => {
    const results = inferSemanticTypes(SAMPLE_SCHEMA);
    const dob = results.find((r) => r.tableName === "customers" && r.columnName === "dob")!;
    expect(dob.inferredSemanticType).toBe("time.date_of_birth");
  });

  it("infers credential.secret for api_key", () => {
    const results = inferSemanticTypes(SAMPLE_SCHEMA);
    const key = results.find((r) => r.tableName === "customers" && r.columnName === "api_key")!;
    expect(key.inferredSemanticType).toBe("credential.secret");
  });

  it("reduces confidence for ambiguous short column names", () => {
    const results = inferSemanticTypes(SAMPLE_SCHEMA);
    const ambiguous = results.find((r) => r.columnName === "n")!;
    expect(ambiguous.confidence).toBeLessThan(0.5);  // short name → reduced
  });

  it("warns about ambiguous column names in groundDatasourceSchema", async () => {
    const result = await groundDatasourceSchema(SAMPLE_SCHEMA, "ds-1", { gateway: {} as never });
    const ambiguousWarnings = result.warnings.filter((w) => w.includes("ambiguous") || w.includes("Low confidence"));
    expect(ambiguousWarnings.length).toBeGreaterThan(0);
  });

  it("returns high trust when most columns are well-inferred", async () => {
    const result = await groundDatasourceSchema(SAMPLE_SCHEMA, "ds-1", { gateway: {} as never });
    expect(["high", "medium", "low"]).toContain(result.trust);
  });
});

describe("inferGlossaryTerms", () => {
  it("extracts business terms from column names", () => {
    const inferences = inferSemanticTypes(SAMPLE_SCHEMA);
    const glossary = inferGlossaryTerms(inferences);
    const terms = glossary.map((g) => g.term.toLowerCase());

    expect(terms.some((t) => t.includes("customer"))).toBe(true);
    expect(terms.some((t) => t.includes("order"))).toBe(true);
  });

  it("binds glossary terms to columns with confidence", () => {
    const inferences = inferSemanticTypes(SAMPLE_SCHEMA);
    const glossary = inferGlossaryTerms(inferences);
    const order = glossary.find((g) => g.term.toLowerCase().includes("order"));
    expect(order).toBeDefined();
    expect(order!.boundColumns.length).toBeGreaterThan(0);
    expect(order!.confidence).toBeLessThan(1);
    expect(order!.confidence).toBeGreaterThan(0);
  });
});

// ── Semantic catalog repository tests ──────────────────────────────────────────

describe("SemanticCatalogRepository", () => {
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
  });

  afterEach(() => { /* db is in-memory, auto-cleaned */ });

  // ── Catalogs ────────────────────────────────────────────────────────────

  it("creates and lists catalogs", () => {
    const cat = repo.createCatalog({
      workspaceId: "ws-1", datasourceId: "ds-1", name: "Sales catalog",
    });
    expect(cat.name).toBe("Sales catalog");
    expect(cat.workspaceId).toBe("ws-1");

    const list = repo.listCatalogs("ws-1");
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(cat.id);
  });

  it("updates catalog name and increments revision", () => {
    const cat = repo.createCatalog({ workspaceId: "ws-1", datasourceId: "ds-1", name: "Old name" });
    expect(cat.revision).toBe("0");

    const updated = repo.updateCatalog({ workspaceId: "ws-1", catalogId: cat.id, name: "New name" });
    expect(updated.name).toBe("New name");
    expect(updated.revision).toBe("1");
  });

  it("returns null for non-existent catalog", () => {
    expect(repo.getCatalog("ws-1", "cat-does-not-exist")).toBeNull();
  });

  it("deletes catalog", () => {
    const cat = repo.createCatalog({ workspaceId: "ws-1", datasourceId: "ds-1", name: "To delete" });
    const removed = repo.deleteCatalog("ws-1", cat.id);
    expect(removed).toBe(true);
    expect(repo.getCatalog("ws-1", cat.id)).toBeNull();
  });

  // ── Column descriptions ────────────────────────────────────────────────

  it("upserts column descriptions", () => {
    const cat = repo.createCatalog({ workspaceId: "ws-1", datasourceId: "ds-1", name: "Test" });

    const col = repo.upsertColumnDesc({
      catalogId: cat.id, tableName: "orders", columnName: "order_amount",
      description: "Total order value in CNY",
      semanticType: "currency.amount", dataType: "decimal",
      nullable: false, sampleValues: ["99.99", "149.00"],
    });

    expect(col.semanticType).toBe("currency.amount");
    expect(col.description).toBe("Total order value in CNY");
    expect(col.nullable).toBe(false);
    expect(col.sampleValues).toEqual(["99.99", "149.00"]);

    // Upsert — update
    const updated = repo.upsertColumnDesc({
      catalogId: cat.id, tableName: "orders", columnName: "order_amount",
      description: "Updated description",
    });
    expect(updated.description).toBe("Updated description");
    expect(updated.semanticType).toBe("currency.amount");  // preserved
  });

  it("lists column descriptions by catalog", () => {
    const cat = repo.createCatalog({ workspaceId: "ws-1", datasourceId: "ds-1", name: "Test" });
    repo.upsertColumnDesc({ catalogId: cat.id, tableName: "orders", columnName: "id", semanticType: "identifier.id" });
    repo.upsertColumnDesc({ catalogId: cat.id, tableName: "orders", columnName: "amount", semanticType: "currency.amount" });
    repo.upsertColumnDesc({ catalogId: cat.id, tableName: "customers", columnName: "name", semanticType: "person.name" });

    const all = repo.listColumnDescs(cat.id);
    expect(all).toHaveLength(3);

    const ordersCols = repo.listColumnDescsByTable(cat.id, "orders");
    expect(ordersCols).toHaveLength(2);
    expect(ordersCols.every((c) => c.tableName === "orders")).toBe(true);
  });

  // ── Glossary terms ────────────────────────────────────────────────────

  it("creates and lists glossary terms", () => {
    const cat = repo.createCatalog({ workspaceId: "ws-1", datasourceId: "ds-1", name: "Test" });
    const term = repo.createGlossaryTerm({
      catalogId: cat.id, term: "customer_id",
      definition: "Unique identifier for a customer",
      businessType: "identifier",
    });
    expect(term.term).toBe("customer_id");

    const terms = repo.listGlossaryTerms(cat.id);
    expect(terms).toHaveLength(1);
    expect(terms[0]!.term).toBe("customer_id");
  });

  it("updates glossary terms", () => {
    const cat = repo.createCatalog({ workspaceId: "ws-1", datasourceId: "ds-1", name: "Test" });
    const term = repo.createGlossaryTerm({ catalogId: cat.id, term: "revenue", definition: "Old def" });
    const updated = repo.updateGlossaryTerm({ id: term.id, definition: "New definition" });
    expect(updated.definition).toBe("New definition");
    expect(updated.term).toBe("revenue");  // term unchanged
  });

  // ── Term bindings ──────────────────────────────────────────────────────

  it("binds terms to columns", () => {
    const cat = repo.createCatalog({ workspaceId: "ws-1", datasourceId: "ds-1", name: "Test" });
    const col = repo.upsertColumnDesc({ catalogId: cat.id, tableName: "orders", columnName: "customer_id", semanticType: "identifier.foreign_key" });
    const term = repo.createGlossaryTerm({ catalogId: cat.id, term: "customer_id" });

    const binding = repo.bindTermToColumn({ termId: term.id, columnDescId: col.id, confidence: 0.9 });
    expect(binding.confidence).toBe(0.9);
    expect(binding.termId).toBe(term.id);

    const byCol = repo.listTermBindingsByColumn(col.id);
    expect(byCol).toHaveLength(1);
    expect(byCol[0]!.termId).toBe(term.id);
  });

  // ── Data contracts ─────────────────────────────────────────────────────

  it("upserts data contracts", () => {
    const cat = repo.createCatalog({ workspaceId: "ws-1", datasourceId: "ds-1", name: "Test" });
    const contract = repo.upsertDataContract({
      catalogId: cat.id, tableName: "orders",
      description: "Orders must have a positive amount",
      expectations: {
        order_amount: { notNull: true, min: 0 },
        status: { allowedValues: ["pending", "completed", "cancelled"] },
      },
    });
    expect(contract.tableName).toBe("orders");
    expect(contract.expectations.order_amount?.notNull).toBe(true);
    expect(contract.expectations.status?.allowedValues).toContain("completed");

    const contracts = repo.listDataContracts(cat.id);
    expect(contracts).toHaveLength(1);
  });

  // ── Requirement bindings ────────────────────────────────────────────────

  it("binds requirements to catalog entities", () => {
    const cat = repo.createCatalog({ workspaceId: "ws-1", datasourceId: "ds-1", name: "Test" });
    const col = repo.upsertColumnDesc({ catalogId: cat.id, tableName: "orders", columnName: "order_amount", semanticType: "currency.amount" });

    const binding = repo.bindRequirement({
      catalogId: cat.id, requirementId: "USER_REVENUE_TOTAL",
      requirementLabel: "Total revenue per user",
      datasourceId: "ds-1", tableName: "orders", columnName: "order_amount",
      bindingType: "aggregate", sqlSnippet: "SUM(order_amount)",
      confidence: 0.95,
    });

    expect(binding.requirementId).toBe("USER_REVENUE_TOTAL");
    expect(binding.bindingType).toBe("aggregate");
    expect(binding.sqlSnippet).toBe("SUM(order_amount)");

    const bindings = repo.listRequirementBindingsByRequirementId("USER_REVENUE_TOTAL");
    expect(bindings).toHaveLength(1);
  });

  // ── Semantic context resolution ────────────────────────────────────────

  it("resolves semantic context from a filled catalog", () => {
    const cat = repo.createCatalog({ workspaceId: "ws-1", datasourceId: "ds-1", name: "Test" });
    repo.upsertColumnDesc({ catalogId: cat.id, tableName: "orders", columnName: "order_amount", semanticType: "currency.amount" });
    repo.upsertColumnDesc({ catalogId: cat.id, tableName: "orders", columnName: "created_at", semanticType: "time.timestamp" });
    repo.createGlossaryTerm({ catalogId: cat.id, term: "order_amount", definition: "Total order value" });
    repo.upsertDataContract({ catalogId: cat.id, tableName: "orders", expectations: { order_amount: { notNull: true } } });

    const ctx = repo.resolveSemanticContext("ws-1", "ds-1");
    expect(ctx.catalog).not.toBeNull();
    expect(ctx.columns).toHaveLength(2);
    expect(ctx.glossary).toHaveLength(1);
    expect(ctx.contracts).toHaveLength(1);
  });

  it("returns empty context when no catalog exists", () => {
    const ctx = repo.resolveSemanticContext("ws-no-catalog", "ds-no-catalog");
    expect(ctx.catalog).toBeNull();
    expect(ctx.columns).toHaveLength(0);
  });
});

// ── HTTP routes tests ─────────────────────────────────────────────────────────

describe("semantic catalog HTTP routes", async () => {
  const { handleSemanticCatalogRequest } = await import("./semantic-routes.js");
  const { createServer } = await import("node:http");

  let server: { url: string; close: () => Promise<void> };
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(async () => {
    repo = makeRepo();
    server = await new Promise<{ url: string; close: () => Promise<void> }>((resolve, reject) => {
      const s = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        void handleSemanticCatalogRequest(req as never, res as never, url.pathname, "user-1", "ws-1", { repository: repo as never }).catch(() => { /* ignore handler errors in tests */ });
      });
      s.on("error", reject);
      s.listen(0, "127.0.0.1", () => {
        const addr = s.address() as { protocol: string; family: string; address: string; port: number };
        resolve({
          url: `http://127.0.0.1:${addr.port}`,
          close: () => new Promise<void>((res) => s.close(() => res())),
        });
      });
    });
  });

  afterEach(async () => { await server.close(); });

  it("POST creates a catalog", async () => {
    const res = await fetch(`${server.url}/api/v1/semantic-catalog`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test catalog", datasourceId: "ds-1" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.name).toBe("Test catalog");
  });

  it("GET lists catalogs", async () => {
    await fetch(`${server.url}/api/v1/semantic-catalog`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Catalog A", datasourceId: "ds-1" }),
    });

    const res = await fetch(`${server.url}/api/v1/semantic-catalog`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.items.length).toBeGreaterThanOrEqual(1);
  });

  it("PUT upserts column descriptions", async () => {
    const create = await fetch(`${server.url}/api/v1/semantic-catalog`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test", datasourceId: "ds-1" }),
    });
    const catId = (await create.json()).data.id;

    const res = await fetch(`${server.url}/api/v1/semantic-catalog/${catId}/columns`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        columns: [
          { tableName: "orders", columnName: "order_amount", semanticType: "currency.amount" },
          { tableName: "orders", columnName: "created_at", semanticType: "time.timestamp" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.items).toHaveLength(2);
  });

  it("GET 404 for non-existent catalog", async () => {
    const res = await fetch(`${server.url}/api/v1/semantic-catalog/cat-does-not-exist`);
    expect(res.status).toBe(404);
  });

  it("GET /resolve returns semantic context", async () => {
    const create = await fetch(`${server.url}/api/v1/semantic-catalog`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test", datasourceId: "ds-1" }),
    });
    const catId = (await create.json()).data.id;

    const res = await fetch(`${server.url}/api/v1/semantic-catalog/${catId}/resolve`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveProperty("catalog");
    expect(body.data).toHaveProperty("columns");
  });
});
