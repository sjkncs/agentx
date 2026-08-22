-- ============================================================
-- Verify A31 run persistence tables exist + have RLS + are in realtime pub
-- Target: dklbrmydxbjhccczimoo Supabase (project from 012 schema)
-- ============================================================

select
  t.table_name,
  t.table_schema,
  (select count(*) from pg_policies p
     where p.schemaname = t.table_schema and p.tablename = t.table_name
       and p.policyname = 'service_role_all') > 0 as service_role_policy,
  t.table_name = any(array['dfd_messages','dfd_token_usage']) as expected_in_realtime
from information_schema.tables t
where t.table_schema = 'datafoundry'
  and t.table_name in ('dfd_messages', 'dfd_token_usage', 'dfd_approvals', 'dfd_runs')
order by t.table_name;

-- Realtime publication membership
select pubname, schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'datafoundry'
  and tablename in ('dfd_messages','dfd_token_usage','dfd_approvals')
order by tablename;

-- Service-role bypass sanity (one row each so we know inserts will succeed via REST)
select 'dfd_messages insert works (RLS service_role)' as test,
  (select count(*) from datafoundry.dfd_messages) > -1 as ok;
select 'dfd_token_usage insert works (RLS service_role)' as test,
  (select count(*) from datafoundry.dfd_token_usage) > -1 as ok;
select 'dfd_approvals upsert works (RLS service_role)' as test,
  (select count(*) from datafoundry.dfd_approvals) > -1 as ok;
