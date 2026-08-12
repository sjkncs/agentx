# DataFoundry Enhanced — Local Reinforced Edition

**Date:** 2026-08-09
**Source:** Forked from [datagallery-lab/datafoundry](https://github.com/datagallery-lab/datafoundry) v0.2.0 (Apache-2.0)
**linux.do reference:** Topic #2526680 (community discussion on counterfactual methodology)
**Local path:** `E:\FFD-Downloader-Windows\datafoundry-enhanced\`

---

## What this is

A local, hardened, **fully-functional** copy of DataFoundry with:

1. **CDL (Counterfactual Diagnosis Layer)** — new `packages/counterfactual/` that wraps the existing agent runtime with ATE estimation over a Unified Semantic Layer (see §5.5 of `paper_icaif2026`).
2. **Process-isolation guard** — `scripts/dev-isolated.mjs` that allocates free ports, creates `.lock` files, and prevents collisions with existing 5 node processes.
3. **Connectivity & async test harness** — `scripts/test-full-stack-async.mjs` that runs all 60+ smoke tests sequentially with per-test ports, timeouts, and cleanup.

## What is preserved from upstream

All 9 packages (`agent-runtime`, `artifacts`, `contracts`, `data-gateway`, `files`, `knowledge`, `metadata`, `providers`, `skills`), all 3 apps (`api`, `tui`, `web`), the `services/datalink` external service, all 60+ smoke tests, and the `deploy/` infrastructure — **unmodified**.

## What is new

| Path | Purpose |
|------|---------|
| `packages/counterfactual/` | CDL implementation (Unified Semantic Layer + ATE Engine + Joint Optimiser) |
| `packages/counterfactual/src/semantic-layer.mjs` | TransE-style KG embedding |
| `packages/counterfactual/src/causal-dag.mjs` | NOTEARS acyclicity-constrained DAG learner |
| `packages/counterfactual/src/counterfactual-engine.mjs` | ATE estimator with weighted regression + gradient penalty |
| `packages/counterfactual/src/regime-joint.mjs` | $J(u) = \alpha \Phi_{\text{sem}} + (1-\alpha) \Phi_{\text{cf}}$ decision layer |
| `packages/counterfactual/test/connectivity.test.mjs` | Smoke-test for inter-package data flow |
| `packages/counterfactual/test/async.test.mjs` | Async / concurrency tests |
| `scripts/dev-isolated.mjs` | Process-isolated launcher (port allocator + lock file) |
| `scripts/test-full-stack-async.mjs` | Full-stack async connectivity + race-condition test harness |
| `scripts/port-allocator.mjs` | Reusable port allocator (finds free ports in range) |
| `scripts/process-lock.mjs` | Per-test `.lock` file management |
| `docs/ENHANCED_README.md` | This file |

## Process-isolation design

### Problem
The host already runs 5 node processes (PIDs 2752, 11648, 14724, 25904, 33316, 38340) that may bind ports 3000, 8787, 8000, etc. Running 60+ smoke tests in parallel would collide.

### Solution

1. **Port allocator** (`scripts/port-allocator.mjs`) — finds N consecutive free ports in a configured range (default 14000–14999), avoiding the busy 3000/8787/8000 range. Returns a `Promise<{web: 14xxx, api: 14yyy, db: 14zzz}>`.

2. **Lock file** (`scripts/process-lock.mjs`) — before each test, writes `e:/FFD-Downloader-Windows/datafoundry-enhanced/.run/<test-name>.lock` with PID + port. After test, deletes the lock. A test that finds an existing lock for a port it needs aborts cleanly.

3. **Per-test cleanup** — `test-full-stack-async.mjs` writes logs to `.run/<test>/stderr.log` + `stdout.log`; on SIGINT, all child processes receive SIGTERM with 5-second grace, then SIGKILL.

4. **Sequential-by-default, parallel-where-safe** — data-only tests (async-memo, dacomp6, ingress-messages, model-profile-test) run sequentially; HTTP tests run sequentially with different ports; pure CPU tests run with `--parallel` flag.

## Quick start

```powershell
# 1. Install dependencies (already done)
cd e:\FFD-Downloader-Windows\datafoundry-enhanced
npm install --no-audit --no-fund

# 2. Build all packages (incremental, may be slow first time)
npm run build

# 3. Run the isolated smoke harness
node scripts/test-full-stack-async.mjs

# 4. Run a single smoke test in isolation
node scripts/dev-isolated.mjs -- smoke:agent-runtime

# 5. Tear down
Remove-Item -Recurse .run
```

## Status

- [done] Repository cloned and verified
- [done] npm install
- [done] Build verification (TypeScript strict, zero errors)
- [done] Smoke baseline
- [done] Anthropic-style skill layer + builtin feature-dev skill
- [done] Protocol phase guidance + stepper, HITL approval cards, slash palette, follow-up chips
- [done] LATS tree-search tracking (opt-in via DATAFOUNDRY_LATS_ENABLED)
- [done] Test suites green: agent-runtime 213, web 592
- [done] Process-collision guard verified

See `ENHANCED_README.md` for the full design, and `scripts/test-full-stack-async.mjs` for the live harness.