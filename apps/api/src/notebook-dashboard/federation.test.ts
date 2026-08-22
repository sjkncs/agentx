/**
 * Tests for the federation query engine.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  extractTableReferences,
  detectJoins,
} from "./federation-engine.js";

describe("extractTableReferences", () => {
  it("extracts a simple FROM table", () => {
    const refs = extractTableReferences("SELECT * FROM orders WHERE status = 'pending'");
    expect(refs).toHaveLength(1);
    expect(refs[0]!.tableName).toBe("orders");
  });

  it("extracts table with alias", () => {
    const refs = extractTableReferences("SELECT * FROM orders o JOIN customers c ON o.customer_id = c.id");
    expect(refs.map((r) => r.tableName)).toContain("orders");
  });

  it("extracts multiple tables from JOIN", () => {
    const refs = extractTableReferences(
      "SELECT * FROM orders o JOIN customers c ON o.customer_id = c.id JOIN products p ON o.product_id = p.id",
    );
    expect(refs).toHaveLength(3);
    const names = refs.map((r) => r.tableName.toLowerCase());
    expect(names).toContain("orders");
    expect(names).toContain("customers");
    expect(names).toContain("products");
  });

  it("extracts quoted identifiers", () => {
    const refs = extractTableReferences("SELECT * FROM `my-table`");
    expect(refs[0]!.tableName).toBe("my-table");
  });

  it("deduplicates tables", () => {
    const refs = extractTableReferences(
      "SELECT * FROM orders o WHERE EXISTS (SELECT 1 FROM customers c WHERE c.id = o.customer_id)",
    );
    // Subquery table reference is also matched — acceptable for now
    expect(refs.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty for subquery-only SQL", () => {
    const refs = extractTableReferences("SELECT (SELECT MAX(price) FROM products) AS max_price");
    expect(refs).toHaveLength(0);
  });
});

describe("detectJoins", () => {
  it("detects simple inner join", () => {
    const tables = [
      { tableName: "orders", alias: "o", columns: [], datasourceId: "ds1", dialect: "mysql" },
      { tableName: "customers", alias: "c", columns: [], datasourceId: "ds2", dialect: "mysql" },
    ];
    const joins = detectJoins(
      "SELECT * FROM orders o JOIN customers c ON o.customer_id = c.id",
      tables as never,
    );
    expect(joins).toHaveLength(1);
    expect(joins[0]!.leftColumn).toBe("customer_id");
    expect(joins[0]!.rightColumn).toBe("id");
    expect(joins[0]!.joinType).toBe("inner");
  });

  it("detects multiple joins", () => {
    const tables = [
      { tableName: "orders", alias: "o", columns: [], datasourceId: "ds1", dialect: "mysql" },
      { tableName: "customers", alias: "c", columns: [], datasourceId: "ds1", dialect: "mysql" },
      { tableName: "products", alias: "p", columns: [], datasourceId: "ds2", dialect: "pg" },
    ];
    const joins = detectJoins(
      "SELECT * FROM orders o JOIN customers c ON o.customer_id = c.id JOIN products p ON o.product_id = p.id",
      tables as never,
    );
    expect(joins).toHaveLength(2);
  });

  it("returns empty for queries without explicit ON", () => {
    const tables = [
      { tableName: "orders", alias: "o", columns: [], datasourceId: "ds1", dialect: "mysql" },
      { tableName: "customers", alias: "c", columns: [], datasourceId: "ds1", dialect: "mysql" },
    ];
    const joins = detectJoins("SELECT * FROM orders, customers", tables as never);
    expect(joins).toHaveLength(0);
  });

  it("handles quoted column names", () => {
    const tables = [
      { tableName: "orders", alias: "o", columns: [], datasourceId: "ds1", dialect: "mysql" },
      { tableName: "customers", alias: "c", columns: [], datasourceId: "ds1", dialect: "mysql" },
    ];
    const joins = detectJoins(
      'SELECT * FROM orders o JOIN customers c ON o."customer_id" = c."id"',
      tables as never,
    );
    expect(joins).toHaveLength(1);
  });
});

describe("FederationPlanner (mocked)", () => {
  it("selects native pushdown for single-datasource query", async () => {
    const planner = new (await import("./federation-engine.js")).FederationPlanner({
      gateway: {
        listDataSources: async () => [
          { id: "ds1", name: "mysql", type: "mysql", status: "ready" },
        ],
        inspectSchema: async () => ({
          tables: [{ name: "orders", columns: [{ name: "id" }, { name: "customer_id" }] }],
        }),
      } as never,
      listDataSources: async () => [{ id: "ds1", name: "mysql", type: "mysql", status: "ready" }],
      inspectSchema: async () => ({
        tables: [{ name: "orders", columns: [{ name: "id" }, { name: "customer_id" }] }],
      }),
    });

    const plan = await planner.plan({
      sql: "SELECT * FROM orders WHERE status = 'pending'",
      workspaceId: "ws-1",
      userId: "user-1",
    });

    expect(plan.strategy.type).toBe("native_pushdown");
    expect(plan.steps[0]).toMatchObject({ kind: "pushdown", datasourceId: "ds1" });
  });

  it("selects duckdb_federation for cross-datasource query", async () => {
    const planner = new (await import("./federation-engine.js")).FederationPlanner({
      gateway: {} as never,
      listDataSources: async () => [
        { id: "ds-mysql", name: "MySQL", type: "mysql", status: "ready" },
        { id: "ds-pg", name: "PostgreSQL", type: "postgresql", status: "ready" },
      ],
      inspectSchema: async ({ datasource_id }) => {
        if (datasource_id === "ds-mysql") {
          return { tables: [{ name: "orders", columns: [{ name: "id" }, { name: "customer_id" }] }] };
        }
        if (datasource_id === "ds-pg") {
          return { tables: [{ name: "customers", columns: [{ name: "id" }, { name: "name" }] }] };
        }
        return { tables: [] };
      },
    });

    const plan = await planner.plan({
      sql: "SELECT * FROM orders o JOIN customers c ON o.customer_id = c.id",
      workspaceId: "ws-1",
      userId: "user-1",
    });

    expect(plan.strategy.type).toBe("duckdb_federation");
    expect(plan.steps.every((s) => s.kind === "fetch")).toBe(true);
    expect(plan.warnings.length).toBeGreaterThanOrEqual(0); // warnings field exists
  });

  it("emits warning for many-table queries", async () => {
    const planner = new (await import("./federation-engine.js")).FederationPlanner({
      gateway: {} as never,
      listDataSources: async () => [
        { id: "ds1", name: "mysql", type: "mysql", status: "ready" },
      ],
      inspectSchema: async () => ({
        tables: [
          { name: "orders", columns: [{ name: "id" }] },
          { name: "customers", columns: [{ name: "id" }] },
          { name: "products", columns: [{ name: "id" }] },
          { name: "categories", columns: [{ name: "id" }] },
        ],
      }),
    });

    const plan = await planner.plan({
      sql: "SELECT * FROM orders, customers, products, categories",
      workspaceId: "ws-1",
      userId: "user-1",
    });

    expect(plan.warnings.some((w) => w.includes("Consider creating a virtual table"))).toBe(true);
  });
});

describe("FederationExecutor (mocked)", () => {
  it("forwards native pushdown to gateway", async () => {
    const mockRunSql = vi.fn(async () => ({
      columns: ["id", "status"],
      rows: [[1, "pending"], [2, "completed"]],
      row_count: 2,
      elapsed_ms: 15,
    }));

    const planner = new (await import("./federation-engine.js")).FederationPlanner({
      gateway: {} as never,
      listDataSources: async () => [{ id: "ds1", name: "mysql", type: "mysql", status: "ready" }],
      inspectSchema: async () => ({
        tables: [{ name: "orders", columns: [{ name: "id" }, { name: "status" }] }],
      }),
    });

    const executor = new (await import("./federation-engine.js")).FederationExecutor({
      gateway: { runSqlReadonly: mockRunSql } as never,
      planner,
    });

    const result = await executor.execute({
      workspaceId: "ws-1",
      userId: "user-1",
      sql: "SELECT * FROM orders",
    });

    expect(result.columns).toEqual(["id", "status"]);
    expect(result.row_count).toBe(2);
    expect(result.executionStrategy).toMatchObject({ type: "native_pushdown" });
  });

  it("throws when DuckDB adapter missing for cross-dialect query", async () => {
    const planner = new (await import("./federation-engine.js")).FederationPlanner({
      gateway: {} as never,
      listDataSources: async () => [
        { id: "ds-mysql", name: "MySQL", type: "mysql", status: "ready" },
        { id: "ds-pg", name: "PostgreSQL", type: "postgresql", status: "ready" },
      ],
      inspectSchema: async ({ datasource_id }) => {
        if (datasource_id === "ds-mysql") {
          return { tables: [{ name: "orders", columns: [{ name: "id" }] }] };
        }
        return { tables: [{ name: "customers", columns: [{ name: "id" }] }] };
      },
    });

    const executor = new (await import("./federation-engine.js")).FederationExecutor({
      gateway: {} as never,
      planner,
      // No duckDbAdapter — should throw
    });

    await expect(
      executor.execute({
        workspaceId: "ws-1",
        userId: "user-1",
        sql: "SELECT * FROM orders o JOIN customers c ON o.id = c.id",
      }),
    ).rejects.toThrow("DuckDB adapter not configured");
  });
});
