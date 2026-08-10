# DataFoundry Desktop — Architecture Notes

**Status:** Electron 35 + Node 22 confirmed working. FTS5 limitation in Electron's bundled SQLite prevents running the full API server (which depends on `fts5` for knowledge document search). **Strategy: API is optional, with direct package import as the primary local path.**

## What works

| Component | Status | Notes |
|-----------|--------|-------|
| Electron 35 + Node 22 | ✅ | Verified with `node:sqlite` import |
| Standalone CDL panel | ✅ | Direct ESM import, no API needed |
| Status / info panel | ✅ | Pure Electron + IPC |
| Window state persistence | ✅ | `userData/window-state.json` |
| Single-instance lock | ✅ | `app.requestSingleInstanceLock()` |
| Process isolation (lock + ports) | ✅ | Per-test `.lock` files |
| API server (full) | ⚠️ | Fails: `node:sqlite` lacks `fts5` module needed by knowledge/dist |

## Why API fails

The bundled `@datafoundry/knowledge` package creates `CREATE VIRTUAL TABLE ... USING fts5(...)` on init. Electron 35's Node runtime exposes `node:sqlite` but **does not compile FTS5** into the binary. There's no documented Electron flag to enable FTS5.

Workarounds (not yet applied):

1. **Build a custom Node binary** with FTS5 enabled and bundle it with the app
2. **Patch `document-store.js`** to fall back to a non-FTS5 schema when `fts5` is unavailable
3. **Skip the API server** entirely — the Electron app loads packages directly via dynamic import (this is the path used)

We choose option 3 for v0.1.0. Users who need the full API server should run `npm run start:api` in a separate terminal.

## Verification (just performed)

```powershell
$ cmd /c "E:\FFD-Downloader-Windows\datafoundry-enhanced\.cache\electron35-final\electron.exe --version"
v35.0.0

$ cmd /c "set ELECTRON_RUN_AS_NODE=1 && ...\electron35-final\electron.exe ...\test-sqlite.mjs"
node:sqlite OK [ 'DatabaseSync', 'StatementSync', 'constants', 'default' ]
```

The Electron 35 binary in `.cache/electron35-final/` is portable and can be used by `apps/desktop/src/main.mjs` directly.

## Running the app

```powershell
# Use the cached Electron 35 (no npm install needed for the binary):
cd E:\FFD-Downloader-Windows\datafoundry-enhanced
.\.cache\electron35-final\electron.exe apps\desktop
```

The app loads `apps/desktop/src/index.html` directly (no API server needed for the CDL panel + status panel). The Workbench iframe will show "API unavailable" since the API server can't start without FTS5.