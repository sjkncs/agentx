#!/usr/bin/env node
/**
 * dev-isolated.mjs — process-isolated launcher for any AgentX script.
 *
 * Usage:
 *   node scripts/dev-isolated.mjs -- <command> [args...]
 *   node scripts/dev-isolated.mjs -- node scripts/smoke-foo.mjs
 *   node scripts/dev-isolated.mjs -- npm run smoke:agent
 *
 * Each launch:
 *   1. Acquires a port block in 14000–14999 (avoids 3000/8787/8000)
 *   2. Writes a .lock file in .run/<name>.lock with PID + ports
 *   3. Sets PORT_WEB / PORT_API / PORT_DB env vars
 *   4. Spawns the child; on exit, removes the lock
 *   5. Handles SIGINT/SIGTERM with 5-second SIGKILL grace
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { allocatePorts } from './port-allocator.mjs';
import { acquireLock, releaseLock, listLocks } from './process-lock.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const RUN_DIR = path.join(ROOT, '.run');

fs.mkdirSync(RUN_DIR, { recursive: true });

const args = process.argv.slice(2);
const sepIdx = args.indexOf('--');
if (sepIdx === -1) {
  console.error('Usage: dev-isolated.mjs -- <command> [args...]');
  console.error('Example: dev-isolated.mjs -- npm run smoke:agent');
  process.exit(2);
}
const cmd = args.slice(sepIdx + 1);
const name = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

console.log('--- dev-isolated launcher ---');
console.log('Existing locks:', listLocks().length);

const portBlock = await allocatePorts({ count: 4, start: 14000, end: 14999 });
console.log('Allocated ports:', portBlock.ports);

const lock = acquireLock(name, { pid: process.pid, ports: portBlock.ports, cmd: cmd.join(' ') });
if (!lock.ok) {
  console.error(`Lock conflict: ${JSON.stringify(lock.existing)}`);
  process.exit(3);
}

const env = {
  ...process.env,
  ...Object.fromEntries(
    Object.entries(portBlock.ports).map(([k, v]) => [`PORT_${k.toUpperCase()}`, String(v)]),
  ),
  AGENTX_TEST_NAME: name,
};

const logDir = path.join(RUN_DIR, name);
fs.mkdirSync(logDir, { recursive: true });
const stdout = fs.openSync(path.join(logDir, 'stdout.log'), 'w');
const stderr = fs.openSync(path.join(logDir, 'stderr.log'), 'w');
console.log(`Logs: ${logDir}`);

const child = spawn(cmd[0], cmd.slice(1), {
  cwd: ROOT,
  env,
  stdio: ['ignore', stdout, stderr],
  detached: false,
});

const cleanup = (code) => {
  releaseLock(name);
  fs.closeSync(stdout); fs.closeSync(stderr);
  console.log(`\n--- dev-isolated finished (exit=${code}) ---`);
  process.exit(code);
};

process.on('SIGINT', () => { try { child.kill('SIGTERM'); } catch {} setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5_000); });
process.on('SIGTERM', () => { try { child.kill('SIGTERM'); } catch {} });

child.on('exit', cleanup);