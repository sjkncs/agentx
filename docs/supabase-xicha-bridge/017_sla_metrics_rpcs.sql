-- ============================================================
-- 017_sla_metrics_rpcs.sql — A26.3 SLA + WO 统计 RPC
--
-- 依赖: 003_food_safety_schema.sql（fsf_work_orders 表已存在）
--       014_sla_escalation_rpcs.sql（fsf_inngest_events 表已存在）
-- ============================================================

set search_path = datafoundry, public, extensions;
begin;

-- ============================================================
-- 1. rpc_sla_summary
--
--   整体 SLA 统计：当前 open/investigating 工单的 SLA 健康状态
-- ============================================================
create or replace function datafoundry.rpc_sla_summary(
  p_workspace_id text default 'heytea-bj'
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_now    timestamptz := now();
  v_result jsonb;
begin
  with s as (
    select
      count(*)                                                 as total_open,
      count(*) filter (where sla_status = 'breached')          as breached,
      count(*) filter (where sla_status = 'warning')           as warning,
      count(*) filter (where sla_status = 'ok')                 as ok,
      count(*) filter (where sla_status is null)                as unknown,
      -- breached avg response time (min SLA start to breached_at)
      avg(extract(epoch from (sla_deadline - sla_start)) / 3600)
        filter (where sla_status = 'breached')                as avg_breached_hours,
      -- active warning count
      count(*) filter (where sla_status = 'warning'
        and sla_deadline is not null
        and sla_deadline > v_now)                              as warning_active,
      -- oldest open (most at-risk)
      min(sla_deadline) filter (where sla_status in ('breached', 'warning')) as oldest_deadline
    from datafoundry.fsf_work_orders
    where status in ('open', 'investigating', 'escalated')
  )
  select jsonb_build_object(
    'total_open',     s.total_open,
    'breached',       s.breached,
    'warning',        s.warning,
    'ok',             s.ok,
    'unknown',        s.unknown,
    'breach_rate',    case when s.total_open > 0
      then round((s.breached::numeric / s.total_open) * 100, 1)
      else 0 end,
    'warning_rate',   case when s.total_open > 0
      then round((s.warning::numeric / s.total_open) * 100, 1)
      else 0 end,
    'avg_breached_hours', round(s.avg_breached_hours, 1),
    'warning_active', s.warning_active,
    'oldest_deadline', s.oldest_deadline,
    'workspace_id',   p_workspace_id,
    'generated_at',   v_now
  ) into v_result
  from s;

  return coalesce(v_result, '{"total_open":0,"breached":0,"warning":0}'::jsonb);
end;
$$;

revoke all on function datafoundry.rpc_sla_summary(text) from public;
grant execute on function datafoundry.rpc_sla_summary(text) to authenticated, service_role;

-- ============================================================
-- 2. rpc_sla_stats (A26.3 — 多维 SLA 统计)
--
--   按 category × risk_level × status × stage 分桶
--   返回 open 工单的各维度分布 + 趋势数据
-- ============================================================
create or replace function datafoundry.rpc_sla_stats(
  p_days    int default 30,
  p_workspace_id text default 'heytea-bj'
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_result jsonb;
begin
  with stats as (
    select
      wo.category,
      wo.risk_level,
      wo.status,
      wo.stage,
      wo.sla_status,
      count(*)                                                      as wo_count,
      count(*) filter (where sla_status = 'breached')                as breached_count,
      count(*) filter (where sla_status = 'warning')                 as warning_count,
      -- 解决工单的平均处理时长
      avg(extract(epoch from (wo.resolved_at - wo.created_at)) / 3600)
        filter (where wo.status = 'resolved' and wo.resolved_at is not null)
        as avg_resolution_hours,
      -- 总金额（补偿）
      sum((wo.compensation_detail->>'amount')::numeric)
        filter (where wo.status in ('resolved', 'closed')
          and wo.compensation_detail->>'amount' is not null)
        as total_compensation_amount,
      avg((wo.compensation_detail->>'amount')::numeric)
        filter (where wo.status in ('resolved', 'closed')
          and wo.compensation_detail->>'amount' is not null)
        as avg_compensation_amount
    from datafoundry.fsf_work_orders wo
    where wo.created_at >= now() - (p_days || ' days')::interval
    group by cube (wo.category, wo.risk_level, wo.status, wo.stage, wo.sla_status)
    order by wo_count desc nulls last
  )
  select jsonb_agg(row_to_json(stats)) into v_result
  from stats
  where stats.category is not null;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

revoke all on function datafoundry.rpc_sla_stats(int, text) from public;
grant execute on function datafoundry.rpc_sla_stats(int, text) to authenticated, service_role;

-- ============================================================
-- 3. rpc_work_order_list_events (A26 — 确认存在并补充参数)
--
--   补充: p_limit 默认值, p_status 过滤
-- ============================================================
create or replace function datafoundry.rpc_work_order_list_events(
  p_work_order_id text,
  p_limit         int default 50,
  p_status        text default null
)
returns table (
  event_id    text,
  event_name  text,
  payload     jsonb,
  source      text,
  status      text,
  attempts    int,
  created_at  timestamptz
)
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
begin
  return query
  select
    e.event_id,
    e.event_name,
    e.payload,
    e.source,
    e.status,
    e.attempts,
    e.created_at
  from datafoundry.fsf_inngest_events e
  where e.payload->>'work_order_id' = p_work_order_id
    and (p_status is null or e.status = p_status)
  order by e.created_at desc
  limit p_limit;
end;
$$;

revoke all on function datafoundry.rpc_work_order_list_events(text, int, text) from public;
grant execute on function datafoundry.rpc_work_order_list_events(text, int, text)
  to authenticated, service_role;

-- ============================================================
-- 4. rpc_audit_event_list (A26.2 — 审计事件列表)
--
--   支持: category / actor_id / severity / date_range 过滤
-- ============================================================
create or replace function datafoundry.rpc_audit_event_list(
  p_workspace_id text default 'heytea-bj',
  p_category     text default null,
  p_actor_id      bigint default null,
  p_severity      text default null,
  p_days          int default 7,
  p_limit         int default 100
)
returns table (
  id          bigint,
  workspace_id text,
  actor_id    bigint,
  category    text,
  severity    text,
  action      text,
  target      text,
  payload     jsonb,
  created_at  timestamptz
)
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
begin
  return query
  select
    ae.id,
    ae.workspace_id,
    ae.actor_id,
    ae.category,
    ae.severity,
    ae.action,
    ae.target,
    ae.payload,
    ae.created_at
  from datafoundry.dfd_audit_events ae
  where ae.workspace_id = p_workspace_id
    and ae.created_at >= now() - (p_days || ' days')::interval
    and (p_category is null or ae.category = p_category)
    and (p_actor_id  is null or ae.actor_id  = p_actor_id)
    and (p_severity  is null or ae.severity  = p_severity)
  order by ae.created_at desc
  limit p_limit;
end;
$$;

revoke all on function datafoundry.rpc_audit_event_list(text, text, bigint, text, int, int) from public;
grant execute on function datafoundry.rpc_audit_event_list(text, text, bigint, text, int, int)
  to authenticated, service_role;

-- ============================================================
-- 5. rpc_audit_summary (A26.2 — 审计统计)
--
--   按 action 分组统计 + 各 severity 分布
-- ============================================================
create or replace function datafoundry.rpc_audit_summary(
  p_workspace_id text default 'heytea-bj',
  p_days         int  default 30
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_result jsonb;
begin
  with s as (
    select
      ae.action,
      ae.category,
      ae.severity,
      count(*)                                   as event_count,
      count(*) filter (where ae.actor_id is not null) as with_actor,
      min(ae.created_at)                        as first_seen,
      max(ae.created_at)                        as last_seen
    from datafoundry.dfd_audit_events ae
    where ae.workspace_id = p_workspace_id
      and ae.created_at >= now() - (p_days || ' days')::interval
    group by cube (ae.action, ae.category, ae.severity)
  )
  select jsonb_agg(row_to_json(s)) into v_result
  from s
  where s.action is not null
  order by s.event_count desc;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

revoke all on function datafoundry.rpc_audit_summary(text, int) from public;
grant execute on function datafoundry.rpc_audit_summary(text, int) to authenticated, service_role;

commit;
