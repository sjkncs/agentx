#!/usr/bin/env node
/**
 * Port allocator — finds free ports in a configured range.
 *
 * Usage:
 *   const alloc = await allocatePorts({ count: 3, start: 14000, end: 14999, exclude: [3000, 8787, 8000] });
 *   console.log(alloc.ports); // { web: 14000, api: 14001, db: 14002 }
 */
import net from 'node:net';

function isFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

export async function allocatePorts({
  count = 3,
  start = 14000,
  end = 14999,
  exclude = [3000, 3001, 4173, 5173, 8000, 8001, 8787, 8788],
  names = ['web', 'api', 'db'],
  maxAttempts = 200,
} = {}) {
  const out = {};
  const used = new Set([...exclude]);
  let cursor = start;
  let attempts = 0;

  for (let i = 0; i < count; i++) {
    let found = false;
    while (cursor <= end && attempts < maxAttempts) {
      attempts++;
      if (!used.has(cursor) && await isFree(cursor)) {
        out[names[i] ?? `p${i}`] = cursor;
        used.add(cursor);
        cursor++;
        found = true;
        break;
      }
      cursor++;
    }
    if (!found) throw new Error(`No free port found for slot ${i} (attempts=${attempts})`);
  }
  return { ports: out, range: [start, end], excluded: exclude };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const result = await allocatePorts();
  console.log(JSON.stringify(result, null, 2));
}