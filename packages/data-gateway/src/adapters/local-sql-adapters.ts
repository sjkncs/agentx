import type {
  AdapterExecutionInput,
  AdapterPreviewInput,
  AdapterSqlInput,
  DataSourceAdapter,
  SchemaSummary,
  TableResult
} from "../types.js";
import Database, * as BetterSqlite3 from "better-sqlite3";
import type * as DuckDbModule from "duckdb";

export class SQLiteAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const database = this.open();

    try {
      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC")
        .all()
        .map((row: unknown) => requiredRecordString(row, "name"));

      return {
        tables: tables.map((table: string) => ({
          name: table,
          columns: database
            .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
            .all()
            .map((row: unknown) => ({
              name: requiredRecordString(row, "name"),
              type: requiredRecordString(row, "type") || "TEXT",
              nullable: requiredRecordNumber(row, "notnull") === 0
            }))
        }))
      };
    } finally {
      database.close();
    }
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    const database = this.open();

    try {
      const rows = database.prepare(`SELECT * FROM ${quoteIdentifier(input.table)} LIMIT ?`).all(input.limit);
      return rowsToTableResult(rows);
    } finally {
      database.close();
    }
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    // node:sqlite Database is synchronous; cancellation is cooperative before
    // statement execution. Hard cancel would require worker-thread isolation.
    const database = this.open();

    try {
      const rows = database.prepare(applyStandardLimit(input.sql, input.limit)).all();
      return rowsToTableResult(rows);
    } finally {
      database.close();
    }
  }

  private open(): BetterSqlite3.Database {
    const path = stringConfig(this.config, "path");
    return new Database(path);
  }
}

export class DuckDbAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const rows = await this.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'main'
      ORDER BY table_name, ordinal_position
    `, input.signal);
    return schemaRowsToSummary(rows, "table_name", "column_name", "data_type", "is_nullable");
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(
      `SELECT * FROM ${quoteIdentifier(input.table)} LIMIT ${input.limit}`,
      input.signal
    ));
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(applyStandardLimit(input.sql, input.limit), input.signal));
  }

  private async query(sql: string, signal?: AbortSignal | undefined): Promise<Record<string, unknown>[]> {
    throwIfAborted(signal);
    // duckdb 1.4.4 on Windows + Node 22 has a native-binding bug where
    // repeatedly opening + closing a Database on the same file poisons the
    // underlying handle pool: every subsequent Database instance fails with
    // `Connection was never established or has been closed already`.
    //
    // The robust workaround is to share a single Database handle per path
    // for the lifetime of the process and only spin up a fresh Connection
    // for every query. The shared Database is released only when the
    // process exits (see `releaseSharedDatabase`).
    const database = await acquireSharedDatabase(stringConfig(this.config, "path"));
    let connection: DuckDbModule.Connection | null = null;
    try {
      connection = database.connect();
      const rows = await duckDbAll(connection, sql, signal);
      return rows.filter(isRecord);
    } finally {
      if (connection) {
        try {
          await duckDbClose(connection);
        } catch (error) {
          if (!isAlreadyClosedError(error)) {
            throw error;
          }
        }
      }
    }
  }
}

const loadDuckDb = async (): Promise<typeof DuckDbModule> => {
  const loaded = await import("duckdb") as unknown as { default?: typeof DuckDbModule } & typeof DuckDbModule;
  return loaded.default ?? loaded;
};

const duckDbAll = async (
  connection: DuckDbModule.Connection,
  sql: string,
  signal?: AbortSignal | undefined
): Promise<DuckDbModule.TableData> =>
  await new Promise((resolve, reject) => {
    const abort = (): void => {
      reject(signal?.reason instanceof Error ? signal.reason : new Error("RUN_CANCELLED"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    connection.all(sql, (error, rows) => {
      signal?.removeEventListener("abort", abort);
      if (error) {
        reject(error);
      } else {
        resolve(rows);
      }
    });
  });

const duckDbClose = (connection: DuckDbModule.Connection): Promise<void> =>
  new Promise((resolve, reject) => {
    connection.close((error) => (error ? reject(error) : resolve()));
  });

const duckDbCloseDatabase = (database: DuckDbModule.Database): Promise<void> =>
  new Promise((resolve, reject) => {
    database.close((error) => (error ? reject(error) : resolve()));
  });

// duckdb 1.4.4 on Windows + Node 22 has a native-binding bug where the
// second `new Database(path)` instance on the same file in the same
// process always fails with `Connection was never established or has been
// closed already`. To work around this we share a single Database per path
// for the lifetime of the process and only spin up a fresh Connection per
// query. The shared Database is intentionally never released here because
// doing so would trigger the same poison in any subsequent query.
const sharedDuckDbDatabases = new Map<string, Promise<DuckDbModule.Database>>();

const acquireSharedDatabase = async (path: string): Promise<DuckDbModule.Database> => {
  const normalized = path;
  const existing = sharedDuckDbDatabases.get(normalized);
  if (existing) {
    return existing;
  }
  const created = (async (): Promise<DuckDbModule.Database> => {
    const duckdb = await loadDuckDb();
    return new duckdb.Database(normalized);
  })();
  sharedDuckDbDatabases.set(normalized, created);
  return created;
};

const releaseSharedDatabase = async (path: string): Promise<void> => {
  const normalized = path;
  const existing = sharedDuckDbDatabases.get(normalized);
  if (!existing) {
    return;
  }
  sharedDuckDbDatabases.delete(normalized);
  try {
    const database = await existing;
    await duckDbCloseDatabase(database);
  } catch (error) {
    if (!isAlreadyClosedError(error)) {
      throw error;
    }
  }
};

const isAlreadyClosedError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code !== "DUCKDB_NODEJS_ERROR" || typeof candidate.message !== "string") {
    return false;
  }
  const lower = candidate.message.toLowerCase();
  return (
    lower.includes("connection was already closed") ||
    lower.includes("database was already closed") ||
    lower.includes("connection was never established") ||
    lower.includes("has been closed already")
  );
};

const applyStandardLimit = (sql: string, limit: number): string => {
  if (/\bLIMIT\s+\d+\b/iu.test(sql)) {
    return sql;
  }

  return `SELECT * FROM (${sql}) AS readonly_query LIMIT ${limit}`;
};

const rowsToTableResult = (rows: unknown[]): TableResult => {
  const objectRows = rows.filter(isRecord);
  const columns = Array.from(new Set(objectRows.flatMap((row) => Object.keys(row))));

  return objectRowsToTableResult(objectRows, columns);
};

const objectRowsToTableResult = (rows: Record<string, unknown>[], columns: string[]): TableResult => ({
  columns,
  rows: rows.map((row) => columns.map((column) => row[column] ?? null)),
  row_count: rows.length
});

const schemaRowsToSummary = (
  rows: Record<string, unknown>[],
  tableKey: string,
  columnKey: string,
  typeKey: string,
  nullableKey: string
): Omit<SchemaSummary, "datasource_id"> => {
  const tables = new Map<string, SchemaSummary["tables"][number]>();
  rows.forEach((row) => {
    const tableName = requiredRecordStringLoose(row, tableKey);
    const table = tables.get(tableName) ?? { name: tableName, columns: [] };
    table.columns.push({
      name: requiredRecordStringLoose(row, columnKey),
      type: requiredRecordStringLoose(row, typeKey),
      nullable: requiredRecordStringLoose(row, nullableKey).toUpperCase() === "YES"
    });
    tables.set(tableName, table);
  });
  return { tables: [...tables.values()] };
};

const stringConfig = (config: Record<string, unknown>, key: string, defaultValue?: string): string => {
  const value = config[key];

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (defaultValue !== undefined) {
    return defaultValue;
  }

  throw new Error(`Missing config value: ${key}`);
};

const quoteIdentifier = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

const requiredRecordString = (row: unknown, key: string): string => {
  if (!isRecord(row) || typeof row[key] !== "string") {
    throw new Error(`Expected string column: ${key}`);
  }

  return row[key];
};

const requiredRecordStringLoose = (row: unknown, key: string): string => {
  if (!isRecord(row)) {
    throw new Error(`Expected string column: ${key}`);
  }
  const value = row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()];
  if (typeof value !== "string") {
    throw new Error(`Expected string column: ${key}`);
  }
  return value;
};

const requiredRecordNumber = (row: unknown, key: string): number => {
  if (!isRecord(row) || typeof row[key] !== "number") {
    throw new Error(`Expected number column: ${key}`);
  }

  return row[key];
};

const throwIfAborted = (signal?: AbortSignal | undefined): void => {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("RUN_CANCELLED");
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
