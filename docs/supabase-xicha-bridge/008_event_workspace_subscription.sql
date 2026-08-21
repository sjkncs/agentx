-- ============================================================
-- 008_event_workspace_subscription.sql
-- A10: 跨 workspace + WO 状态变 → 事件入队
-- 依赖: 000 + 003 + 004 + 005 + 006 + 007
-- ============================================================

set search_path = datafoundry, public, extensions;
begin;

-- ============================================================
-- 1. workspace seed 数据（demo 3 个 workspace）
-- ============================================================
insert into datafoundry.dfd_audit_events
  (workspace_id, actor_id, category, severity, action, target, payload)
values
  ('heytea-bj', null, 'workspace_config', 'info', 'workspace_seed', 'heytea-bj',
   '{"name":"北京门店","region":"华北","team":"食安应急"}'::jsonb),
  ('heytea-sh', null, 'workspace_config', 'info', 'workspace_seed', 'heytea-sh',
   '{"name":"上海门店","region":"华东","team":"品控小组"}'::jsonb),
  ('heytea-sz', null, 'workspace_config', 'info', 'workspace_seed', 'heytea-sz',
   '{"name":"深圳总部","region":"华南","team":"总部食安"}'::jsonb)
on conflict do nothing;

-- seed workspace 订阅
insert into datafoundry.fsf_event_subscriptions
  (workspace_id, subscription_name, event_name, target_channel, target_id, filter_json, cooldown_seconds)
values
  ('heytea-bj', 'bj_hq_alert',     'escalation.dispatch',   'dingtalk', 'https://oapi.dingtalk.com/robot/send?access_token=DEMO_BJ_HQ', '{"risk_level":"high"}'::jsonb, 60),
  ('heytea-sh', 'sh_quality_alert', 'escalation.dispatch',   'dingtalk', 'https://oapi.dingtalk.com/robot/send?access_token=DEMO_SH_QC',  '{}'::jsonb, 30),
  ('heytea-sz', 'sz_hq_audit',     'escalation.dispatch',   'email',    'sz-foodsafety@heytea.com',                                  '{}'::jsonb, 0)
on conflict (workspace_id, subscription_name) do nothing;

-- ============================================================
-- 2. 改造: rpc_subscription_poll_match — 加 workspace 参数
--    A9 版本硬编码 'default'，本版本参数化
-- ============================================================
create or replace function datafoundry.rpc_subscription_poll_match(
  p_dispatched_to text default 'subscriber',
  p_workspace_id  text default 'default'
)
returns table (
  event_id         text,
  event_name       text,
  payload          jsonb,
  subscription_id  bigint,
  target_channel   text,
  target_id        text,
  cooldown_seconds int,
  filter_json      jsonb,
  work_order_id    text
)
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
begin
  return query
    with next_evt as (
      select e.event_id, e.event_name, e.payload
      from datafoundry.fsf_inngest_events e
      where e.status = 'queued'
        and e.attempts < 5
        and (p_workspace_id = 'default'
             or e.source = 'rpc'
             or e.event_id like p_workspace_id || '%'
             or e.event_id like 'WO-%')
      order by e.created_at asc
      for update skip locked
      limit 1
    ),
    matched as (
      select n.event_id, n.event_name, n.payload,
             s.id               as subscription_id,
             s.target_channel   as target_channel,
             s.target_id        as target_id,
             s.cooldown_seconds as cooldown_seconds,
             s.filter_json      as filter_json,
             n.payload->>'work_order_id' as work_order_id
      from next_evt n
      join datafoundry.fsf_event_subscriptions s
        on s.event_name = n.event_name
       and s.enabled   = true
       and s.workspace_id = coalesce(
           nullif(p_workspace_id, 'default'),
           s.workspace_id
         )
      -- 简单 filter_json 匹配: payload[key] = filter_json[key]
      where (s.filter_json = '{}'::jsonb
             or n.payload @> s.filter_json)
    )
    update datafoundry.fsf_inngest_events e
    set status       = 'dispatched',
        dispatched_to = p_dispatched_to,
        dispatched_at = now(),
        attempts      = e.attempts + 1,
        updated_at    = now()
    from matched m
    where e.event_id = m.event_id
    returning m.event_id, m.event_name, m.payload,
             m.subscription_id, m.target_channel, m.target_id,
             m.cooldown_seconds, m.filter_json, m.work_order_id;
end $$;

-- ============================================================
-- 3. RPC: rpc_work_order_enqueue_event
--    当 fsf_work_orders 状态变时，由 trigger 调用插入 inngest 事件
--    参数化 workspace_id 路由到对应订阅
-- ============================================================
create or replace function datafoundry.rpc_work_order_enqueue_event(
  p_work_order_id text,
  p_event_name    text default 'work_order.status_change',
  p_workspace_id  text default null,   -- null = 从 work_order 推算
  p_category      text default null,
  p_risk_level    text default null,
  p_description   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
declare
  v_event_id   text;
  v_workspace  text;
  v_payload    jsonb;
  v_status     text;
begin
  -- 取 work_order 的 workspace_id 和 status
  select wo.workspace_id, wo.status into v_workspace, v_status
  from datafoundry.fsf_work_orders wo
  where wo.case_no = p_work_order_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'work_order not found: ' || p_work_order_id);
  end if;

  v_workspace := coalesce(p_workspace_id, v_workspace, 'default');

  v_event_id := 'wo_' || p_work_order_id || '_' || to_char(now(), 'YYYYMMDDHH24MI') || '_' ||
                substr(md5(random()::text), 1, 6);

  v_payload := jsonb_build_object(
    'work_order_id', p_work_order_id,
    'event_name',    p_event_name,
    'category',       coalesce(p_category, 'other'),
    'risk_level',    coalesce(p_risk_level, 'medium'),
    'description',   coalesce(p_description, 'work order status changed'),
    'workspace_id',  v_workspace,
    'status',        v_status
  );

  insert into datafoundry.fsf_inngest_events
    (event_id, event_name, source, payload, status)
  values
    (v_event_id, p_event_name, 'work_order_trigger', v_payload, 'queued');

  -- 写审计
  insert into datafoundry.dfd_audit_events
    (workspace_id, actor_id, category, severity, action, target, payload)
  values
    (v_workspace, null, 'work_order_event_enqueued', 'info',
     p_event_name, p_work_order_id,
     jsonb_build_object('event_id', v_event_id, 'payload', v_payload));

  return jsonb_build_object(
    'ok', true, 'event_id', v_event_id,
    'workspace_id', v_workspace, 'event_name', p_event_name
  );
end $$;

-- ============================================================
-- 4. TRIGGER: fsf_work_orders status 变时自动 enqueue 事件
--    注意: BEFORE UPDATE 不能调 SECURITY DEFINER 函数（search_path 问题）
--    解法: 用 AFTER UPDATE trigger，在 trigger 内 insert into fsf_inngest_events 直接绕开
-- ============================================================
create or replace function datafoundry.trigger_work_order_enqueue_event()
returns trigger
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
declare
  v_event_id text;
  v_payload  jsonb;
begin
  if OLD.status = NEW.status then return NEW; end if;

  v_event_id := 'wo_trigger_' || NEW.case_no || '_' ||
                to_char(now(), 'YYYYMMDDHH24MI') || '_' ||
                substr(md5(random()::text), 1, 6);

  v_payload := jsonb_build_object(
    'work_order_id', NEW.case_no,
    'event_name',    'work_order.status_change',
    'category',      NEW.category,
    'risk_level',   NEW.risk_level,
    'description',  NEW.description,
    'workspace_id', NEW.workspace_id,
    'old_status',   OLD.status,
    'new_status',   NEW.status,
    'stage',        NEW.stage
  );

  insert into datafoundry.fsf_inngest_events
    (event_id, event_name, source, payload, status)
  values
    (v_event_id, 'work_order.status_change', 'work_order_trigger', v_payload, 'queued');

  return NEW;
end $$;

-- 先删旧 trigger（如果 schema 变了）
drop trigger if exists trigger_work_order_enqueue_event
  on datafoundry.fsf_work_orders;

create trigger trigger_work_order_enqueue_event
  after update of status on datafoundry.fsf_work_orders
  for each row
  execute function datafoundry.trigger_work_order_enqueue_event();

-- ============================================================
-- 5. RPC: rpc_workspace_list_active_subscriptions
--    前端 workspace 切换时列出当前 workspace 全部启用的订阅
-- ============================================================
create or replace function datafoundry.rpc_workspace_list_active_subscriptions(
  p_workspace_id text default 'default'
)
returns table (
  id                 bigint,
  subscription_name  text,
  event_name        text,
  target_channel    text,
  target_id         text,
  cooldown_seconds  int,
  trigger_count     bigint
)
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
begin
  return query
    select s.id, s.subscription_name, s.event_name,
           s.target_channel, s.target_id, s.cooldown_seconds, s.trigger_count
    from datafoundry.fsf_event_subscriptions s
    where s.workspace_id = p_workspace_id and s.enabled = true
    order by s.id asc;
end $$;

-- ============================================================
-- 6. 权限
-- ============================================================
revoke all on function datafoundry.rpc_subscription_poll_match(text,text)                          from public;
revoke all on function datafoundry.rpc_work_order_enqueue_event(text,text,text,text,text,text)       from public;
revoke all on function datafoundry.rpc_workspace_list_active_subscriptions(text)                    from public;

grant execute on function datafoundry.rpc_subscription_poll_match(text,text)                          to service_role;
grant execute on function datafoundry.rpc_work_order_enqueue_event(text,text,text,text,text,text)       to service_role;
grant execute on function datafoundry.rpc_workspace_list_active_subscriptions(text)                    to service_role;

commit;

-- ============================================================
-- 验证（粘贴到 SQL Editor）
-- ============================================================
-- 1) workspace seeds
-- select category, action, target from datafoundry.dfd_audit_events
--    where category = 'workspace_config' order by created_at desc limit 5;

-- 2) heytea-bj 订阅
-- select subscription_name, event_name, target_channel from datafoundry.fsf_event_subscriptions
--    where workspace_id = 'heytea-bj';

-- 3) rpc_subscription_poll_match with workspace
-- select * from datafoundry.rpc_subscription_poll_match('subscriber', 'heytea-bj');

-- 4) rpc_work_order_enqueue_event
-- select datafoundry.rpc_work_order_enqueue_event(
--   'FSW-20260821-001', 'work_order.status_change', 'heytea-bj', '外源性异物', 'high', '铁丝检出'
-- );

-- 5) inngest_events after trigger
-- select event_id, event_name, source, payload->>'work_order_id', status
--    from datafoundry.fsf_inngest_events
--    where source = 'work_order_trigger'
--    order by created_at desc limit 5;

-- 6) workspace active subs
-- select * from datafoundry.rpc_workspace_list_active_subscriptions('heytea-bj');