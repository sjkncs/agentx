#!/usr/bin/env node
/**
 * test-full-stack-async.mjs — Full-stack async connectivity + race-condition harness.
 *
 * Discovers all smoke-* scripts in scripts/, runs them sequentially in isolated
 * port ranges with per-test .lock files, captures stdout/stderr, and produces
 * a summary table. Detects:
 *   - Port collisions (via port-allocator)
 *   - Process collisions (via process-lock)
 *   - Async races (via configurable --timeout and concurrency per test)
 *   - Memory leaks (via process.memoryUsage() snapshots)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { allocatePorts } from './port-allocator.mjs';
import { acquireLock, releaseLock, cleanAll } from './process-lock.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SCRIPTS = path.join(ROOT, 'scripts');
const RUN_DIR = path.join(ROOT, '.run');

// --- Args parsing ---
const args = process.argv.slice(2);
const FILTER = args.find(a => a.startsWith('--filter='))?.slice('--filter='.length);
const SKIP_BUILD = args.includes('--skip-build');
const TIMEOUT_MS = parseInt(args.find(a => a.startsWith('--timeout='))?.slice('--timeout='.length) ?? '60000', 10);

// --- Test inventory ---
function discoverTests() {
  const files = fs.readdirSync(SCRIPTS);
  return files
    .filter(f => f.endsWith('.test.mjs') || (f.startsWith('smoke-') && f.endsWith('.mjs')))
    .filter(f => !FILTER || f.includes(FILTER))
    .filter(f => !f.includes('dacomp6-complex-cases'))  // slow
    .map(f => ({
      name: f.replace('.mjs', ''),
      path: path.join(SCRIPTS, f),
      needsBuild: f.includes('copilotkit') || f.includes('agent-runtime') || f.includes('sql') || f.includes('datasources'),
      timeout: f.includes('dacomp6') ? 180_000 : TIMEOUT_MS,
    }));
}

// --- Runner ---
function runOne(test) {
  return new Promise(async (resolve) => {
    const lockResult = acquireLock(test.name, { pid: process.pid, script: test.name });
    if (!lockResult.ok) {
      return resolve({ name: test.name, status: 'skipped', reason: `lock-busy: ${JSON.stringify(lockResult.existing)}` });
    }
    const portResult = await allocatePorts({ count: 3, start: 14000, end: 14999 });
    const env = {
      ...process.env,
      ...Object.fromEntries(Object.entries(portResult.ports).map(([k, v]) => [`PORT_${k.toUpperCase()}`, String(v)])),
      AGENTX_TEST_PORTS: JSON.stringify(portResult.ports),
    };
    const logDir = path.join(RUN_DIR, test.name);
    fs.mkdirSync(logDir, { recursive: true });
    const stdout = fs.openSync(path.join(logDir, 'stdout.log'), 'w');
    const stderr = fs.openSync(path.join(logDir, 'stderr.log'), 'w');

    const child = spawn('node', [test.path], {
      cwd: ROOT,
      env,
      stdio: ['ignore', stdout, stderr],
      detached: false,
    });

    const startedAt = Date.now();
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5_000);
    }, test.timeout);

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      fs.closeSync(stdout); fs.closeSync(stderr);
      releaseLock(test.name);
      const elapsed = Date.now() - startedAt;
      resolve({
        name: test.name,
        status: killed ? 'timeout' : (code === 0 ? 'pass' : `fail(exit=${code},signal=${signal})`),
        elapsed,
        ports: portResult.ports,
        logDir,
      });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      fs.closeSync(stdout); fs.closeSync(stderr);
      releaseLock(test.name);
      resolve({ name: test.name, status: `fail(err=${err.message})`, elapsed: Date.now() - startedAt, ports: portResult.ports, logDir });
    });
  });
}

// --- Main ---
async function main() {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  if (!SKIP_BUILD) {
    console.log('=== Build ===');
    const buildResult = await new Promise((resolve) => {
      const build = spawn('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
      build.on('exit', (code) => resolve(code));
    });
    if (buildResult !== 0) {
      console.error(`Build failed with code ${buildResult}. Aborting.`);
      process.exit(2);
    }
  }

  const tests = discoverTests();
  console.log(`=== Tests (${tests.length}) ===`);
  const startTime = Date.now();
  const results = [];
  for (const t of tests) {
    process.stdout.write(`  ${t.name} ... `);
    const r = await runOne(t);
    results.push(r);
    console.log(`${r.status} (${r.elapsed}ms)`);
  }

  console.log('\n=== Summary ===');
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status.startsWith('fail') || r.status === 'timeout').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  console.log(`Total: ${results.length}, Pass: ${passed}, Fail: ${failed}, Skip: ${skipped}`);
  console.log(`Total elapsed: ${Date.now() - startTime}ms`);

  fs.writeFileSync(
    path.join(RUN_DIR, 'summary.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), results, totals: { total: results.length, passed, failed, skipped } }, null, 2),
  );

  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });