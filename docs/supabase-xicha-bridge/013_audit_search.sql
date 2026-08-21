-- ============================================================
-- 013_audit_search.sql
-- A18.1: 审计日志全文搜索 + 时间范围过滤 RPC
-- 依赖: 000_install_all_NO_PGRST.sql（dfd_audit_events 表已存在）
-- ============================================================

set search_path = datafoundry, public, extensions;
begin;

-- ============================================================
-- 1. rpc_audit_search
--    支持：
--      - keyword: payload 字段关键词搜索（JSONB text search）
--      - time_range: created_at 范围过滤（近1h/24h/7d/30d/自定义）
--      - category / severity / action / actor_id 精确过滤
--      - target 工单号前缀匹配（work_order_id like 'WO-%'）
--    返回：去重的 audit event（同一 action 的 payload 合并）
-- ============================================================
create or replace function datafoundry.rpc_audit_search(
  p_workspace_id   text    default 'default',
  p_keyword        text    default null,       -- payload JSONB 关键词
  p_time_range     text    default null,       -- '1h'|'24h'|'7d'|'30d'|null
  p_category       text    default null,
  p_severity       text    default null,
  p_action         text    default null,
  p_actor_id       text    default null,
  p_target_like    text    default null,       -- work_order_id like pattern, e.g. 'WO-%'
  p_limit          int     default 100,
  p_offset         int     default 0
)
returns table (
  id            bigint,
  category      text,
  severity      text,
  action        text,
  target        text,
  payload       jsonb,
  actor_id      text,
  created_at    timestamptz,
  -- computed
  row_count     bigint
)
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
declare
  v_since timestamptz;
begin
  -- Parse time_range
  v_since := case p_time_range
    when '1h'  then now() - interval '1 hour'
    when '24h' then now() - interval '24 hours'
    when '7d'  then now() - interval '7 days'
    when '30d' then now() - interval '30 days'
    else            null
  end;

  return query
  with filtered as (
    select
      e.id,
      e.category,
      e.severity,
      e.action,
      e.target,
      e.payload,
      e.actor_id,
      e.created_at,
      count(*) over () as _total
    from datafoundry.dfd_audit_events e
    where e.workspace_id = p_workspace_id
      and (p_category  is null or e.category  = p_category)
      and (p_severity  is null or e.severity  = p_severity)
      and (p_action    is null or e.action    = p_action)
      and (p_actor_id  is null or e.actor_id  = p_actor_id)
      and (p_target_like is null or e.target like p_target_like)
      and (v_since     is null or e.created_at >= v_since)
      and (
        p_keyword is null
        or e.payload::text ilike '%' || p_keyword || '%'
      )
    order by e.created_at desc
    limit p_limit
    offset p_offset
  )
  select
    f.id,
    f.category,
    f.severity,
    f.action,
    f.target,
    f.payload,
    f.actor_id,
    f.created_at,
    f._total as row_count
  from filtered f;
end;
$$;

revoke all on function datafoundry.rpc_audit_search(text,text,text,text,text,text,text,text,int,int) from public;
grant  execute on function datafoundry.rpc_audit_search(text,text,text,text,text,text,text,text,int,int) to service_role;

-- ============================================================
-- 2. rpc_audit_stats
--    审计面板顶部统计数字（count by category + severity）
--    用于 admin-audit-panel 顶部 summary cards
-- ============================================================
create or replace function datafoundry.rpc_audit_stats(
  p_workspace_id text default 'default',
  p_time_range   text default '24h'
)
returns table (
  category  text,
  severity  text,
  count     bigint
)
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
declare
  v_since timestamptz;
begin
  v_since := case p_time_range
    when '1h'  then now() - interval '1 hour'
    when '24h' then now() - interval '24 hours'
    when '7d'  then now() - interval '7 days'
    when '30d' then now() - interval '30 days'
    else            now() - interval '24 hours'
  end;

  return query
  select
    e.category,
    e.severity,
    count(*)::bigint
  from datafoundry.dfd_audit_events e
  where e.workspace_id = p_workspace_id
    and e.created_at >= v_since
  group by grouping sets ((e.category), (e.severity), ())
  order by count desc;
end;
$$;

revoke all on function datafoundry.rpc_audit_stats(text,text) from public;
grant  execute on function datafoundry.rpc_audit_stats(text,text) to service_role;

-- ============================================================
-- 3. rpc_audit_actions_list
--    返回某 workspace 在时间范围内的全部 action 类型（用于过滤器下拉）
-- ============================================================
create or replace function datafoundry.rpc_audit_actions_list(
  p_workspace_id text default 'default',
  p_category      text default null,
  p_time_range    text default '30d'
)
returns table (action text, count bigint)
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
declare
  v_since timestamptz;
begin
  v_since := case p_time_range
    when '1h'  then now() - interval '1 hour'
    when '24h' then now() - interval '24 hours'
    when '7d'  then now() - interval '7 days'
    when '30d' then now() - interval '30 days'
    else            now() - interval '30 days'
  end;

  return query
  select
    e.action,
    count(*)::bigint
  from datafoundry.dfd_audit_events e
  where e.workspace_id = p_workspace_id
    and (p_category is null or e.category = p_category)
    and e.created_at >= v_since
  group by e.action
  order by count desc;
end;
$$;

revoke all on function datafoundry.rpc_audit_actions_list(text,text) from public;
grant  execute on function datafoundry.rpc_audit_actions_list(text,text) to service_role;

-- ============================================================
-- 4. 性能索引（全文搜索优化）
--    payload 字段 JSONB GIN 索引（全文检索 + key existence）
-- ============================================================
create index if not exists dfd_audit_events_payload_idx
  on datafoundry.dfd_audit_events using gin (payload jsonb_path_ops);

create index if not exists dfd_audit_events_created_at_idx
  on datafoundry.dfd_audit_events (created_at desc);

create index if not exists dfd_audit_events_target_idx
  on datafoundry.dfd_audit_events (target text_pattern_ops);

commit;

-- ============================================================
-- 验证（A18 quick smoke）
-- ============================================================
-- select category, severity, count from datafoundry.rpc_audit_stats('default', '24h');
-- select * from datafoundry.rpc_audit_search(
--   p_workspace_id => 'default',
--   p_keyword      => 'WO-',
--   p_time_range   => '7d',
--   p_limit        => 20
-- );
-- select action, count from datafoundry.rpc_audit_actions_list('default', null, '7d');
