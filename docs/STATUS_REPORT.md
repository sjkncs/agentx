# AgentX Enhanced — Status Report

**Generated:** 2026-08-09
**Location:** `E:\FFD-Downloader-Windows\agentx-enhanced\`
**Source:** Forked from [datagallery-lab/datafoundry](https://github.com/datagallery-lab/datafoundry) v0.2.0 (Apache-2.0)
**linux.do reference:** Topic #2526680 (community discussion)
**Clone size:** 1,583 npm packages installed
**Build:** ✅ TypeScript compile clean (tsc -b tsconfig.build.json)

---

## What's new (vs upstream)

| Path | Purpose |
|------|---------|
| `packages/counterfactual/` | **CDL (Counterfactual Diagnosis Layer)** — new package with 4 modules |
| `packages/counterfactual/src/semantic-layer.mjs` | TransE-style KG embedding (8 entities × 6 relations, configurable dim) |
| `packages/counterfactual/src/causal-dag.mjs` | NOTEARS-style acyclicity-constrained DAG learner |
| `packages/counterfactual/src/counterfactual-engine.mjs` | ATE(X→Y) estimator with weighted regression + gradient penalty |
| `packages/counterfactual/src/regime-joint.mjs` | $J(u) = \alpha \Phi_{\text{sem}} + (1-\alpha) \Phi_{\text{cf}}$ regime-conditional decision |
| `packages/counterfactual/src/index.mjs` | Public API |
| `packages/counterfactual/test/connectivity.test.mjs` | Pipeline connectivity test (4 components interoperate) |
| `packages/counterfactual/test/async.test.mjs` | Concurrency, race conditions, 1000-iteration purity tests |
| `scripts/port-allocator.mjs` | Reusable free-port allocator (excludes 3000/8787/8000, scans 14000–14999) |
| `scripts/process-lock.mjs` | Per-test `.lock` file management with stale-lock detection |
| `scripts/dev-isolated.mjs` | Process-isolated launcher (locks + ports + cleanup + SIGTERM grace) |
| `scripts/test-full-stack-async.mjs` | Full-stack async harness for 60+ smoke tests |
| `docs/ENHANCED_README.md` | Full design doc |

## Test results

### CDL package (local new)

```
$ node packages/counterfactual/test/connectivity.test.mjs
ok 1 - CDL connectivity — full pipeline produces a decision
# pass 1, fail 0  ✓

$ node packages/counterfactual/test/async.test.mjs
ok 1 - CDL async — semantic-layer trains in concurrent loops
ok 2 - CDL async — causal DAG + CF engine run concurrently without race
ok 3 - CDL async — joint decision is synchronous and pure
ok 4 - CDL async — concurrent allocation of many engines
# pass 4, fail 0  ✓
```

### AgentX full stack (43 tests, isolated)

```
$ node scripts/test-full-stack-async.mjs --skip-build --timeout=30000

Total: 43, Pass: 21, Fail: 22, Skip: 0
Total elapsed: 205,319 ms (~3.4 min)
```

**21 PASS** (offline / unit-level): sql-readonly, data-gateway, files, skills, server-datasources, config-api, doc-links, agui-stream, datalink-semantic, conversation-memory-shim, run-config-disabled/mcp-degraded, smoke-skills, smoke-metadata, smoke-files, smoke-auth, smoke-sql-readonly, smoke-collaboration-tools, smoke-server-datasources-e2e, smoke-agui-stream, smoke-doc-links, stack-runtime-config.test.

**22 FAIL** (all require LLM API key or Windows-specific file locking): every failure traces to either `OPENAI_API_KEY` not set OR Windows `EBUSY` on SQLite cleanup, **none are process-isolation or port-collision issues**.

## Process-isolation mechanism

| Concern | Solution | Verified |
|---------|----------|----------|
| Port collision with existing 5 node processes | Allocator excludes 3000/8787/8000 and searches 14000–14999 | ✅ |
| Concurrent test runs | Per-test `.lock` file in `.run/` with PID + ports | ✅ |
| Stale locks after crash | `process.kill(pid, 0)` check; overwrite if PID dead | ✅ |
| Process leak after timeout | 30s timeout → SIGTERM → 5s grace → SIGKILL | ✅ |
| Stdout/stderr capture | Per-test `stdout.log` + `stderr.log` in `.run/<name>/` | ✅ |
| Summary aggregation | `summary.json` with per-test result + elapsed time | ✅ |
| Host process kill propagation | Launcher forwards SIGINT/SIGTERM to child | ✅ |

## Quick start

```powershell
cd e:\FFD-Downloader-Windows\agentx-enhanced

# Run CDL tests
node packages\counterfactual\test\connectivity.test.mjs
node packages\counterfactual\test\async.test.mjs

# Run any AgentX script in isolation
node scripts\dev-isolated.mjs -- node scripts\async-memo.test.mjs
node scripts\dev-isolated.mjs -- npm run smoke:sql

# Run full-stack async test harness
node scripts\test-full-stack-async.mjs --skip-build --timeout=30000

# Clean
Remove-Item .run -Recurse -Force
```

## Reproducibility

- Node: v22.21.0 (with `--engine-strict=false` to allow posthog-node 5.38.5)
- npm: 11.6.0
- OS: Windows 10 build 22631, PowerShell 7
- Dependencies: 1,583 packages installed via `npm install --prefer-offline`
- Build: tsc -b tsconfig.build.json → clean

## Source-of-truth references

- Paper §5.5 "Counterfactual Interpretation of Theorem 3" — `E:\FFD-Downloader-Windows\_workspace\icaif2026\paper_icaif2026.tex` line 528+
- CDL design doc — `E:\FFD-Downloader-Windows\_workspace\COUNTERFACTUAL_DIAGNOSIS_EXTENSION.md`
- Ying et al. 2025 (preprint) — DOI 10.20944/preprints202512.2718.v1
- DataFoundry GitHub — https://github.com/datagallery-lab/datafoundry
- AgentX README — see `README.md` in this repo (18.4 KB)