-- ============================================================
-- DataFoundry Run Persistence — Eval / HITL / Memory Bank
--   * dfd_messages     — typed conversation rows (cross-session retrieval)
--   * dfd_token_usage  — per-step token-usage events (eval pipeline)
--   * dfd_approvals    already exists (003/000 schema) — we wire to it in code only
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. dfd_messages — typed conversation rows
--    Distinct from dfd_session_events (which stores ALL AG-UI event types
--    verbatim). dfd_messages is the slim shape that the cross-session
--    memory bank uses for retrieval and replay — only user/assistant/system.
--    One row per finalized message (append-only, immutable).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS datafoundry.dfd_messages (
  id              BIGSERIAL PRIMARY KEY,
  session_id      TEXT    NOT NULL REFERENCES datafoundry.dfd_sessions(id) ON DELETE CASCADE,
  run_id          TEXT    REFERENCES datafoundry.dfd_runs(id)       ON DELETE SET NULL,
  user_id         TEXT    REFERENCES datafoundry.dfd_users(id)      ON DELETE SET NULL,
  role            TEXT    NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content         TEXT    NOT NULL,
  content_type    TEXT    NOT NULL DEFAULT 'text' CHECK (content_type IN ('text', 'tool_call', 'tool_result')),
  tool_call_id    TEXT,
  tool_name       TEXT,
  parent_message_id BIGINT REFERENCES datafoundry.dfd_messages(id) ON DELETE SET NULL,
  finished_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE datafoundry.dfd_messages IS
  'Typed conversation message rows (cross-session memory bank). Distinct from dfd_session_events which stores ALL AG-UI event types.';
COMMENT ON COLUMN datafoundry.dfd_messages.content_type IS
  'text | tool_call (assistant issued) | tool_result (tool role returned)';

CREATE INDEX IF NOT EXISTS dfd_messages_session_idx
  ON datafoundry.dfd_messages (session_id, finished_at);
CREATE INDEX IF NOT EXISTS dfd_messages_user_idx
  ON datafoundry.dfd_messages (user_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS dfd_messages_role_idx
  ON datafoundry.dfd_messages (session_id, role);
CREATE INDEX IF NOT EXISTS dfd_messages_run_idx
  ON datafoundry.dfd_messages (run_id);

-- ─────────────────────────────────────────────────────────────
-- 2. dfd_token_usage — per-step token events for the eval pipeline
--    Fine-grained input from createMastraStreamNormalizerHooks (one row per step-finish).
--    The aggregate (run-level in/out) is already stored in dfd_runs.token_input/output;
--    this table is the row-level audit trail used by the eval pipeline.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS datafoundry.dfd_token_usage (
  id              BIGSERIAL PRIMARY KEY,
  run_id          TEXT    NOT NULL REFERENCES datafoundry.dfd_runs(id)       ON DELETE CASCADE,
  session_id      TEXT    NOT NULL REFERENCES datafoundry.dfd_sessions(id)  ON DELETE CASCADE,
  user_id         TEXT    REFERENCES datafoundry.dfd_users(id)              ON DELETE SET NULL,
  step_number     INTEGER NOT NULL,
  model           TEXT,
  tool_call_id    TEXT,
  tool_name       TEXT,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  total_tokens    INTEGER,
  finished_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE datafoundry.dfd_token_usage IS
  'Per-step token usage events emitted by mastraStreamNormalizer. Aggregate lives in dfd_runs.token_input/output.';

CREATE INDEX IF NOT EXISTS dfd_token_usage_run_idx
  ON datafoundry.dfd_token_usage (run_id, step_number);
CREATE INDEX IF NOT EXISTS dfd_token_usage_session_idx
  ON datafoundry.dfd_token_usage (session_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS dfd_token_usage_model_idx
  ON datafoundry.dfd_token_usage (model);

-- ─────────────────────────────────────────────────────────────
-- 3. RLS + service_role bypass
-- ─────────────────────────────────────────────────────────────
ALTER TABLE datafoundry.dfd_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE datafoundry.dfd_token_usage ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['dfd_messages', 'dfd_token_usage'])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS service_role_all ON datafoundry.%I', t);
    EXECUTE format($f$
      CREATE POLICY service_role_all ON datafoundry.%I
      FOR ALL TO service_role USING (true) WITH CHECK (true)
    $f$, t);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 4. Realtime publication for operator panel
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE datafoundry.dfd_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE datafoundry.dfd_token_usage;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
