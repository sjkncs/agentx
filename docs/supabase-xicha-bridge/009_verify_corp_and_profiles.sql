-- ============================================================
-- 009_verify_corp_and_profiles.sql
-- A11 验收：钉钉 corp API + docker-compose subscriber profile
-- ============================================================

set search_path = datafoundry, public, extensions;

-- 1. corp_dingtalk 函数存在
select '1) corp functions exist' as step,
  count(*) as fn_count
from information_schema.routines
where routine_schema = 'datafoundry'
  and routine_name in ('rpc_dingtalk_app_token','rpc_corp_dingtalk_send');

-- 2. docker-compose.yml 存在且有 subscriber profile
select '2) docker-compose' as step,
  count(*) as svc_count
from pg_read_file('services/docker-compose.yml') as f,
     regexp_matches(f, 'profiles:.*subscriber', 'g') as m
having count(*) > 0;

-- 3. subscriber 服务数（应为 2: subscriber-default + subscriber-bj）
select '3) subscriber services' as step,
  count(*) as sub_count
from pg_read_file('services/docker-compose.yml') as f,
     regexp_matches(f, 'container_name: df-subscriber-', 'g') as m
having count(*) >= 2;

-- 4. 新 env 都出现在 inngest-bridge service
select '4) new envs in service' as step,
  count(*) as env_count
from pg_read_file('services/docker-compose.yml') as f
where f ~ 'DINGTALK_ROBOT_SECRET'
  and f ~ 'INNGEST_SIGNING_KEY';

-- 5. http helpers exist
select '5) http helpers' as step,
  count(*) as fn_count
from information_schema.routines
where routine_schema = 'datafoundry'
  and routine_name in ('http_get_jsonb','http_post_jsonb');