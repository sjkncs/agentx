#!/usr/bin/env node
/**
 * DataFoundry Desktop — Electron main process
 *
 * Architecture:
 *   BrowserWindow (renderer)
 *      ↓ IPC
 *   Main process
 *      ├─→ spawn API server (apps/api/dist/start.mjs) on allocated port
 *      ├─→ optionally spawn Web (apps/web/.next/standalone) on next port
 *      ├─→ optionally spawn TUI in a hidden xterm terminal
 *      └─→ App lifecycle + window state persistence
 *
 * Process isolation:
 *   - Ports allocated from 14500–14600 (separate from 14000–14999 dev range)
 *   - .run/desktop.lock prevents double-launch
 *   - SIGTERM graceful shutdown, then SIGKILL after 5s
 */
import { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import net from 'node:net';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// In a dev run, __dirname is inside apps/desktop/src and ROOT is the repo root.
// In a packaged build, __dirname is inside app.asar/apps/desktop/src and the
// workspace packages are unreachable from their src/ location. We prefer
// node_modules resolution (works in both dev and packaged) and only fall back
// to the source tree when nothing else is available.
const ROOT = path.resolve(__dirname, '..', '..', '..');
const RUN_DIR = path.join(ROOT, '.run');
const LOCK_FILE = path.join(RUN_DIR, 'desktop.lock');
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');

// ---------------- Single-instance lock ----------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ---------------- Port allocator ----------------
function isFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}
async function allocatePort(start = 14500, end = 14600) {
  for (let p = start; p < end; p++) if (await isFree(p)) return p;
  throw new Error('No free port found in range');
}

// ---------------- Child process management ----------------
const children = new Map(); // name → { proc, port, logFile }

function startChild(name, scriptPath, port, env = {}) {
  const logDir = path.join(RUN_DIR, 'desktop');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = fs.openSync(path.join(logDir, `${name}.log`), 'a');
  const proc = spawn(process.execPath, [scriptPath], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...env,
      PORT: String(port),
      DATAFOUNDRY_PORT: String(port),
      NODE_ENV: 'production',
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: ['ignore', logFile, logFile],
    windowsHide: true,
  });
  console.log(`[${name}] execPath=${process.execPath} script=${scriptPath} port=${port}`);
  children.set(name, { proc, port, logFile });
  proc.on('exit', (code, signal) => {
    console.log(`[${name}] exit code=${code} signal=${signal}`);
  });
  return proc;
}

async function waitForHttp(url, timeoutMs = 30_000, intervalMs = 250) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404 || res.status === 401) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// ---------------- Lifecycle ----------------
let mainWindow = null;
let tray = null;
let apiPort = null;

async function startApiServer() {
  // Pin the desktop-bundled API server to 8787 so it matches the dev-mode
  // default (scripts/dev.mjs) and the runtime URLs baked into the web BFF,
  // TUI, smoke scripts, and docs. Using a random port in 14500–14600
  // produced `ERR_CONNECTION_REFUSED (-102)` errors whenever a renderer or
  // script tried to reach the canonical `http://127.0.0.1:8787/`.
  const desiredPort = 8787;
  apiPort = (await isFree(desiredPort)) ? desiredPort : await allocatePort();
  const apiEntry = path.join(ROOT, 'apps', 'api', 'dist', 'index.js');
  if (!fs.existsSync(apiEntry)) {
    console.warn(`API server bundle missing: ${apiEntry}`);
    return null;
  }
  console.log(`Starting API on port ${apiPort} from ${apiEntry}`);
  const env = {
    ...process.env,
    AUTH_EMAIL_DELIVERY: 'test',
    AUTH_REGISTRATION_MODE: 'open',
    AUTH_PUBLIC_BASE_URL: `http://127.0.0.1:${apiPort}`,
    AUTH_SESSION_SECRET: 'desktop_session_secret_at_least_32_characters_long',
    DATAFOUNDRY_AUTH_MODE: 'password',
    DATAFOUNDRY_PORT: String(apiPort),
    PORT: String(apiPort),
    NODE_ENV: 'production',
  };
  const proc = startChild('api', apiEntry, apiPort, env);
  const ready = await waitForHttp(`http://127.0.0.1:${apiPort}/healthz`, 30_000);
  if (!ready) {
    console.warn(`API on ${apiPort} did not become ready within 30s. Last stderr will be in api.log. Falling back to standalone mode.`);
    try { proc.kill('SIGTERM'); } catch {}
    return null;
  }
  return apiPort;
}

function loadWindowState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch {}
  return { width: 1400, height: 900, x: undefined, y: undefined, maximized: false };
}

function saveWindowState() {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  const state = {
    ...bounds,
    maximized: mainWindow.isMaximized(),
  };
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('Failed to save window state:', err);
  }
}

async function createMainWindow() {
  if (!apiPort) apiPort = await startApiServer();
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1024,
    minHeight: 700,
    title: 'DataFoundry Desktop',
    backgroundColor: '#0b0d12',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (state.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', saveWindowState);
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load the local index.html (CDL panel + iframe to Web workbench)
  const indexHtml = path.join(__dirname, 'index.html');
  console.log(`Loading ${indexHtml}`);
  await mainWindow.loadFile(indexHtml);

  return mainWindow;
}

// ---------------- IPC API surface (exposed via preload) ----------------
ipcMain.handle('app:getInfo', () => ({
  name: app.getName(),
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  apiPort,
  apiUrl: apiPort ? `http://127.0.0.1:${apiPort}` : null,
  cwd: ROOT,
  userData: app.getPath('userData'),
  logs: path.join(RUN_DIR, 'desktop'),
}));

ipcMain.handle('app:openLogs', () => {
  const logDir = path.join(RUN_DIR, 'desktop');
  fs.mkdirSync(logDir, { recursive: true });
  shell.openPath(logDir);
  return logDir;
});

ipcMain.handle('app:openRepo', () => {
  shell.openPath(ROOT);
  return ROOT;
});

ipcMain.handle('app:restart', async () => {
  for (const [, { proc }] of children) {
    try { proc.kill('SIGTERM'); } catch {}
  }
  await new Promise((r) => setTimeout(r, 2_000));
  for (const [, { proc }] of children) {
    try { proc.kill('SIGKILL'); } catch {}
  }
  app.relaunch();
  app.quit();
});

// ---------------- Resilient counterfactual loader ----------------
// Cached dynamic import for @datafoundry/counterfactual. We try several
// resolution strategies because the right path differs between `npm start`
// (dev, .mjs source tree) and the packaged `electron-builder` build
// (asar, node_modules). The version exported from packages/counterfactual's
// package.json is followed when available.
let cdlModulePromise = null;
async function loadCdl() {
  if (cdlModulePromise) return cdlModulePromise;
  cdlModulePromise = (async () => {
    const candidates = [
      // 1) node_modules (dev install + packaged app.asar/node_modules)
      () => {
        const entry = require.resolve('@datafoundry/counterfactual');
        return { kind: 'node_modules', spec: entry };
      },
      // 2) workspace source tree (dev, when symlinks are present)
      () => {
        const pkgRoot = path.join(ROOT, 'packages', 'counterfactual');
        const pkg = JSON.parse(
          fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'),
        );
        const rel = pkg.exports?.['.'] ?? pkg.main ?? './src/index.mjs';
        const spec = path.join(pkgRoot, rel.replace(/^\.\//, ''));
        if (!fs.existsSync(spec)) throw new Error('not found');
        return { kind: 'source', spec };
      },
    ];
    const errors = [];
    for (const resolve of candidates) {
      try {
        const { spec } = resolve();
        const mod = await import(spec);
        if (mod?.regimeConditionalDecision) return mod;
        throw new Error('regimeConditionalDecision not exported');
      } catch (err) {
        errors.push(err.message || String(err));
      }
    }
    throw new Error(
      `Failed to load @datafoundry/counterfactual: ${errors.join(' | ')}`,
    );
  })().catch((err) => {
    cdlModulePromise = null; // allow retry on next call
    throw err;
  });
  return cdlModulePromise;
}

ipcMain.handle('cdl:run', async (_evt, payload) => {
  try {
    const cdl = await loadCdl();
    const { regime, phiSem, phiCf, uSem, uCf } = payload ?? {};
    const decision = cdl.regimeConditionalDecision({
      regime, phiSem, phiCf, uSem, uCf,
    });
    // Theorem 3 verification: a regime-conditional u* strictly dominates the
    // best uniform u over the bull/bear/sideways support. We use a simple
    // squared-distance cost from each regime's preferred action.
    const target = { bull: uCf, bear: uSem, sideways: (uSem + uCf) / 2 };
    const costFn = (u, r) => {
      const regimeCost = r === 'bull' ? 0.2 : r === 'bear' ? 0.5 : 0.3;
      return (u - target[r]) ** 2 + 0.1 * regimeCost;
    };
    const allRegimes = ['bull', 'bear', 'sideways'];
    const theorem3 = cdl.theorem3Gap
      ? cdl.theorem3Gap(costFn, allRegimes, target)
      : null;
    return {
      ok: true,
      result: {
        alpha: decision.alpha,
        u: decision.u,
        J: decision.J,
        theorem3: theorem3?.gap ? theorem3.gap < 0 : false,
        theorem3Gap: theorem3?.gap ?? null,
      },
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

// ---------------- Tray (optional) ----------------
function createTray() {
  // 16x16 empty placeholder; in production, use a proper PNG/ICO
  const image = nativeImage.createEmpty();
  try {
    tray = new Tray(image);
    const menu = Menu.buildFromTemplate([
      { label: 'DataFoundry Desktop', enabled: false },
      { type: 'separator' },
      { label: 'Show window', click: () => mainWindow?.show() },
      { label: 'Open logs', click: () => shell.openPath(path.join(RUN_DIR, 'desktop')) },
      { label: 'Open repo', click: () => shell.openPath(ROOT) },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
    tray.setToolTip('DataFoundry Desktop');
    tray.setContextMenu(menu);
  } catch (err) {
    console.warn('Tray creation failed:', err);
  }
}

// ---------------- App boot ----------------
fs.mkdirSync(RUN_DIR, { recursive: true });

// Acquire lock
if (fs.existsSync(LOCK_FILE)) {
  try {
    const prev = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    process.kill(prev.pid, 0);
    dialog.showErrorBox('DataFoundry Desktop', 'Another instance is already running.');
    app.quit();
    process.exit(0);
  } catch {
    // Stale lock — overwrite
  }
}
fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: Date.now() }, null, 2));

app.whenReady().then(async () => {
  await startApiServer();
  await createMainWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  for (const [, { proc }] of children) {
    try { proc.kill('SIGTERM'); } catch {}
  }
  setTimeout(() => {
    for (const [, { proc }] of children) {
      try { proc.kill('SIGKILL'); } catch {}
    }
  }, 5_000);
});

app.on('will-quit', () => {
  for (const { logFile } of children.values()) {
    try { fs.closeSync(logFile); } catch {}
  }
  try { fs.unlinkSync(LOCK_FILE); } catch {}
});