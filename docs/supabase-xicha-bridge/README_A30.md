# A30 — Skill Marketplace Full Persistence + Dev-Server Verified

> Vertical: bridge the gap between "skill catalog exists" and "the bytes actually land in the data plane". Catalog entries now resolve to real GitHub repos (curl-verified), `/install` writes to `file_assets` + `config_resources` + `dfd_audit_events` + `fsf_messages`, a periodic worker keeps the catalog fresh, the dev server renders `/admin/skill-marketplace` cleanly, and HITL / Eval panels are wired through their existing `configApi` clients.

## TL;DR

| Area | Before A30 | After A30 |
|---|---|---|
| `packages/skills/builtin/skill-catalog.json` | 8 placeholder repos that 404 on GitHub (`anthropics/ppt-master`, `anthropics/impeccable`, `anthropics/aris`, …) | 8 verified repos that 200 on raw.githubusercontent.com, from the [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) curated list + `AutumnsGrove/ClaudeSkills` + `obra/superpowers` + `sanjay3290/ai-skills` |
| `POST /api/v1/skill-marketplace/install` | Returned parsed metadata only | **Persists** SKILL.md bytes via `fileAssetService.createRef(source="skill-package")` → `configResources.upsert(kind="skill", status="ready")` → writes `dfd_audit_events(category="skill-marketplace", action="install")` + `fsf_messages(intent="skill_marketplace", sub_intent="install")` |
| Catalog drift | None — install only validated against disk-cached JSON | New `skill-sync.ts` worker re-fetches every catalog entry on a 6h interval (sha256-diff'd), writes a snapshot per change + audit row + fsf message. Manual `POST /api/v1/skill-marketplace/sync` for ops |
| `/admin/skill-marketplace` UI | "Parsed (nB) — staged for next run" with no persistence indicator | Real `Installed` / `Sync` / `Uninstall` buttons per card, summary tiles, Supabase status returned to client |
| HITL / Eval panels | TS compile errors (used `as Record<string, unknown>` hacks for `configApi.getAdminApprovals` / `getAdminEval`) | Direct typed calls to `configApi.getAdminApprovals()` / `resolveApproval({id, selected_option})` / `getAdminEval()` — typecheck clean for those files |
| Dev-server verification | "next build interrupted by webpack errors" | `next dev --turbopack` boots in 4.4s, `GET /admin/skill-marketplace` returns HTTP 200, 21KB HTML with `<h1>Skill Marketplace</h1>` rendered |

## Catalog selection (real GitHub repos)

Selected from a verified probe of 20+ candidate repos using `curl -I https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>/SKILL.md`. Each row was 200-verified at selection time:

| Slot | Catalog id | Real repo | Path |
|---|---|---|---|
| documents | `slide-kit` | `PHY041/claude-skill-slide-kit` | `SKILL.md@main` |
| science | `anydesign` | `uxKero/anydesign` | `SKILL.md@main` |
| design | `swiftui-design` | `wholiver/swiftui-design-skill` | `SKILL.md@main` |
| engineering | `tdd` | `obra/superpowers` | `skills/test-driven-development/SKILL.md@main` |
| writing | `brainstorming` | `obra/superpowers` | `skills/brainstorming/SKILL.md@main` |
| automation | `mcp-builder` | `anthropics/skills` | `skills/mcp-builder/SKILL.md@main` |
| research | `deep-research` | `sanjay3290/ai-skills` | `skills/deep-research/SKILL.md@main` |
| creative | `d3js-vis` | `chrisvoncsefalvay/claude-d3js-skill` | `SKILL.md@main` |
| vertical (built-in) | `food-safety` | `sjkncs/heytea-food-safety-agent` | `README.md@master` |

The previously-listed repos (`anthropics/ppt-master`, `anthropics/impeccable`, `anthropics/aris`, `anthropics/scroll-world`, `anthropics/page-agent`, `anthropics/hallmark`, `anthropics/taste-skill`, `anthropics/scientific-illustrator`) all 404'd on raw.githubusercontent.com at probe time — they were aspirational placeholder names. Replaced with entries the marketplace can actually fetch.

## Install path — full persistence

The endpoint previously returned `parsed` metadata only. After A30 it writes to four tables:

1. **`file_assets` + `file_asset_refs`** — `LocalFileAssetService.createRef({ source: "skill-package", metadata: { catalog_id, repo, ref, skill_path, parsed_name, parsed_version } })`. Content-addressed by sha256, so re-installs of the same bytes are a no-op.
2. **`config_resources`** — `metadataStore.configResources.upsert({ kind: "skill", status: "ready", builtin: false })` with payload built by the same `buildSkillResourcePayload(...)` used by the multipart upload path. `revision` bumps on every sync.
3. **`dfd_audit_events`** — `client.insert("dfd_audit_events", { workspace_id, actor_id, category: "skill-marketplace", severity: "info", action: "install" | "sync" | "uninstall", target: <catalog_id>, payload: { … } })`.
4. **`fsf_messages`** — `client.insert("fsf_messages", { conversation_id: "marketplace", role: "system", content: "skill-marketplace:install:<id>@<repo>#<ref>", intent: "skill_marketplace", sub_intent: "install", risk_level: "low", audit_status: "pass", metadata: { … } })` — visible to the same Inngest/RPC pipeline that consumes the xicha food-safety queue.

Both Supabase writes are fire-and-best-effort: if `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` are missing they return `{ status: 0, error: null }` and the install still succeeds locally — local metadata is the source of truth.

## New endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/v1/skill-marketplace/catalog` | Curated catalog (unchanged) |
| `POST` | `/api/v1/skill-marketplace/install` | Fetch SKILL.md, persist everywhere, emit audit |
| `POST` | `/api/v1/skill-marketplace/sync` | Re-fetch + upsert (revision bump + audit + fsf) |
| `GET`  | `/api/v1/skill-marketplace/installed` | List current user's installed skills (kind=skill) |
| `POST` | `/api/v1/skill-marketplace/uninstall` | Drop config resource + soft-delete file ref + audit |

The endpoint map was hard-coded to two paths before; the server now routes any of these five into `handleSkillMarketplaceRequest` and the handler returns 405 on wrong methods.

## Background sync — `apps/api/src/skill-sync.ts`

- Bootstraps once on `startSkillSyncWorker()` (registered from `server.ts`).
- Re-fetches every catalog entry, sha256-diffs against `storage/skill-sync/state.json`.
- On change: writes `storage/skill-sync/<id>/<sha>.SKILL.md` snapshot + `dfd_audit_events(action="sync")` + `fsf_messages(intent="skill_marketplace", sub_intent="sync")`.
- On error (dead repo, 404, timeout): records the error in state so operators can spot drift; bumps `fetchedAt` either way.
- 6-hour interval, `setInterval` with `.unref()` so it doesn't block shutdown.
- Exports `runSkillSyncOnce()` for tests and ad-hoc CLI invocation.

## Verification

### 1. Unit tests — `apps/api/src/routes/skill-marketplace.test.ts`

```
RUN  v3.2.6 ... /skill-marketplace.test.ts (6 tests) 458ms
 ✓ skill-marketplace /install (A30) > rejects unknown catalog ids
 ✓ skill-marketplace /install (A30) > persists SKILL.md bytes to fileAsset + configResource and writes Supabase audit/fsf when enabled
 ✓ skill-marketplace /install (A30) > does not fail when Supabase is offline (degraded mode)
 ✓ skill-marketplace /install (A30) > bumps revision on /sync
 ✓ skill-marketplace /install (A30) > GET /installed lists installed skills
 ✓ skill-marketplace /install (A30) > uninstall removes config resource and soft-deletes file ref

 Test Files  1 passed (1)
      Tests  6 passed (6)
```

### 2. Real-GitHub smoke (manual)

```powershell
cd datafoundry-enhanced
# 1. Start API (port 8797 per .env.local)
npx tsx apps/api/src/server.ts &

# 2. Drive one install through the new endpoint
curl -s -X POST http://127.0.0.1:8797/api/v1/skill-marketplace/install \
     -H 'Content-Type: application/json' \
     -d '{"id":"tdd"}' | jq .

# 3. Confirm it landed in the local DB
sqlite3 storage/metadata/workbench.sqlite \
  "SELECT id, kind, status, revision, builtin FROM config_resources WHERE kind='skill';"

# 4. Verify the bytes are content-addressed in file_assets
ls storage/files/*/* | head
```

### 3. Dev server

```powershell
cd apps/web
npx next dev --port 3021 --turbopack
# 4.4s ready
curl -s http://localhost:3021/admin/skill-marketplace | head -c 800
# HTTP 200; renders <h1>Skill Marketplace</h1>, summary tiles, catalog list
```

## Type-check / build gates

- `npx tsc -p apps/api/tsconfig.json --noEmit` → exit 0
- `npx vitest run apps/api/src/routes/skill-marketplace.test.ts` → 6/6 green
- `npx tsc -p apps/web/tsconfig.json --noEmit` → still has pre-existing errors in `admin-work-orders.tsx` / `admin-metrics-panel.tsx` / `admin-wo-stage-dialog.tsx` / `workorders/[case_no]/page.tsx` / several `data-tasks/__tests__` files that are unrelated to A30. The two files A30 touched (`admin-approvals-panel.tsx`, `admin-eval-panel.tsx`) and the marketplace page are clean.

## What's NOT in A30

- The pre-existing `admin-work-orders.tsx` / `admin-metrics-panel.tsx` / `admin-wo-stage-dialog.tsx` type errors (out of scope; surgically isolated by file)
- `workorders/[case_no]/page.tsx` references `../../../supabase-rpc` which was never wired (pre-existing TODO)
- Several `data-tasks/__tests__/*` test files have unused `@ts-expect-error` directives and vitest type drift (pre-existing)
- HITL `/admin/approvals` page rendering against the live approval queue — the panel is wired to `configApi.getAdminApprovals()` but a real Supabase connection + existing approval rows are needed to see non-empty data
- Eval snapshot generator — the `AdminEvalPanel` reads `configApi.getAdminEval()`, the backend has not yet been wired to actually compute the `p50/p95/p99/automation_rate` snapshot

## File-level diff summary

```
modified  packages/skills/builtin/skill-catalog.json        (8 catalog rows: placeholders → verified repos)
modified  apps/api/src/routes/skill-marketplace.ts          (install path now writes fileAsset + configResource + supabase; +sync /installed /uninstall routes)
modified  apps/api/src/server.ts                            (5-path route map; startSkillSyncWorker(); ConfigApiContext injection)
modified  apps/web/src/app/admin/skill-marketplace/page.tsx (typed install/sync/uninstall UI; summary tiles; Supabase status)
modified  apps/web/src/app/admin/admin-approvals-panel.tsx  (direct configApi.getAdminApprovals/resolveApproval; fixes TS errors)
modified  apps/web/src/app/admin/admin-eval-panel.tsx       (direct configApi.getAdminEval; fixes TS errors)
added     apps/api/src/skill-sync.ts                        (catalog drift detector; 6h interval; manual runSkillSyncOnce())
added     apps/api/src/routes/skill-marketplace.test.ts     (6 vitest cases: parse→persist→audit→sync→installed→uninstall)
added     apps/api/src/skill-marketplace.smoke.mjs          (real-GitHub end-to-end smoke against all catalog entries)
```
