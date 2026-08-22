import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SemanticCatalogError,
  SemanticCatalogRepository,
} from "./semantic-catalog.js";
import { ensureSemanticCatalogSchema } from "./semantic-schema.js";

const WS = "ws-test";
const DS = "ds-test";

function baseCatalog(overrides: Partial<{ workspaceId: string; datasourceId: string; name: string; description?: string }> = {}) {
  return { workspaceId: WS, datasourceId: DS, name: "Test Catalog", ...overrides };
}

describe("SemanticCatalogRepository", () => {
  let db: ReturnType<typeof Database>;
  let repo: SemanticCatalogRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSemanticCatalogSchema(db);
    repo = new SemanticCatalogRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── Catalogs ──────────────────────────────────────────────────────────────

  describe("catalogs", () => {
    it("creates and round-trips a catalog", () => {
      const created = repo.createCatalog(baseCatalog());
      expect(created.id).toMatch(/^cat-/);
      expect(created.version).toBe("1");
      expect(created.revision).toBe("0");
      expect(repo.getCatalog(WS, created.id)?.name).toBe("Test Catalog");
    });

    it("isolates catalogs by workspace", () => {
      const a = repo.createCatalog(baseCatalog({ workspaceId: "ws-a", name: "A" }));
      const b = repo.createCatalog(baseCatalog({ workspaceId: "ws-b", name: "B" }));
      expect(repo.getCatalog("ws-a", a.id)?.name).toBe("A");
      expect(repo.getCatalog("ws-b", b.id)?.name).toBe("B");
      expect(repo.getCatalog("ws-b", a.id)).toBeNull();
    });

    it("updates partial fields and bumps revision", async () => {
      const created = repo.createCatalog(baseCatalog());
      await new Promise((r) => setTimeout(r, 5));
      const updated = repo.updateCatalog({ workspaceId: WS, catalogId: created.id, name: "Renamed" });
      expect(updated.name).toBe("Renamed");
      expect(Number(updated.revision)).toBeGreaterThan(Number(created.revision));
    });

    it("throws NOT_FOUND when updating a missing catalog", () => {
      expect(() => repo.updateCatalog({ workspaceId: WS, catalogId: "cat-missing", name: "x" }))
        .toThrow(SemanticCatalogError);
    });

    it("deleteCatalog returns true on hit, false on miss", () => {
      const created = repo.createCatalog(baseCatalog());
      expect(repo.deleteCatalog(WS, created.id)).toBe(true);
      expect(repo.deleteCatalog(WS, created.id)).toBe(false);
    });
  });

  // ── Column descriptions ───────────────────────────────────────────────────

  describe("column descriptions", () => {
    it("creates a new description with a generated id", () => {
      const cat = repo.createCatalog(baseCatalog());
      const col = repo.upsertColumnDesc({
        catalogId: cat.id, tableName: "orders", columnName: "amount",
        description: "Total in CNY", semanticType: "currency.amount",
        dataType: "decimal", nullable: false, sampleValues: ["10", "20"],
      });
      expect(col.id).toMatch(/^cd-/);
      expect(col.description).toBe("Total in CNY");
      expect(col.semanticType).toBe("currency.amount");
      expect(col.nullable).toBe(false);
      expect(col.sampleValues).toEqual(["10", "20"]);
    });

    it("upsert preserves stored fields when caller omits them", () => {
      const cat = repo.createCatalog(baseCatalog());
      const original = repo.upsertColumnDesc({
        catalogId: cat.id, tableName: "orders", columnName: "amount",
        description: "Total in CNY", semanticType: "currency.amount",
        dataType: "decimal", nullable: false,
      });
      // Partial update — only `description` is provided
      const updated = repo.upsertColumnDesc({
        catalogId: cat.id, tableName: "orders", columnName: "amount",
        description: "Updated",
      });
      expect(updated.id).toBe(original.id); // same row
      expect(updated.description).toBe("Updated");
      expect(updated.semanticType).toBe("currency.amount"); // preserved
      expect(updated.dataType).toBe("decimal"); // preserved
      expect(updated.nullable).toBe(false); // preserved
    });

    it("upsert can override stored fields when provided", () => {
      const cat = repo.createCatalog(baseCatalog());
      repo.upsertColumnDesc({
        catalogId: cat.id, tableName: "orders", columnName: "amount",
        description: "x", semanticType: "currency.amount", dataType: "decimal",
      });
      const updated = repo.upsertColumnDesc({
        catalogId: cat.id, tableName: "orders", columnName: "amount",
        semanticType: "numeric.general", dataType: "bigint",
      });
      expect(updated.semanticType).toBe("numeric.general");
      expect(updated.dataType).toBe("bigint");
    });

    it("isolates descriptions by table name", () => {
      const cat = repo.createCatalog(baseCatalog());
      repo.upsertColumnDesc({ catalogId: cat.id, tableName: "orders", columnName: "id", semanticType: "identifier.id" });
      repo.upsertColumnDesc({ catalogId: cat.id, tableName: "customers", columnName: "id", semanticType: "identifier.id" });
      expect(repo.listColumnDescsByTable(cat.id, "orders")).toHaveLength(1);
      expect(repo.listColumnDescsByTable(cat.id, "customers")).toHaveLength(1);
      expect(repo.listColumnDescs(cat.id)).toHaveLength(2);
    });
  });

  // ── Glossary terms ────────────────────────────────────────────────────────

  describe("glossary terms", () => {
    it("creates a term and round-trips it", () => {
      const cat = repo.createCatalog(baseCatalog());
      const term = repo.createGlossaryTerm({
        catalogId: cat.id, term: "GMV", definition: "Gross Merch Value", businessType: "metric",
      });
      expect(term.id).toMatch(/^term-/);
      expect(term.term).toBe("GMV");
      expect(repo.listGlossaryTerms(cat.id)).toHaveLength(1);
    });

    it("updates partial fields", () => {
      const cat = repo.createCatalog(baseCatalog());
      const term = repo.createGlossaryTerm({ catalogId: cat.id, term: "X", definition: "old" });
      const updated = repo.updateGlossaryTerm({ id: term.id, definition: "new" });
      expect(updated.definition).toBe("new");
      expect(updated.businessType).toBe(""); // preserved default
    });

    it("throws NOT_FOUND when updating a missing term", () => {
      expect(() => repo.updateGlossaryTerm({ id: "term-missing", definition: "x" }))
        .toThrow(SemanticCatalogError);
    });

    it("deleteGlossaryTerm returns true on hit, false on miss", () => {
      const cat = repo.createCatalog(baseCatalog());
      const term = repo.createGlossaryTerm({ catalogId: cat.id, term: "X" });
      expect(repo.deleteGlossaryTerm(term.id)).toBe(true);
      expect(repo.deleteGlossaryTerm(term.id)).toBe(false);
    });
  });

  // ── Term bindings ─────────────────────────────────────────────────────────

  describe("term bindings", () => {
    it("binds a term to a column and round-trips it", () => {
      const cat = repo.createCatalog(baseCatalog());
      const term = repo.createGlossaryTerm({ catalogId: cat.id, term: "GMV" });
      const col = repo.upsertColumnDesc({ catalogId: cat.id, tableName: "orders", columnName: "amount" });
      const binding = repo.bindTermToColumn({ termId: term.id, columnDescId: col.id, confidence: 0.85 });
      expect(binding.id).toMatch(/^tb-/);
      expect(binding.confidence).toBe(0.85);
      expect(repo.listTermBindingsByTerm(term.id)).toHaveLength(1);
      expect(repo.listTermBindingsByColumn(col.id)).toHaveLength(1);
    });

    it("deleteTermBinding returns true on hit, false on miss", () => {
      const cat = repo.createCatalog(baseCatalog());
      const term = repo.createGlossaryTerm({ catalogId: cat.id, term: "X" });
      const col = repo.upsertColumnDesc({ catalogId: cat.id, tableName: "t", columnName: "c" });
      const binding = repo.bindTermToColumn({ termId: term.id, columnDescId: col.id });
      expect(repo.deleteTermBinding(binding.id)).toBe(true);
      expect(repo.deleteTermBinding(binding.id)).toBe(false);
    });
  });

  // ── Data contracts ────────────────────────────────────────────────────────

  describe("data contracts", () => {
    it("creates a contract with parsed expectations", () => {
      const cat = repo.createCatalog(baseCatalog());
      const contract = repo.upsertDataContract({
        catalogId: cat.id, tableName: "orders",
        description: "Orders contract",
        expectations: {
          amount: { notNull: true },
          status: { allowedValues: ["pending", "paid"] },
        },
      });
      expect(contract.id).toMatch(/^dc-/);
      expect(contract.expectations.amount?.notNull).toBe(true);
      expect(contract.expectations.status?.allowedValues).toEqual(["pending", "paid"]);
      expect(repo.listDataContracts(cat.id)).toHaveLength(1);
    });
  });

  // ── Requirement bindings ──────────────────────────────────────────────────

  describe("requirement bindings", () => {
    it("binds a requirement to a table/column", () => {
      const cat = repo.createCatalog(baseCatalog());
      const binding = repo.bindRequirement({
        catalogId: cat.id,
        requirementId: "req-1", requirementLabel: "PII column",
        datasourceId: DS, tableName: "customers", columnName: "email",
        bindingType: "column", sqlSnippet: "customers.email",
        confidence: 0.9,
      });
      expect(binding.id).toMatch(/^rb-/);
      expect(binding.bindingType).toBe("column");
      expect(binding.confidence).toBe(0.9);
    });

    it("default bindingType is column when not specified", () => {
      const cat = repo.createCatalog(baseCatalog());
      const binding = repo.bindRequirement({
        catalogId: cat.id,
        requirementId: "req-1", requirementLabel: "X",
        datasourceId: DS, tableName: "t", columnName: "c",
      });
      expect(binding.bindingType).toBe("column");
      expect(binding.confidence).toBe(1.0);
      expect(binding.sqlSnippet).toBe("");
    });
  });
});
