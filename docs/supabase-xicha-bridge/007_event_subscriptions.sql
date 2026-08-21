-- ============================================================
-- 007_event_subscriptions.sql
-- A9 缺口 4（跨工作区事件订阅）+ 前端 Inbox 数据源
-- 依赖: 000 + 003 + 005 + 006 全部跑完
-- ============================================================

set search_path = datafoundry, public, extensions;
begin;

-- ============================================================
-- 1. fsf_event_subscriptions
--    workspace 级订阅规则：event_name + 简单 filter + 投递目标
-- ============================================================
create table if not exists datafoundry.fsf_event_subscriptions (
  id               bigserial primary key,
  workspace_id     text not null default 'default',
  subscription_name text not null,
  event_name       text not null,                    -- 与 fsf_inngest_events.event_name 匹配
  filter_json      jsonb not null default '{}'::jsonb,   -- payload 内的 key=value 过滤
  target_channel   text not null check (target_channel in ('dingtalk','wechat','email','sms','webhook')),
  target_id        text not null,                   -- 钉钉 webhook / wechat openid / email addr / http url
  enabled          boolean not null default true,
  cooldown_seconds int  not null default 0,         -- 同 work_order_id 投递冷却（防止刷屏）
  metadata         jsonb not null default '{}'::jsonb,
  last_triggered_at timestamptz,
  trigger_count    bigint not null default 0,
  created_by        text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists fsf_event_subscriptions_uk
  on datafoundry.fsf_event_subscriptions (workspace_id, subscription_name);
create index if not exists fsf_event_subscriptions_match_idx
  on datafoundry.fsf_event_subscriptions (enabled, event_name)
  where enabled = true;

-- seed: 3 默认订阅
insert into datafoundry.fsf_event_subscriptions
  (workspace_id, subscription_name, event_name, target_channel, target_id, filter_json, cooldown_seconds)
values
  ('default', 'comp_all_brand_hq',     'compensation.generate', 'dingtalk', 'https://oapi.dingtalk.com/robot/send?access_token=DEMO_BRAND_HQ', '{"risk_level":"high"}'::jsonb, 300),
  ('default', 'escalation_to_email',   'escalation.dispatch',    'email',    'brand-hq-foodsafety@heytea.com', '{}'::jsonb, 0),
  ('default', 'notification_audit',    'notification.dispatch', 'webhook',  'https://crm.example.com/api/v1/food-safety-events', '{}'::jsonb, 60)
on conflict (workspace_id, subscription_name) do nothing;

-- ============================================================
-- 2. fsf_subscription_deliveries
--    一次匹配 = 一行；包含 re-send 状态
-- ============================================================
create table if not exists datafoundry.fsf_subscription_deliveries (
  id                bigserial primary key,
  subscription_id   bigint not null references datafoundry.fsf_event_subscriptions(id) on delete cascade,
  event_id          text   not null,                -- 来自 fsf_inngest_events.event_id
  work_order_id     text,
  payload_snapshot  jsonb not null,                 -- 匹配时的 payload 快照
  target_channel    text not null,
  target_id         text not null,
  status            text not null default 'pending'
                     check (status in ('pending','sent','failed','skipped')),
  attempts          int not null default 0,
  last_error        text,
  sent_at           timestamptz,
  failed_at         timestamptz,
  resend_requested_at timestamptz,
  resend_count      int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists fsf_subscription_deliveries_sub_idx
  on datafoundry.fsf_subscription_deliveries (subscription_id, created_at desc);
create index if not exists fsf_subscription_deliveries_status_idx
  on datafoundry.fsf_subscription_deliveries (status, created_at desc);
create index if not exists fsf_subscription_deliveries_event_idx
  on datafoundry.fsf_subscription_deliveries (event_id);

-- 去重唯一性：同一 sub + 同一 event_id 不重复投递
create unique index if not exists fsf_subscription_deliveries_dedupe_uk
  on datafoundry.fsf_subscription_deliveries (subscription_id, event_id);

-- ============================================================
-- 3. RPC: rpc_event_subscription_create
-- ============================================================
create or replace function datafoundry.rpc_event_subscription_create(
  p_workspace_id      text default 'default',
  p_subscription_name text default null,
  p_event_name        text default null,
  p_filter            jsonb default '{}'::jsonb,
  p_target_channel    text default null,
  p_target_id         text default null,
  p_cooldown_seconds  int  default 0,
  p_created_by        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
declare
  v_id bigint;
  v_name text;
begin
  if p_subscription_name is null or length(p_subscription_name) = 0 then
    v_name := 'sub_' || substr(md5(random()::text), 1, 8);
  else
    v_name := p_subscription_name;
  end if;

  if p_event_name is null or p_target_channel is null or p_target_id is null then
    raise exception 'event_name / target_channel / target_id 必填';
  end if;

  insert into datafoundry.fsf_event_subscriptions
    (workspace_id, subscription_name, event_name, filter_json,
     target_channel, target_id, cooldown_seconds, created_by)
  values
    (p_workspace_id, v_name, p_event_name, p_filter,
     p_target_channel, p_target_id, p_cooldown_seconds, p_created_by)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'subscription_name', v_name);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'subscription_name already exists');
end $$;

-- ============================================================
-- 4. RPC: rpc_event_subscription_list
-- ============================================================
create or replace function datafoundry.rpc_event_subscription_list(
  p_workspace_id text default 'default',
  p_include_disabled boolean default true
)
returns table (
  id bigint,
  subscription_name text,
  event_name text,
  filter_json jsonb,
  target_channel text,
  target_id text,
  enabled boolean,
  cooldown_seconds int,
  trigger_count bigint,
  last_triggered_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
begin
  return query
    select s.id, s.subscription_name, s.event_name, s.filter_json,
           s.target_channel, s.target_id, s.enabled, s.cooldown_seconds,
           s.trigger_count, s.last_triggered_at, s.created_at
    from datafoundry.fsf_event_subscriptions s
    where s.workspace_id = p_workspace_id
      and (p_include_disabled or s.enabled = true)
    order by s.id asc;
end $$;

-- ============================================================
-- 5. RPC: rpc_event_subscription_toggle
-- ============================================================
create or replace function datafoundry.rpc_event_subscription_toggle(
  p_id      bigint,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
declare
  v_count int;
begin
  update datafoundry.fsf_event_subscriptions
  set enabled = p_enabled, updated_at = now()
  where id = p_id;
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', v_count > 0, 'id', p_id, 'enabled', p_enabled);
end $$;

-- ============================================================
-- 6. RPC: rpc_subscription_delivery_resend
--    前端"重发"按钮用
-- ============================================================
create or replace function datafoundry.rpc_subscription_delivery_resend(
  p_delivery_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
declare
  v_count int;
begin
  update datafoundry.fsf_subscription_deliveries
  set status = 'pending',
      attempts = 0,
      last_error = null,
      failed_at = null,
      resend_requested_at = now(),
      resend_count = resend_count + 1,
      updated_at = now()
  where id = p_delivery_id and status in ('failed', 'pending');
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', v_count > 0, 'id', p_delivery_id);
end $$;

-- ============================================================
-- 7. RPC: rpc_subscription_poll_match
--    worker 调用：拿一条 status=queued 事件，匹配所有 enabled 订阅
--    返回要投递的目标（一条事件可能匹配多条）
-- ============================================================
create or replace function datafoundry.rpc_subscription_poll_match(
  p_dispatched_to text default 'subscriber'
)
returns table (
  event_id text,
  event_name text,
  payload jsonb,
  subscription_id bigint,
  target_channel text,
  target_id text,
  cooldown_seconds int,
  filter_json jsonb,
  work_order_id text
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
      where e.status = 'queued' and e.attempts < 5
      order by e.created_at asc
      for update skip locked
      limit 1
    ),
    matched as (
      select n.event_id, n.event_name, n.payload,
             s.id as subscription_id, s.target_channel, s.target_id,
             s.cooldown_seconds, s.filter_json,
             n.payload->>'work_order_id' as work_order_id
      from next_evt n
      join datafoundry.fsf_event_subscriptions s
        on s.event_name = n.event_name and s.enabled = true
    )
    update datafoundry.fsf_inngest_events e
    set status = 'dispatched', dispatched_to = p_dispatched_to,
        dispatched_at = now(), attempts = e.attempts + 1, updated_at = now()
    from matched m
    where e.event_id = m.event_id
    returning m.event_id, m.event_name, m.payload,
              m.subscription_id, m.target_channel, m.target_id,
              m.cooldown_seconds, m.filter_json, m.work_order_id;
end $$;

-- ============================================================
-- 8. RPC: rpc_subscription_record_delivery
--    worker 投递后写结果
-- ============================================================
create or replace function datafoundry.rpc_subscription_record_delivery(
  p_event_id        text,
  p_subscription_id bigint,
  p_target_channel  text,
  p_target_id       text,
  p_request_body    jsonb,
  p_response_status int default null,
  p_response_body   text default null,
  p_success         boolean default true,
  p_work_order_id   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
declare
  v_id bigint;
begin
  insert into datafoundry.fsf_subscription_deliveries
    (subscription_id, event_id, work_order_id, payload_snapshot,
     target_channel, target_id, status, attempts,
     last_error, sent_at, failed_at, resend_requested_at)
  values
    (p_subscription_id, p_event_id, p_work_order_id, p_request_body,
     p_target_channel, p_target_id,
     case when p_success then 'sent' else 'failed' end,
     1,
     case when p_success then null else coalesce(p_response_body, 'http error') end,
     case when p_success then now() else null end,
     case when p_success then null else now() end,
     null)
  on conflict (subscription_id, event_id) do update
    set status = excluded.status,
        attempts = datafoundry.fsf_subscription_deliveries.attempts + 1,
        last_error = excluded.last_error,
        sent_at = excluded.sent_at,
        failed_at = excluded.failed_at,
        updated_at = now()
  returning id into v_id;

  -- 订阅计数器
  update datafoundry.fsf_event_subscriptions
  set trigger_count = trigger_count + 1,
      last_triggered_at = now(),
      updated_at = now()
  where id = p_subscription_id;

  insert into datafoundry.dfd_audit_events
    (workspace_id, actor_id, category, severity, action, target, payload)
  values
    (null, null, 'subscription_delivery',
     case when p_success then 'info' else 'warning' end,
     case when p_success then 'subscription_sent' else 'subscription_failed' end,
     p_event_id,
     jsonb_build_object('subscription_id', p_subscription_id, 'channel', p_target_channel,
                       'response_status', p_response_status, 'delivery_id', v_id));

  return jsonb_build_object('ok', true, 'delivery_id', v_id);
end $$;

-- ============================================================
-- 9. RPC: rpc_subscription_list_deliveries
--    前端 inbox 用
-- ============================================================
create or replace function datafoundry.rpc_subscription_list_deliveries(
  p_workspace_id text default 'default',
  p_limit        int  default 100,
  p_status       text default null
)
returns table (
  id bigint,
  subscription_id bigint,
  subscription_name text,
  event_name text,
  event_id text,
  work_order_id text,
  target_channel text,
  target_id text,
  status text,
  attempts int,
  last_error text,
  sent_at timestamptz,
  failed_at timestamptz,
  resend_count int,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
begin
  return query
    select d.id, d.subscription_id, s.subscription_name,
           s.event_name, d.event_id, d.work_order_id,
           d.target_channel, d.target_id, d.status, d.attempts,
           d.last_error, d.sent_at, d.failed_at, d.resend_count,
           d.created_at
    from datafoundry.fsf_subscription_deliveries d
    join datafoundry.fsf_event_subscriptions s on s.id = d.subscription_id
    where s.workspace_id = p_workspace_id
      and (p_status is null or d.status = p_status)
    order by d.created_at desc
    limit greatest(1, least(p_limit, 500));
end $$;

-- ============================================================
-- 10. 权限
-- ============================================================
revoke all on function datafoundry.rpc_event_subscription_create(text,text,text,jsonb,text,text,int,text)     from public;
revoke all on function datafoundry.rpc_event_subscription_list(text,boolean)                                   from public;
revoke all on function datafoundry.rpc_event_subscription_toggle(bigint,boolean)                               from public;
revoke all on function datafoundry.rpc_subscription_delivery_resend(bigint)                                    from public;
revoke all on function datafoundry.rpc_subscription_poll_match(text)                                            from public;
revoke all on function datafoundry.rpc_subscription_record_delivery(text,bigint,text,text,jsonb,int,text,boolean,text) from public;
revoke all on function datafoundry.rpc_subscription_list_deliveries(text,int,text)                              from public;

grant execute on function datafoundry.rpc_event_subscription_create(text,text,text,jsonb,text,text,int,text)     to service_role;
grant execute on function datafoundry.rpc_event_subscription_list(text,boolean)                                   to service_role;
grant execute on function datafoundry.rpc_event_subscription_toggle(bigint,boolean)                               to service_role;
grant execute on function datafoundry.rpc_subscription_delivery_resend(bigint)                                    to service_role;
grant execute on function datafoundry.rpc_subscription_poll_match(text)                                            to service_role;
grant execute on function datafoundry.rpc_subscription_record_delivery(text,bigint,text,text,jsonb,int,text,boolean,text) to service_role;
grant execute on function datafoundry.rpc_subscription_list_deliveries(text,int,text)                              to service_role;

grant select on datafoundry.fsf_event_subscriptions   to authenticated, service_role;
grant select on datafoundry.fsf_subscription_deliveries to authenticated, service_role;

commit;

-- ============================================================
-- 验证（粘贴到 SQL Editor 跑）
-- ============================================================
-- select * from datafoundry.rpc_event_subscription_list('default', true);
-- select datafoundry.rpc_subscription_poll_match('subscriber');
-- select * from datafoundry.rpc_subscription_list_deliveries('default', 20, null);