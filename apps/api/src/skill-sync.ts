/**
 * skill-sync.ts — A30 background sync for catalog SKILL.md sources.
 *
 * Wakes up every SYNC_INTERVAL_MS and re-pulls every catalog entry's
 * SKILL.md from raw.githubusercontent.com, computing a sha256 over the
 * bytes. If the bytes changed since the last sync we:
 *   - write a new versioned snapshot under sync/<id>/<sha256>.SKILL.md
 *     in the datafoundry audit dir, and
 *   - record a dfd_audit_events row (action="sync", severity="info")
 *   - append a fsf_messages row (intent="skill_marketplace", sub_intent="sync")
 *
 * The catalog itself is the source of truth for which repos to watch; we
 * never reach out to GitHub for anything not in the catalog (SSRF guard).
 *
 * This is intentionally lightweight: it does NOT re-install or re-run any
 * existing workspace skill — it just keeps a fresh authoritative copy on
 * disk + in the audit log so operators can spot upstream drift.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildSkillRawUrl,
  loadCatalog,
  type SkillCatalogEntry
} from "@datafoundry/skills";
import { supabase } from "@datafoundry/supabase-bridge";

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const FETCH_TIMEOUT_MS = 15_000;
const MAX_SKILL_BYTES = 512 * 1024;

const SYNC_ROOT = resolve(
  process.env.SKILL_SYNC_DIR ?? resolve(process.cwd(), "storage", "skill-sync")
);
const STATE_FILE = resolve(SYNC_ROOT, "state.json");

type SyncState = Record<
  string,
  { sha256: string; fetchedAt: string; url: string; error?: string }
>;

let _interval: ReturnType<typeof setInterval> | null = null;
let _running = false;

const ensureSyncRoot = (): void => {
  mkdirSync(SYNC_ROOT, { recursive: true });
};

const readState = (): SyncState => {
  if (!existsSync(STATE_FILE)) return {};
  try {
    const raw = readFileSync(STATE_FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as SyncState;
    }
  } catch {
    // fall through
  }
  return {};
};

const writeState = (state: SyncState): void => {
  ensureSyncRoot();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
};

const sha256Hex = (buffer: Buffer): string => createHash("sha256").update(buffer).digest("hex");

const fetchOne = async (
  entry: SkillCatalogEntry,
  fetcher: typeof fetch
): Promise<{ buffer: Buffer; url: string }> => {
  const url = buildSkillRawUrl(entry);
  const response = await Promise.race([
    fetcher(url, {
      headers: {
        "User-Agent": "DataFoundry-Skill-Sync/1.0",
        Accept: "text/plain,text/markdown"
      },
      redirect: "follow"
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("FETCH_TIMEOUT")), FETCH_TIMEOUT_MS)
    )
  ]);
  if (!response.ok) {
    throw new Error(`GITHUB_HTTP_${response.status}`);
  }
  const text = await response.text();
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length > MAX_SKILL_BYTES) {
    throw new Error(`SKILL_MD_TOO_LARGE:${buffer.length}`);
  }
  return { buffer, url };
};

export type SyncTickSummary = {
  checked: number;
  changed: string[];
  errors: Array<{ id: string; error: string }>;
  startedAt: string;
  finishedAt: string;
};

/** One sync iteration: re-fetch every catalog entry, diff against state. */
export const runSkillSyncOnce = async (
  options: { fetcher?: typeof fetch; supabaseClient?: ReturnType<typeof supabase> } = {}
): Promise<SyncTickSummary> => {
  const fetcher = options.fetcher ?? fetch;
  const client = options.supabaseClient ?? supabase();
  const catalog = loadCatalog();
  const state = readState();
  const startedAt = new Date().toISOString();
  const changed: string[] = [];
  const errors: Array<{ id: string; error: string }> = [];

  for (const entry of catalog) {
    try {
      const { buffer, url } = await fetchOne(entry, fetcher);
      const sha = sha256Hex(buffer);
      const previous = state[entry.id];
      if (!previous || previous.sha256 !== sha) {
        const snapshotPath = resolve(SYNC_ROOT, entry.id, `${sha}.SKILL.md`);
        mkdirSync(resolve(SYNC_ROOT, entry.id), { recursive: true });
        writeFileSync(snapshotPath, buffer);
        state[entry.id] = { fetchedAt: new Date().toISOString(), sha256: sha, url };
        changed.push(entry.id);

        if (client.enabled) {
          await client.insert("dfd_audit_events", {
            workspace_id: "default",
            actor_id: null,
            category: "skill-marketplace",
            severity: "info",
            action: "sync",
            target: entry.id,
            payload: {
              repo: entry.repo,
              ref: entry.defaultRef,
              skill_path: entry.skillPath,
              sha256: sha,
              previous_sha256: previous?.sha256 ?? null,
              snapshot_path: snapshotPath,
              bytes: buffer.length,
              synced_at: startedAt
            }
          });
          await client.insert("fsf_messages", {
            conversation_id: "marketplace",
            role: "system",
            content: `skill-marketplace:sync:${entry.id}@${entry.repo}#${entry.defaultRef}`,
            intent: "skill_marketplace",
            sub_intent: "sync",
            risk_level: "low",
            audit_status: "pass",
            audit_violations: [],
            metadata: {
              repo: entry.repo,
              ref: entry.defaultRef,
              sha256: sha,
              previous_sha256: previous?.sha256 ?? null,
              synced_at: startedAt
            }
          });
        }
      } else {
        // bump fetchedAt only when unchanged so we can spot dead repos
        state[entry.id] = { ...previous, fetchedAt: new Date().toISOString() };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ error: message, id: entry.id });
      const previousEntry = state[entry.id];
      state[entry.id] = {
        sha256: previousEntry?.sha256 ?? "",
        url: previousEntry?.url ?? "",
        error: message,
        fetchedAt: new Date().toISOString()
      };
    }
  }

  writeState(state);

  return {
    changed,
    checked: catalog.length,
    errors,
    finishedAt: new Date().toISOString(),
    startedAt
  };
};

/** Start the periodic background sync. No-op if already running. */
export const startSkillSyncWorker = (intervalMs: number = DEFAULT_INTERVAL_MS): void => {
  if (_interval) return;
  ensureSyncRoot();

  // kick once on startup so operators see something in the logs even before the
  // first interval fires
  void runSkillSyncOnce().then((summary) => {
    console.info(
      `[skill-sync] initial tick: checked=${summary.checked} changed=${summary.changed.length} errors=${summary.errors.length}`
    );
  });

  _interval = setInterval(() => {
    if (_running) return;
    _running = true;
    runSkillSyncOnce()
      .then((summary) => {
        if (summary.changed.length > 0 || summary.errors.length > 0) {
          console.info(
            `[skill-sync] tick: checked=${summary.checked} changed=${summary.changed.join(",") || "-"} errors=${summary.errors.length}`
          );
        }
      })
      .catch((err) => {
        console.error(`[skill-sync] tick failed: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        _running = false;
      });
  }, intervalMs);

  if (typeof _interval.unref === "function") _interval.unref();
};

/** Stop the worker (mainly for tests + graceful shutdown). */
export const stopSkillSyncWorker = (): void => {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
};
