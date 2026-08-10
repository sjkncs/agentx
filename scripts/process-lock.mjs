#!/usr/bin/env node
/**
 * Process lock — per-test .lock file management.
 *
 * Each test writes a JSON lock file with:
 *   { pid, ports, command, startedAt, pidPath }
 *
 * On test exit (graceful OR SIGINT/SIGTERM), the lock is removed.
 * Concurrent tests detect existing locks and either wait or skip.
 */
import fs from 'node:fs';
import path from 'node:path';

const LOCK_DIR = path.resolve(process.cwd(), '.run');

function ensureLockDir() {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
}

export function acquireLock(name, payload) {
  ensureLockDir();
  const file = path.join(LOCK_DIR, `${name}.lock`);
  if (fs.existsSync(file)) {
    try {
      const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      // Detect stale lock: if PID is not running, overwrite
      try {
        process.kill(existing.pid, 0); // throws if PID doesn't exist
        return { ok: false, reason: 'busy', existing };
      } catch {
        // Stale lock: overwrite
      }
    } catch {
      // Corrupt lock: overwrite
    }
  }
  const data = { ...payload, name, startedAt: Date.now() };
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return { ok: true, file, data };
}

export function releaseLock(name) {
  const file = path.join(LOCK_DIR, `${name}.lock`);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

export function listLocks() {
  ensureLockDir();
  return fs.readdirSync(LOCK_DIR)
    .filter(f => f.endsWith('.lock'))
    .map(f => {
      try {
        return { name: f.replace('.lock', ''), ...JSON.parse(fs.readFileSync(path.join(LOCK_DIR, f), 'utf8')) };
      } catch {
        return { name: f.replace('.lock', ''), corrupt: true };
      }
    });
}

export function cleanAll() {
  ensureLockDir();
  for (const f of fs.readdirSync(LOCK_DIR)) {
    if (f.endsWith('.lock')) fs.unlinkSync(path.join(LOCK_DIR, f));
  }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const cmd = process.argv[2];
  const arg = process.argv[3];
  if (cmd === 'list') {
    console.log(JSON.stringify(listLocks(), null, 2));
  } else if (cmd === 'clean') {
    cleanAll();
    console.log('cleaned');
  } else if (cmd === 'acquire' && arg) {
    const r = acquireLock(arg, { pid: process.pid, ports: process.env.PORTS ? JSON.parse(process.env.PORTS) : null });
    console.log(JSON.stringify(r));
  } else if (cmd === 'release' && arg) {
    const r = releaseLock(arg);
    console.log(JSON.stringify({ ok: r }));
  } else {
    console.error('Usage: process-lock.mjs list|clean|acquire <name>|release <name>');
  }
}