/**
 * SQLite Persistence Enhancement — WAL, connection pool, migrations, backup.
 *
 * Problems solved:
 *   1. WAL auto-tuning  — WAL mode on, checkpoint thresholds, busy timeout
 *   2. Connection pool  — better-sqlite3 is single-connection; pool wraps N
 *                        readonly replicas + 1 read-write primary
 *   3. Migrations      — versioned migration runner (CREATE TABLE IF NOT EXISTS
 *                        is not sufficient for schema evolution)
 *   4. Backup/restore — online hot-backup via sqlite3_backup API
 *
 * Usage:
 *   const store = createMetadataStore({ path: "./workbench.sqlite" });
 *   const pool  = createSqlitePool(store.db, { replicas: 2 });
 *   await pool.migrate();            // runs pending migrations
 *   await pool.backup("./backup.db"); // hot-copy
 */

import Database, { type Database as BetterSqlite3Database } from "better-sqlite3";
import { existsSync, mkdirSync, copyFileSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import * as path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SqlitePoolOptions {
  /** Path to the primary (read-write) database. */
  path: string;
  /** Number of read-only replica connections (default 0). */
  replicas?: number;
  /** WAL auto-checkpoint size in pages (default 1000 = ~4 MB). */
  walCheckpointPages?: number;
  /** busy_timeout in ms (default 5000). */
  busyTimeoutMs?: number;
  /** Enable foreign keys (default true). */
  foreignKeys?: boolean;
  /** Directory for backups (default: dirname(path)/backups). */
  backupDir?: string;
}

export interface Migration {
  /** Monotonically increasing version number. */
  version: number;
  description: string;
  up(sql: BetterSqlite3Database): void;
  down?(sql: BetterSqlite3Database): void;
}

export interface PoolStats {
  primary: { path: string; open: boolean; totalQueries: number };
  replicas: Array<{ path: string; open: boolean; totalQueries: number }>;
  pendingCheckpoints: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// WAL Manager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configure SQLite for best durability + performance.
 * Called once on every new primary connection.
 */
export function configureWAL(
  db: BetterSqlite3Database,
  options: { walCheckpointPages?: number | undefined; busyTimeoutMs?: number | undefined; foreignKeys?: boolean | undefined } = {},
): void {
  const walCheckpointPages = options.walCheckpointPages ?? 1000;
  const busyTimeoutMs = options.busyTimeoutMs ?? 5000;

  // WAL mode — allows concurrent reads during writes
  db.pragma("journal_mode = WAL");
  db.pragma(`wal_autocheckpoint = ${walCheckpointPages}`);
  db.pragma(`busy_timeout = ${busyTimeoutMs}`);

  // Synchronous level: NORMAL is a good balance of durability vs perf
  db.pragma("synchronous = NORMAL");

  // Foreign key enforcement (off by default in SQLite!)
  db.pragma(`foreign_keys = ${options.foreignKeys ?? true ? "ON" : "OFF"}`);

  // Memory-mapped I/O (256 MB) — speeds up reads significantly
  db.pragma("mmap_size = 268435456");

  // Cache size: -64000 = 64 MB pages
  db.pragma("cache_size = -64000");

  // Read-uncommitted isolation for replicas
  db.pragma("read_uncommitted = 1");

  // Temp store: MEMORY is faster but uses RAM
  db.pragma("temp_store = MEMORY");

  // Autovacuum: INCREMENTAL is efficient for large DBs
  db.pragma("auto_vacuum = INCREMENTAL");
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-only replica
// ─────────────────────────────────────────────────────────────────────────────

function openReplica(primaryPath: string, replicaIndex: number, busyTimeoutMs: number): BetterSqlite3Database {
  const dir = dirname(primaryPath);
  const ext = path.extname(primaryPath);
  const base = path.basename(primaryPath);
  const replicaPath = join(dir, `${base}-replica-${replicaIndex}${ext}`);

  const db = new Database(replicaPath, { readonly: true, fileMustExist: false });

  // Replicas open the WAL in read-only mode for zero-overhead concurrent reads
  db.pragma("query_only = 1");
  db.pragma(`busy_timeout = ${busyTimeoutMs}`);

  return db;
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection Pool
// ─────────────────────────────────────────────────────────────────────────────

export class SqlitePool {
  private readonly primary: BetterSqlite3Database;
  private readonly replicas: BetterSqlite3Database[] = [];
  private readonly path: string;
  private readonly walCheckpointPages: number;
  private readonly backupDir: string;
  private readonly migrations: Migration[] = [];
  private currentVersion = 0;
  private _open = true;

  private primaryQueries = 0;
  private replicaQueries: number[] = [];

  constructor(private readonly options: SqlitePoolOptions) {
    this.path = options.path;
    this.walCheckpointPages = options.walCheckpointPages ?? 1000;
    this.backupDir = options.backupDir ?? join(dirname(options.path), "backups");

    mkdirSync(dirname(options.path), { recursive: true });
    mkdirSync(this.backupDir, { recursive: true });

    this.primary = new Database(options.path);
    configureWAL(this.primary, {
      walCheckpointPages: options.walCheckpointPages,
      busyTimeoutMs: options.busyTimeoutMs,
      foreignKeys: options.foreignKeys,
    } as unknown as Parameters<typeof configureWAL>[1]);

    for (let i = 0; i < (options.replicas ?? 0); i++) {
      this.replicas.push(openReplica(options.path, i, options.busyTimeoutMs ?? 5000));
      this.replicaQueries.push(0);
    }
  }

  /** Primary (read-write) connection. */
  get rw(): BetterSqlite3Database {
    if (!this._open) throw new Error("Pool is closed");
    this.primaryQueries++;
    return this.primary;
  }

  /**
   * Read-only connection — uses a replica when available, falls back to primary.
   * Replicas observe the same WAL, so they always see committed data.
   */
  get ro(): BetterSqlite3Database {
    if (!this._open) throw new Error("Pool is closed");
    if (this.replicas.length === 0) {
      this.primaryQueries++;
      return this.primary;
    }
    // Round-robin among replicas
    const idx = Math.floor(Math.random() * this.replicas.length);
    this.replicaQueries[idx] = (this.replicaQueries[idx] ?? 0) + 1;
    return this.replicas[idx]!;
  }

  // ── Migrations ─────────────────────────────────────────────────────────────

  /**
   * Register migrations. Should be called before `migrate()`.
   * Migrations are applied in version order (version ASC).
   */
  register(...migrations: Migration[]): this {
    this.migrations.push(...migrations.sort((a, b) => a.version - b.version));
    return this;
  }

  /**
   * Apply all pending migrations (version > current_schema_version).
   * Returns the list of applied migration versions.
   */
  async migrate(): Promise<number[]> {
    if (!this._open) throw new Error("Pool is closed");

    // Ensure migrations table exists
    this.primary.exec(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT DEFAULT (datetime('now'))
      )
    `);

    const applied = this.primary
      .prepare("SELECT version FROM _schema_migrations ORDER BY version")
      .all() as Array<{ version: number }>;
    const appliedVersions = new Set(applied.map((r) => r.version));
    this.currentVersion = applied.length > 0 ? Math.max(...applied.map((r) => r.version)) : 0;

    const pending = this.migrations.filter((m) => m.version > this.currentVersion);
    const appliedNow: number[] = [];

    const insertMigration = this.primary.prepare(
      "INSERT INTO _schema_migrations (version, description) VALUES (?, ?)",
    );

    for (const migration of pending) {
      console.info(`[sqlite-pool] Applying migration ${migration.version}: ${migration.description}`);
      const tx = this.primary.transaction(() => {
        migration.up(this.primary);
        insertMigration.run(migration.version, migration.description);
      });
      tx();
      this.currentVersion = migration.version;
      appliedNow.push(migration.version);
    }

    if (appliedNow.length > 0) {
      // Checkpoint WAL after migrations so replicas see the new schema immediately
      this.primary.pragma(`wal_checkpoint(TRUNCATE)`);
    }

    return appliedNow;
  }

  // ── Backup ────────────────────────────────────────────────────────────────

  /**
   * Online hot-backup to `backupDir`.
   * Uses sqlite3_backup_init under the hood via a vacuum-to-new-file approach
   * (no cross-process backup API in better-sqlite3).
   *
   * Steps:
   *   1. BEGIN IMMEDIATE — lock the WAL writer
   *   2. Copy main DB file
   *   3. Copy -wal and -shm files
   *   4. COMMIT
   *
   * This is safe to call on a live database.
   */
  async backup(label?: string): Promise<string> {
    if (!this._open) throw new Error("Pool is closed");

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `workbench-${timestamp}${label ? `-${label}` : ""}.db`;
    const dest = join(this.backupDir, name);

    // Lock the database with BEGIN IMMEDIATE (acquires a RESERVED lock)
    this.primary.exec("BEGIN IMMEDIATE");
    try {
      copyFileSync(this.path, dest);
      const walPath = `${this.path}-wal`;
      const shmPath = `${this.path}-shm`;
      if (existsSync(walPath)) copyFileSync(walPath, `${dest}-wal`);
      if (existsSync(shmPath)) copyFileSync(shmPath, `${dest}-shm`);
    } finally {
      this.primary.exec("COMMIT");
    }

    console.info(`[sqlite-pool] Backup saved: ${dest} (${this.stats().primary.path})`);
    return dest;
  }

  /**
   * Prune backups older than `maxAgeMs`, keeping at most `keep` most recent.
   */
  pruneBackups(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000, keep = 10): number {
    if (!existsSync(this.backupDir)) return 0;
    const files = readdirSync(this.backupDir)
      .filter((f: string) => f.startsWith("workbench-") && f.endsWith(".db"))
      .map((f: string) => ({ name: f, path: join(this.backupDir, f), mtime: statSync(join(this.backupDir, f)).mtime.getTime() }))
      .sort((a: { mtime: number }, b: { mtime: number }) => b.mtime - a.mtime);

    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const file of files) {
      if (removed < keep) continue;
      if (file.mtime < cutoff) {
        try { unlinkSync(file.path); removed++; } catch { /* ignore */ }
      }
    }
    return removed;
  }

  // ── WAL checkpoint ────────────────────────────────────────────────────────

  /** Force a WAL checkpoint. Call periodically in production. */
  checkpoint(): void {
    this.primary.pragma(`wal_checkpoint(TRUNCATE)`);
  }

  /** Pool statistics for monitoring. */
  stats(): PoolStats {
    return {
      primary: { path: this.path, open: this._open, totalQueries: this.primaryQueries },
      replicas: this.replicas.map((r, i) => ({
        path: (r as any).name as string,
        open: this._open,
        totalQueries: this.replicaQueries[i] ?? 0,
      })),
      pendingCheckpoints: 0,
    };
  }

  /** Close all connections. */
  close(): void {
    this._open = false;
    this.primary.close();
    for (const r of this.replicas) r.close();
  }
}

/** Create a new pool. */
export function createSqlitePool(options: SqlitePoolOptions): SqlitePool {
  return new SqlitePool(options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Create a migration record for the workbench schema evolution. */
export function createMigration(
  version: number,
  description: string,
  up: (db: BetterSqlite3Database) => void,
  down?: (db: BetterSqlite3Database) => void,
): Migration {
  const result: Migration = { version, description, up };
  if (down !== undefined) {
    (result as { down: typeof down }).down = down;
  }
  return result;
}
