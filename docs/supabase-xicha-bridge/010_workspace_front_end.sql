-- ============================================================
-- 010_workspace_front_end.sql
-- A12.2: workspace 动态下拉 + corp_dingtalk 订阅 channel
-- 依赖: 008
-- ============================================================

set search_path = datafoundry, public, extensions;
begin;

-- ============================================================
-- 1. RPC: rpc_workspace_list
--    返回全部 workspace 配置（id + name + region）
--    前端 admin-webhooks-panel 下拉用
-- ============================================================
create or replace function datafoundry.rpc_workspace_list()
returns table (
  workspace_id   text,
  name           text,
  region         text,
  team           text,
  sub_count      bigint
)
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
begin
  return query
    select
      a.target::text                                    as workspace_id,
      (a.payload->>'name')::text                         as name,
      (a.payload->>'region')::text                        as region,
      (a.payload->>'team')::text                         as team,
      count(s.id)::bigint                               as sub_count
    from datafoundry.dfd_audit_events a
    left join datafoundry.fsf_event_subscriptions s
      on s.workspace_id = a.target
    where a.category = 'workspace_config'
      and a.action    = 'workspace_seed'
    group by a.target, a.payload
    order by a.created_at desc;
end $$;

revoke all on function datafoundry.rpc_workspace_list() from public;
grant execute on function datafoundry.rpc_workspace_list() to service_role;

-- ============================================================
-- 2. corp_dingtalk channel 支持（workspace 路由）
--    subscribe_loop 的 bodyFor 和 dispatchOne 已支持 dingtalk webhook。
--    corp_dingtalk (A11 rpc_corp_dingtalk_send) 通过 RPC 调用，
--    不走 subscribe_loop HTTP dispatch。本步骤标记 channel
--    注册到 fsf_event_subscriptions target_channel 枚举。
-- ============================================================
-- ============================================================
-- 3. RPC: rpc_work_order_list_events
--    返回某工单关联的全部事件（从 fsf_inngest_events 按 work_order_id 过滤）
--    前端 admin-work-orders.tsx 事件时间线用
-- ============================================================
create or replace function datafoundry.rpc_work_order_list_events(
  p_work_order_id text,
  p_limit         int default 50
)
returns table (
  event_id    text,
  event_name  text,
  payload     jsonb,
  source      text,
  status      text,
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
      e.created_at
    from datafoundry.fsf_inngest_events e
    where e.payload->>'work_order_id' = p_work_order_id
       or e.event_id like '%' || p_work_order_id || '%'
    order by e.created_at desc
    limit p_limit;
end $$;

revoke all on function datafoundry.rpc_work_order_list_events(text, int) from public;
grant execute on function datafoundry.rpc_work_order_list_events(text, int) to service_role;

-- ============================================================
-- 4. RPC: rpc_work_order_update_status
--    更新工单 status（触发 AFTER UPDATE trigger → 自动 enqueue work_order.status_change 事件）
-- ============================================================
create or replace function datafoundry.rpc_work_order_update_status(
  p_case_no  text,
  p_status   text,
  p_stage    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
declare
  v_updated int;
begin
  update datafoundry.fsf_work_orders
  set status    = p_status,
      stage     = coalesce(p_stage, stage),
      updated_at = now()
  where case_no = p_case_no;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'error', 'work_order not found: ' || p_case_no);
  end if;

  return jsonb_build_object('ok', true, 'case_no', p_case_no, 'status', p_status);
end $$;

revoke all on function datafoundry.rpc_work_order_update_status(text,text,text) from public;
grant execute on function datafoundry.rpc_work_order_update_status(text,text,text) to service_role;