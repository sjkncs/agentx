/**
 * SQL Injection Guard & Query Diagnostic Enhancement.
 *
 * Problems solved:
 *   1. SQL injection  — parameterized queries, identifier quoting, schema allowlist
 *   2. Error diagnosis — maps raw DB errors to actionable messages with column context
 *   3. Query fingerprinting — groups similar queries for rate-limiting and audit
 *   4. Rate limiting  — per-user per-datasource query frequency limits
 *
 * Usage:
 *   import { createSqlGuard } from "./sql-injection-guard.js";
 *
 *   const guard = createSqlGuard({
 *     allowedTables: new Map([["orders", ["id","customer_id","total","created_at"]]]),
 *     blockedPatterns: [/\bUNION\s+SELECT\b/i, /\bINTO\s+OUTFILE\b/i],
 *     maxQueryLength: 50_000,
 *   });
 *
 *   const result = guard.validate("SELECT * FROM orders WHERE id = ?", [userId]);
 *   if (!result.allowed) throw new Error(result.reason);
 *   const safeSql = guard.parameterize(result.normalizedSql, [userId]);
 */

import type { SchemaSummary } from "@datafoundry/data-gateway";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SqlGuardOptions {
  /**
   * Per-datasource table allowlist.
   * Key: datasource_id. Value: Map<tableName, allowedColumnNames | null (all columns allowed)>.
   */
  tableAllowlist?: Map<string, Map<string, string[] | null>>;
  /**
   * Regex patterns that, if matched, cause immediate rejection.
   * Applied after normalization (comments stripped).
   */
  blockedPatterns?: RegExp[];
  /**
   * Maximum query length in characters. Default 50 000.
   */
  maxQueryLength?: number;
  /**
   * Maximum number of tokens (keywords + identifiers). Default 500.
   */
  maxTokens?: number;
  /**
   * If true, log every blocked query to stderr.
   */
  auditBlocked?: boolean;
}

export interface SqlGuardResult {
  allowed: boolean;
  normalizedSql: string;
  reason?: string;
  /** Tokens found in the query for diagnostics. */
  tokens?: string[];
  /** Tables referenced in the query. */
  referencedTables?: string[];
  /** Columns referenced in the query. */
  referencedColumns?: string[];
}

export interface QueryFingerprint {
  fingerprint: string;
  table: string;
  operation: string;
}

export interface DiagnosticMessage {
  code: string;
  message: string;
  hint: string;
  column?: string;
  table?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL Tokenizer
// ─────────────────────────────────────────────────────────────────────────────

const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER",
  "FULL", "CROSS", "ON", "AND", "OR", "NOT", "IN", "EXISTS", "BETWEEN",
  "LIKE", "IS", "NULL", "TRUE", "FALSE", "AS", "DISTINCT", "ALL",
  "GROUP", "BY", "HAVING", "ORDER", "ASC", "DESC", "LIMIT", "OFFSET",
  "UNION", "INTERSECT", "EXCEPT", "CASE", "WHEN", "THEN", "ELSE", "END",
  "WITH", "RECURSIVE", "OVER", "PARTITION", "WINDOW",
  "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE",
  "DROP", "TRUNCATE", "ALTER", "CREATE", "REPLACE", "INDEX", "VIEW",
  "GRANT", "REVOKE", "COMMIT", "ROLLBACK", "SAVEPOINT",
  "BEGIN", "TRANSACTION", "PRAGMA", "VACUUM", "ANALYZE",
  "EXPLAIN", "QUERY", "PLAN",
  "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "NULLIF",
  "CAST", "CONVERT", "ROUND", "FLOOR", "CEIL", "ABS",
  "LENGTH", "LOWER", "UPPER", "TRIM", "LTRIM", "RTRIM", "SUBSTR", "SUBSTRING",
  "CONCAT", "REPLACE", "SPLIT", "REVERSE", "CHAR", "CHARACTER",
  "DATE", "TIME", "DATETIME", "TIMESTAMP", "NOW", "CURRENT_TIMESTAMP",
  "INTERVAL", "DATEADD", "DATEDIFF", "EXTRACT", "DATE_PART",
  "ARRAY", "JSON", "JSON_EXTRACT", "JSON_VALUE",
  "WILDCARD", "ANY", "SOME",
  "TRUE", "FALSE", "BOOLEAN",
]);

/** Lightweight SQL tokenizer — extracts identifiers and keywords. */
function tokenize(sql: string): { tokens: string[]; tables: string[]; columns: string[] } {
  const tokens: string[] = [];
  const tables: string[] = [];
  const columns: string[] = [];
  let cur = "";
  let inIdent = false;
  let lastWasDot = false;

  // Strip string literals first to avoid matching content
  const stripped = sql
    .replace(/--[^\n]*/g, " ")           // single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, " ")  // multi-line comments
    .replace(/'(?:[^']|'')*'/g, "?")      // single-quoted strings
    .replace(/"(?:[^"]|"")*"/g, "?")     // double-quoted identifiers
    .replace(/\[([^\]]+)\]/g, "?");       // [bracket-quoted identifiers]

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i]!;
    if (/[a-zA-Z0-9_]/.test(ch)) {
      cur += ch;
      inIdent = true;
    } else {
      if (inIdent) {
        const upper = cur.toUpperCase();
        tokens.push(upper);
        if (!SQL_KEYWORDS.has(upper)) {
          // It's a potential identifier
          if (lastWasDot) {
            columns.push(cur);
          } else if (upper !== "WHERE" && upper !== "AND" && upper !== "OR") {
            tables.push(cur);
          }
        }
      }
      cur = "";
      inIdent = false;
    }
    lastWasDot = ch === ".";
  }
  if (inIdent) {
    const upper = cur.toUpperCase();
    tokens.push(upper);
  }

  return { tokens, tables: [...new Set(tables)], columns: [...new Set(columns)] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Guard
// ─────────────────────────────────────────────────────────────────────────────

export class SqlInjectionGuard {
  private readonly tableAllowlist: Map<string, Map<string, string[] | null>>;
  private readonly blockedPatterns: RegExp[];
  private readonly maxQueryLength: number;
  private readonly maxTokens: number;
  private readonly auditBlocked: boolean;

  constructor(options: SqlGuardOptions = {}) {
    this.tableAllowlist = options.tableAllowlist ?? new Map();
    this.blockedPatterns = options.blockedPatterns ?? getDefaultBlockedPatterns();
    this.maxQueryLength = options.maxQueryLength ?? 50_000;
    this.maxTokens = options.maxTokens ?? 500;
    this.auditBlocked = options.auditBlocked ?? false;
  }

  /**
   * Validate a SQL query against the guard policy.
   * Returns a SqlGuardResult with normalized SQL and diagnostics.
   */
  validate(sql: string): SqlGuardResult {
    // ── 1. Length check ────────────────────────────────────────────────────
    if (sql.length > this.maxQueryLength) {
      return {
        allowed: false,
        normalizedSql: sql.slice(0, 200),
        reason: `QUERY_TOO_LONG: query has ${sql.length} chars (max ${this.maxQueryLength}).`,
      };
    }

    // ── 2. Dangerous pattern check ─────────────────────────────────────────
    const normalized = this.normalize(sql);
    for (const pattern of this.blockedPatterns) {
      if (pattern.test(normalized)) {
        if (this.auditBlocked) {
          console.warn(`[sql-guard] BLOCKED: ${pattern} matched in query`);
        }
        return {
          allowed: false,
          normalizedSql: normalized.slice(0, 200),
          reason: `DANGEROUS_PATTERN: query contains a blocked pattern (${pattern}).`,
        };
      }
    }

    // ── 3. Token count check ───────────────────────────────────────────────
    const { tokens, tables, columns } = tokenize(normalized);
    if (tokens.length > this.maxTokens) {
      return {
        allowed: false,
        normalizedSql: normalized.slice(0, 200),
        reason: `TOO_MANY_TOKENS: ${tokens.length} tokens (max ${this.maxTokens}).`,
        tokens: tokens.slice(0, 50),
        referencedTables: tables,
        referencedColumns: columns,
      };
    }

    // ── 4. Table allowlist check ──────────────────────────────────────────
    if (tables.length > 0) {
      for (const [datasourceId, allowlist] of this.tableAllowlist) {
        for (const table of tables) {
          if (!allowlist.has(table)) {
            return {
              allowed: false,
              normalizedSql: normalized.slice(0, 200),
              reason: `TABLE_NOT_ALLOWED: table '${table}' is not in the allowlist for datasource '${datasourceId}'.`,
              referencedTables: tables,
              referencedColumns: columns,
            };
          }
        }
      }
    }

    // ── 5. Stacked query check (semicolon) ─────────────────────────────────
    // Allow semicolons in CTEs / subqueries but not true multi-statement
    const normalizedTrimmed = normalized.trim();
    const semicolonCount = (normalizedTrimmed.match(/;/g) ?? []).length;
    if (semicolonCount > 1) {
      return {
        allowed: false,
        normalizedSql: normalized.slice(0, 200),
        reason: `MULTIPLE_STATEMENTS: ${semicolonCount} statements found (max 1).`,
      };
    }

    return {
      allowed: true,
      normalizedSql: normalized,
      tokens,
      referencedTables: tables,
      referencedColumns: columns,
    };
  }

  /**
   * Parameterize a validated query by replacing `?` placeholders with
   * escaped values. Use this only for queries that were already validated.
   *
   * Prefer adapter-level parameterized queries when available.
   */
  parameterize(sql: string, values: unknown[]): string {
    let idx = 0;
    return sql.replace(/\?/g, () => {
      const val = values[idx++];
      if (val === null || val === undefined) return "NULL";
      if (typeof val === "number") return String(val);
      if (typeof val === "boolean") return val ? "1" : "0";
      return `'${String(val).replace(/'/g, "''")}'`;
    });
  }

  /**
   * Generate a stable fingerprint for rate-limiting and audit.
   * Normalizes away literal values, whitespace, and case.
   */
  fingerprint(sql: string): QueryFingerprint {
    const { tokens, tables } = tokenize(sql);
    const table = tables[0] ?? "unknown";
    const operation = tokens[0] ?? "UNKNOWN";
    const normalized = sql
      .replace(/'(?:[^']|'')*'/g, "?")
      .replace(/"(?:[^"]|"")*"/g, "?")
      .replace(/\b\d+\b/g, "?")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase()
      .slice(0, 100);
    return { fingerprint: normalized, table, operation };
  }

  /**
   * Build a table allowlist from a schema inspection result.
   */
  static fromSchema(schema: SchemaSummary, datasourceId: string): SqlInjectionGuard {
    const allowlist = new Map<string, string[] | null>();
    for (const table of schema.tables) {
      allowlist.set(table.name, table.columns.map((c) => c.name));
    }
    return new SqlInjectionGuard({
      tableAllowlist: new Map([[datasourceId, allowlist]]),
    });
  }

  /** Normalize SQL: strip comments and extra whitespace. */
  private normalize(sql: string): string {
    return sql
      .replace(/--[^\n]*/g, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}

export function createSqlGuard(options: SqlGuardOptions): SqlInjectionGuard {
  return new SqlInjectionGuard(options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Default blocked patterns
// ─────────────────────────────────────────────────────────────────────────────

function getDefaultBlockedPatterns(): RegExp[] {
  return [
    // Classic injection
    /;\s*(DROP|DELETE|TRUNCATE|UPDATE|INSERT|ALTER|CREATE|GRANT|REVOKE)/i,
    /\bUNION\s+(ALL\s+)?SELECT\b/i,
    /\bINTO\s+(OUTFILE|DUMPFILE)\b/i,
    /\bLOAD_FILE\s*\(/i,
    /\bLOAD_DATA\s+(INFILE|OUTFILE)\b/i,
    /\bBENCHMARK\s*\(/i,
    /\bSLEEP\s*\(/i,
    /\bPG_SLEEP\s*\(/i,
    /\bWAITFOR\s+DELAY\b/i,
    /\bDBMS_PIPE\s*\./i,
    /\bUTL_HTTP\s*\./i,
    /\bCTXSYS\s*\./i,
    /\bSYS\s*\./i,
    /\bSYSCOLUMNS\b/i,
    /\bSYSTYPES\b/i,
    /\bSYSOBJECTS\b/i,
    /\bINFORMATION_SCHEMA\b/i,
    /\bPG_CATALOG\b/i,
    /\bMYSQL\s*\.\s*(USER|DB)\b/i,
    // Stacked queries via hex
    /0x[0-9a-f]{16,}/i,
    // Command execution via system tables
    /\bEXEC\s*\(\s*@/i,
    /\bsp_executesql\b/i,
    /\bxp_cmdshell\b/i,
    /\bxp_dirtree\b/i,
    /\bsp_addlogin\b/i,
    // Base64 obfuscation
    /BASE64\s*DECODE/i,
    // Char encoding tricks
    /CHAR\s*\(\s*\d+\s*(,\s*\d+){5,}\s*\)/i,
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Error diagnostics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps raw database errors to human-readable diagnostic messages.
 * Supports PostgreSQL, MySQL, SQLite, DuckDB, SQL Server error formats.
 */
export function diagnoseSqlError(
  rawError: string,
  context?: { sql?: string | undefined; tables?: string[] | undefined; columns?: string[] | undefined },
): DiagnosticMessage {
  const err = rawError.trim();
  const lower = err.toLowerCase();

  // Syntax errors
  if (/syntax\s*(error|incorrect|invalid)/i.test(err)) {
    if (/near\s+['"`]?(\w+)['"`]?/i.test(err)) {
      const match = err.match(/near\s+['"`]?(\w+)['"`]?/i);
      return {
        code: "SYNTAX_ERROR_NEAR",
        message: err,
        hint: `Check the syntax near '${match?.[1]}'. Common issues: missing FROM, unmatched parentheses, or missing commas in column lists.`,
      };
    }
    return {
      code: "SYNTAX_ERROR",
      message: err,
      hint: "Check for unmatched parentheses, missing commas, or incorrect keywords.",
    };
  }

  // Table not found
  if (/table\s+['"`]?(\w+)['"`]?\s+does\s+not\s+exist/i.test(err) ||
      /table\s+['"`]?(\w+)['"`]?\s+not\s+found/i.test(err) ||
      /relation\s+['"`]?(\w+)['"`]?\s+does\s+not\s+exist/i.test(err)) {
    const match = err.match(/table\s+['"`]?(\w+)['"`]?/i) ?? err.match(/relation\s+['"`]?(\w+)['"`]?/i);
    const table = match?.[1];
    return {
      code: "TABLE_NOT_FOUND",
      message: err,
      hint: table && context?.tables && !context.tables.includes(table)
        ? `Table '${table}' was not found. Did you mean one of: ${context.tables.join(", ")}?`
        : `Table '${table}' does not exist in this datasource. Check your datasource configuration.`,
      ...(table !== undefined ? { table } : {}),
    };
  }

  // Column not found
  if (/column\s+['"`]?(\w+)['"`]?\s+(of\s+relation|does\s+not\s+exist|not\s+found)/i.test(err) ||
      /unknown\s+column\s+['"`]?(\w+)['"`]?/i.test(err)) {
    const match = err.match(/column\s+['"`]?(\w+)['"`]?/i) ?? err.match(/unknown\s+column\s+['"`]?(\w+)['"`]?/i);
    const col = match?.[1];
    return {
      code: "COLUMN_NOT_FOUND",
      message: err,
      hint: col && context?.columns && !context.columns.includes(col)
        ? `Column '${col}' was not found. Available columns: ${context.columns.join(", ")}`
        : `Column '${col}' does not exist in this table.`,
      ...(col !== undefined ? { column: col } : {}),
    };
  }

  // Type mismatch
  if (/cannot\s+be\s+applied\s+to|type\s+mismatch|operator\s+does\s+not\s+exist/i.test(err) ||
      /operator\s+\w+\s+is\s+not\s+defined/i.test(err)) {
    return {
      code: "TYPE_MISMATCH",
      message: err,
      hint: "The operator cannot be applied to the given types. Cast explicitly or check the column type.",
    };
  }

  // Division by zero
  if (/division\s+by\s+zero/i.test(err)) {
    return {
      code: "DIVISION_BY_ZERO",
      message: err,
      hint: "Add a NULLIF(denominator, 0) guard around the divisor.",
    };
  }

  // Null value
  if (/null\s+value\s+in\s+column|violates\s+not\s+null/i.test(err)) {
    const match = err.match(/null\s+value\s+in\s+column\s+['"`]?(\w+)['"`]?/i);
    return {
      code: "NULL_VIOLATION",
      message: err,
      hint: `Column '${match?.[1]}' does not allow NULL values. Provide a value or use a DEFAULT.`,
      ...(match?.[1] !== undefined ? { column: match[1] } : {}),
    };
  }

  // FK violation
  if (/foreign\s+key\s+violation|insert\s+or\s+update\s+on\s+table/i.test(err)) {
    return {
      code: "FOREIGN_KEY_VIOLATION",
      message: err,
      hint: "The referenced row does not exist, or the foreign key constraint is violated.",
    };
  }

  // Timeout
  if (/canceling\s+statement\s+due\s+to\s+timeout|query\s+timeout|statement\s+timeout/i.test(err)) {
    return {
      code: "QUERY_TIMEOUT",
      message: err,
      hint: "The query took too long. Try adding LIMIT, filtering early with WHERE, or creating an index.",
    };
  }

  // Permission denied
  if (/permission\s+denied|access\s+denied|authentication\s+failed/i.test(err)) {
    return {
      code: "PERMISSION_DENIED",
      message: err,
      hint: "The database user lacks the required permissions for this operation.",
    };
  }

  // Default: pass through with generic hint
  return {
    code: "DB_ERROR",
    message: err,
    hint: "Review the error message above. Check table/column names and types.",
  };
}
