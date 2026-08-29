#!/usr/bin/env node
/**
 * agentx-desktop incremental builder
 *
 * Wraps `electron-builder` with a content-addressed fingerprint so a
 * `./dist` rebuild is fast when nothing in the desktop bundle's input
 * surface has changed.
 *
 * Inputs (every file & mtime feeds the fingerprint):
 *   - apps/desktop/package.json
 *   - apps/desktop/src/** (Electron main, renderer, preload, html, css)
 *   - apps/desktop/build/icon.{ico,png}
 *   - apps/api/dist/** (built API server)
 *   - packages/data-gateway/dist/** (built data-gateway adapters)
 *   - packages/metadata/dist/** (built metadata store)
 *   - packages/counterfactual/src/** (CDL module loaded by main)
 *   - node_modules/electron/dist/electron.exe (Electron version)
 *   - electron-builder version (package.json devDependencies)
 *
 * Outputs:
 *   - apps/desktop/dist/AgentX Desktop-0.1.0-x64.exe      (NSIS)
 *   - apps/desktop/dist/AgentX Desktop-0.1.0-portable.exe (portable)
 *   - apps/desktop/dist/win-unpacked/                         (unpacked)
 *   - .cache/desktop-builder/fingerprint.json                  (cache state)
 *   - .cache/desktop-builder/last-snapshot/                    (previous dist)
 *
 * Cache strategy:
 *   1. Hash all inputs → SHA-256 fingerprint.
 *   2. If fingerprint matches `.cache/.../fingerprint.json` AND the
 *      previous dist artifacts still exist on disk → no rebuild.
 *      Restore them from the snapshot dir (in case they were deleted).
 *   3. Otherwise:
 *        - Take a snapshot of the current dist into last-snapshot/
 *        - Run `electron-builder`
 *        - Write the new fingerprint
 *
 * Usage:
 *   node scripts/builder-desktop.mjs                 # default dist
 *   node scripts/builder-desktop.mjs --target=nsis   # NSIS only
 *   node scripts/builder-desktop.mjs --target=portable
 *   node scripts/builder-desktop.mjs --no-cache      # force rebuild
 *   node scripts/builder-desktop.mjs --verbose       # emit file paths
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const APPS = path.join(ROOT, "apps", "desktop");
const CACHE_DIR = path.join(ROOT, ".cache", "desktop-builder");
const FINGERPRINT_PATH = path.join(CACHE_DIR, "fingerprint.json");
const SNAPSHOT_DIR = path.join(CACHE_DIR, "last-snapshot");
const DIST_DIR = path.join(APPS, "dist");
const VERBOSE = process.argv.includes("--verbose");
const FORCE = process.argv.includes("--no-cache");
const DRY_RUN = process.argv.includes("--dry-run");
const INIT_ONLY = process.argv.includes("--init");
const targetArg = process.argv.find((arg) => arg.startsWith("--target="));
const TARGET = targetArg ? targetArg.split("=")[1] : null;

const log = (msg) => console.log(`[desktop-builder] ${msg}`);
const verbose = (msg) => VERBOSE && console.log(`[desktop-builder]   ${msg}`);

async function walkFiles(dir) {
  const out = [];
  async function visit(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  await visit(dir);
  return out;
}

async function fingerprint() {
  const inputs = [
    path.join(APPS, "package.json"),
    path.join(APPS, "package-lock.json"),
    path.join(ROOT, "package.json"),
    path.join(ROOT, "package-lock.json"),
    path.join(ROOT, "node_modules", "electron", "dist", "electron.exe"),
    path.join(ROOT, "node_modules", "electron-builder", "package.json"),
    // API + workspace packages feeding the desktop bundle
    path.join(ROOT, "apps", "api", "dist"),
    path.join(ROOT, "packages", "data-gateway", "dist"),
    path.join(ROOT, "packages", "metadata", "dist"),
    path.join(ROOT, "packages", "counterfactual"),
    // Electron main entry surface
    path.join(APPS, "src"),
    path.join(APPS, "build"),
  ];
  const hasher = createHash("sha256");
  const files = [];
  for (const input of inputs) {
    if (!existsSync(input)) {
      continue;
    }
    const st = statSync(input);
    if (st.isDirectory()) {
      const found = await walkFiles(input);
      files.push(...found);
    } else {
      files.push(input);
    }
  }
  // Sort for determinism
  files.sort();
  for (const file of files) {
    let st;
    try {
      st = statSync(file);
    } catch {
      continue;
    }
    const rel = path.relative(ROOT, file);
    hasher.update(rel);
    hasher.update("|");
    hasher.update(String(st.size));
    hasher.update("|");
    hasher.update(String(st.mtimeMs));
    hasher.update("|");
    try {
      const buf = readFileSync(file);
      hasher.update(createHash("sha256").update(buf).digest("hex"));
    } catch {
      // unreadable — mtime alone is good enough
    }
  }
  return hasher.digest("hex");
}

async function loadPreviousFingerprint() {
  if (!existsSync(FINGERPRINT_PATH)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(FINGERPRINT_PATH, "utf8"));
  } catch {
    return null;
  }
}

async function snapshotDist() {
  if (!existsSync(DIST_DIR)) {
    return;
  }
  rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  // Copy top-level .exe + win-unpacked recursively
  const entries = await readdir(DIST_DIR, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(DIST_DIR, entry.name);
    const dst = path.join(SNAPSHOT_DIR, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(src, dst);
    } else {
      copyFileSync(src, dst);
    }
  }
}

function copyDirRecursive(src, dst) {
  mkdirSync(dst, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

function restoreSnapshot() {
  if (!existsSync(SNAPSHOT_DIR)) {
    return false;
  }
  mkdirSync(DIST_DIR, { recursive: true });
  const entries = readdirSync(SNAPSHOT_DIR, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(SNAPSHOT_DIR, entry.name);
    const dst = path.join(DIST_DIR, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(src, dst);
    } else {
      copyFileSync(src, dst);
    }
  }
  return true;
}

function previousArtifactsExist() {
  if (!existsSync(SNAPSHOT_DIR)) {
    return false;
  }
  // Heuristic: any .exe in the snapshot means previous build succeeded
  const has = (dir) => {
    try {
      const items = readdirSync(dir);
      return items.some((name) => name.endsWith(".exe"));
    } catch {
      return false;
    }
  };
  return has(SNAPSHOT_DIR) || has(path.join(SNAPSHOT_DIR, "win-unpacked"));
}

async function runElectronBuilder() {
  const args = ["run", "dist"];
  if (TARGET) {
    // npm run dist is fixed to "nsis portable --x64"; for target filter,
    // we invoke electron-builder directly with the resolved target.
    const targetFlag = TARGET === "nsis" ? "--nsis" : TARGET === "portable" ? "--portable" : null;
    if (targetFlag) {
      args.length = 0;
      args.push("exec", "--", "electron-builder", "--win", targetFlag, "--x64");
    }
  }
  log(`running: npm ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, {
      cwd: APPS,
      stdio: "inherit",
      env: process.env,
      shell: true,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`electron-builder exited ${code}`));
    });
  });
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });
  const start = Date.now();
  const fp = await fingerprint();
  log(`fingerprint: ${fp.slice(0, 16)}…`);

  if (DRY_RUN) {
    log("dry-run — exiting without rebuild");
    return;
  }

  if (INIT_ONLY) {
    log("--init: snapshotting current dist and persisting fingerprint");
    await snapshotDist();
    writeFileSync(
      FINGERPRINT_PATH,
      JSON.stringify(
        { fingerprint: fp, timestamp: new Date().toISOString(), target: TARGET ?? "all" },
        null,
        2
      )
    );
    log(`init OK; fingerprint=${fp.slice(0, 16)}…`);
    return;
  }

  const prev = await loadPreviousFingerprint();
  const cacheHit = !FORCE && prev && prev.fingerprint === fp && previousArtifactsExist();
  if (cacheHit) {
    log("cache hit — skipping electron-builder");
    const restored = restoreSnapshot();
    if (!restored) {
      log("snapshot missing — falling back to rebuild");
    } else {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      log(`done (restored) in ${elapsed}s`);
      return;
    }
  } else if (FORCE) {
    log("--no-cache: forcing rebuild");
  } else if (prev && prev.fingerprint !== fp) {
    log(`fingerprint changed (${prev.fingerprint?.slice(0, 8)}… → ${fp.slice(0, 8)}…)`);
  }

  await runElectronBuilder();
  await snapshotDist();
  writeFileSync(
    FINGERPRINT_PATH,
    JSON.stringify(
      {
        fingerprint: fp,
        timestamp: new Date().toISOString(),
        target: TARGET ?? "all",
      },
      null,
      2
    )
  );
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log(`build OK in ${elapsed}s; fingerprint persisted`);
}

main().catch((err) => {
  console.error("[desktop-builder] failed:", err);
  process.exit(1);
});