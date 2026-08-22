# A31 — Run Persistence Wiring (Eval / HITL / Memory Bank)

## Scope

Three app/api sinks that bridge every agent-runtime event to a Supabase table, so that the operator panel and the analytics pipeline see real data instead of empty result sets.

| Slogan | Mechanic | Target table |
|---|---|---|
| **A31.1** Eval Pipeline | `token_usage` CUSTOM event → per-step row; `RUN_FINISHED` → `dfd_runs.token_input/output` aggregate | `dfd_token_usage`, `dfd_runs` |
| **A31.2** HITL Approval | `interaction.requested` → upsert pending; `interaction.resolved` / admin resolve → patch status | `dfd_approvals` |
| **A31.3** Memory Bank | `TEXT_MESSAGE_CONTENT` buffer → `TEXT_MESSAGE_END` → typed row | `dfd_messages` |

All three register on the existing `event-bus` next to `supabase-event-log`, `supabase-run`, and `human-approval`. They are no-ops when Supabase is not configured.

## Files

- **Migration**: `012_run_persistence_schema.sql` — adds `dfd_messages`, `dfd_token_usage`, RLS + realtime publication. `dfd_approvals` was already in `000_install_all_NO_PGRST.sql`.
- **Verify**: `013_verify_run_persistence.sql` — checks tables + RLS + realtime membership.
- **Sinks**: `apps/api/src/run-persistence-sinks.ts` — three `registerSink` callbacks, idempotent event-type dispatch.
- **Mirror write**: `apps/api/src/human-approval-queue.ts` — `resolveApproval` now also patches `dfd_approvals` so admin-UI resolutions stay in sync.
- **Wiring**: `apps/api/src/server.ts` — `registerRunPersistenceSinks()` after the existing `registerSupabaseSinks(metadataStore)`.

## Failure semantics

- All Supabase writes are `void`'d — they never block the event loop and never crash the run.
- Hitl-approval has a 60 s dedupe window for `RUN_FINISHED` so duplicate delivery (HTTP retries) doesn't double-write token counts.
- Memory-bank keeps an in-memory `Map<sessionId:messageId, MessageDraft>` keyed on the AG-UI message id; a restart drops the buffer but does not lose already-flushed rows.
- Eval-pipeline keeps an in-memory `Map<runId, RunTokenAggregate>` for accumulation; same dedupe window as above.

## What the operator can now do

- See a row in `dfd_approvals` for every agent pause (no more silent in-memory queue).
- Get accurate token totals in `dfd_runs` and per-step audit rows in `dfd_token_usage`.
- Pull every user/assistant message of a session from `dfd_messages` for cross-session retrieval or replay.

## Smoke

```bash
# After npm run build at repo root (fresh dist/):
psql "$SUPABASE_DB_URL" -f docs/supabase-xicha-bridge/012_run_persistence_schema.sql
psql "$SUPABASE_DB_URL" -f docs/supabase-xicha-bridge/013_verify_run_persistence.sql
```

Both SQL files are idempotent (`CREATE TABLE IF NOT EXISTS` + `DROP POLICY IF EXISTS`).

## Machine gates

- `npx tsc -p tsconfig.build.json` (root)  →  exit 0
- `npx vitest run` in `apps/api`  →  179 passed, 1 pre-existing failure (`supabase.test.ts` requires unset env vars; env vars are inherited from the dev shell and the failure is unrelated to A31).
