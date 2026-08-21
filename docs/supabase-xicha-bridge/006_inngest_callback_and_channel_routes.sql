-- ============================================================
-- 006_inngest_callback_and_channel_routes.sql
-- 闭环缺口 2（渠道分发表）+ 缺口 3（webhook callbacks）
-- 依赖: 000 + 003 + 005 全部跑完
-- 注: 不需要 alter database 权限，纯 SQL Editor 跑
-- ============================================================

set search_path = datafoundry, public, extensions;
begin;

-- ============================================================
-- 1. 渠道分发表（缺口 2）
--    把 notification.dispatch 事件实际路由到真实渠道 endpoint
--    channel -> {credential_ref, target_id, payload_template}
-- ============================================================
create table if not exists datafoundry.fsf_notification_routes (
  id                bigserial primary key,
  channel           text not null check (channel in ('dingtalk', 'wechat', 'email', 'sms', 'webhook')),
  route_name        text not null,           -- 如 "brand_hq_escalation" / "store_manager_dm"
  priority          int  not null default 100,  -- 数字越小优先级越高
  credential_ref    text,                   -- datafoundry.dfd_datasources.id（type=channel 类型）
  target_id         text not null,          -- 钉钉 robot webhook / wechat openid / email addr
  payload_template  jsonb not null default '{}'::jsonb,
  enabled           boolean not null default true,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists fsf_notification_routes_uk
  on datafoundry.fsf_notification_routes (channel, route_name);
create index if not exists fsf_notification_routes_priority_idx
  on datafoundry.fsf_notification_routes (enabled, priority, channel);

-- seed: 5 条默认路由（演示）
insert into datafoundry.fsf_notification_routes
  (channel, route_name, priority, credential_ref, target_id, payload_template)
values
  ('dingtalk',  'brand_hq_escalation', 10, null,
   'https://oapi.dingtalk.com/robot/send?access_token=DEMO_BRAND_HQ_TOKEN',
   '{"msgtype": "markdown", "title_prefix": "[食安升级]"}'::jsonb),
  ('dingtalk',  'store_manager_dm',     20, null,
   'https://oapi.dingtalk.com/robot/send?access_token=DEMO_STORE_TOKEN',
   '{"msgtype": "text", "at_all": false}'::jsonb),
  ('wechat',    'customer_followup',    30, null,
   'wxc_demo_customer_openid',           '{}'::jsonb),
  ('email',     'brand_hq_daily',       40, null,
   'brand-hq-foodsafety@heytea.com',     '{"subject_prefix": "[食安日报]"}'::jsonb),
  ('webhook',   'external_crm',         50, null,
   'https://crm.example.com/api/v1/food-safety-events',
   '{"auth_header": "Bearer DEMO_CRM_TOKEN"}'::jsonb)
on conflict (channel, route_name) do nothing;

-- ============================================================
-- 2. 投递日志表（每条事件投递结果）
--    worker 写入；前端可查
-- ============================================================
create table if not exists datafoundry.fsf_notification_deliveries (
  id              bigserial primary key,
  event_id        text not null references datafoundry.fsf_inngest_events(event_id) on delete cascade,
  route_id        bigint references datafoundry.fsf_notification_routes(id) on delete set null,
  channel         text not null,
  target          text not null,
  request_body    jsonb not null,
  response_status int,
  response_body   text,
  delivered_at    timestamptz,
  failed_at       timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists fsf_notification_deliveries_event_idx
  on datafoundry.fsf_notification_deliveries (event_id, created_at desc);
create index if not exists fsf_notification_deliveries_status_idx
  on datafoundry.fsf_notification_deliveries (channel, delivered_at desc);

-- ============================================================
-- 3. Webhook 回调日志（缺口 3 — webhook IN）
--    inngest / dingtalk / 任何外部系统回调时的入站日志
--    apps/api 中路由将写入这张表
-- ============================================================
create table if not exists datafoundry.fsf_webhook_inbox (
  id              bigserial primary key,
  source          text not null,           -- inngest | dingtalk | wechat | external_crm | ...
  event_id        text,                    -- 回调事件 ID（外部系统给的）
  signature       text,                    -- 签名（HMAC / SHA1 / RSA）
  headers         jsonb not null default '{}'::jsonb,
  payload         jsonb not null,
  processed       boolean not null default false,
  processed_at    timestamptz,
  work_order_id   text,                    -- 关联到工单
  result          jsonb,                   -- 回调处理结果
  error           text,
  received_at     timestamptz not null default now()
);
create index if not exists fsf_webhook_inbox_source_idx
  on datafoundry.fsf_webhook_inbox (source, received_at desc);
create index if not exists fsf_webhook_inbox_event_idx
  on datafoundry.fsf_webhook_inbox (source, event_id);
create index if not exists fsf_webhook_inbox_pending_idx
  on datafoundry.fsf_webhook_inbox (processed, received_at)
  where processed = false;

-- ============================================================
-- 4. fsf_inngest_events 增加列：
--    - dispatched_to: 投递到哪个端（inngest | 直发route | webhook）
--    - delivery_id: 关联 fsf_notification_deliveries
-- ============================================================
alter table datafoundry.fsf_inngest_events
  add column if not exists dispatched_to text,
  add column if not exists delivery_id    bigint references datafoundry.fsf_notification_deliveries(id) on delete set null,
  add column if not exists webhook_inbox_id bigint references datafoundry.fsf_webhook_inbox(id) on delete set null;

-- ============================================================
-- 5. RPC: rpc_inngest_dispatch_one (worker 调用)
--    原子抢占一条 queued 事件 → 标记 dispatched（让 worker 拿到排他锁）
--    FOR UPDATE SKIP LOCKED 让多 worker 并行安全
-- ============================================================
create or replace function datafoundry.rpc_inngest_dispatch_one(
  p_dispatched_to text default 'inngest'
)
returns table (
  event_id text,
  event_name text,
  payload jsonb,
  attempts int
)
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
begin
  return query
    with next_event as (
      select e.event_id
      from datafoundry.fsf_inngest_events e
      where e.status = 'queued'
        and e.attempts < 5
      order by e.created_at asc
      for update skip locked
      limit 1
    )
    update datafoundry.fsf_inngest_events e
    set status = 'dispatched',
        attempts = e.attempts + 1,
        dispatched_to = p_dispatched_to,
        dispatched_at = now(),
        updated_at = now()
    from next_event n
    where e.event_id = n.event_id
    returning e.event_id, e.event_name, e.payload, e.attempts;
end $$;

-- ============================================================
-- 6. RPC: rpc_inngest_mark_result (worker 调用)
--    投递完成后根据 result 改 status + 写 last_error
-- ============================================================
create or replace function datafoundry.rpc_inngest_mark_result(
  p_event_id text,
  p_status   text,
  p_error    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
declare
  v_updated int;
begin
  update datafoundry.fsf_inngest_events
  set status = p_status,
      last_error = p_error,
      updated_at = now()
  where event_id = p_event_id;
  get diagnostics v_updated = row_count;

  -- 失败回滚：把 status 改回 queued 让 worker 重试
  if p_status = 'failed' and p_error is not null then
    update datafoundry.fsf_inngest_events
    set status = 'queued'
    where event_id = p_event_id and attempts < 5;
  end if;

  return jsonb_build_object('ok', true, 'updated', v_updated, 'event_id', p_event_id);
exception
  when others then
    return jsonb_build_object('ok', false, 'error', SQLERRM);
end $$;

-- ============================================================
-- 7. RPC: rpc_inngest_pick_notification_route
--    按 channel + priority 选一条可用 route
-- ============================================================
create or replace function datafoundry.rpc_inngest_pick_notification_route(
  p_channel text
)
returns table (
  route_id bigint,
  channel text,
  target_id text,
  payload_template jsonb
)
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
begin
  return query
    select r.id, r.channel, r.target_id, r.payload_template
    from datafoundry.fsf_notification_routes r
    where r.channel = p_channel and r.enabled = true
    order by r.priority asc
    limit 1;
end $$;

-- ============================================================
-- 8. RPC: rpc_inngest_record_delivery
--    worker 投递完成写结果 + 同时落 audit + 更新事件外键
-- ============================================================
create or replace function datafoundry.rpc_inngest_record_delivery(
  p_event_id      text,
  p_route_id      bigint,
  p_channel       text,
  p_target        text,
  p_request_body  jsonb,
  p_response_status int default null,
  p_response_body   text default null,
  p_success         boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
declare
  v_delivery_id bigint;
begin
  insert into datafoundry.fsf_notification_deliveries
    (event_id, route_id, channel, target, request_body, response_status, response_body,
     delivered_at, failed_at)
  values
    (p_event_id, p_route_id, p_channel, p_target, p_request_body,
     p_response_status, p_response_body,
     case when p_success then now() end,
     case when p_success then null else now() end)
  returning id into v_delivery_id;

  update datafoundry.fsf_inngest_events
  set delivery_id = v_delivery_id, updated_at = now()
  where event_id = p_event_id;

  insert into datafoundry.dfd_audit_events
    (workspace_id, actor_id, category, severity, action, target, payload)
  values
    (null, null, 'inngest_delivery',
     case when p_success then 'info' else 'warning' end,
     case when p_success then 'notification_delivered' else 'notification_failed' end,
     p_event_id,
     jsonb_build_object('delivery_id', v_delivery_id, 'channel', p_channel,
                       'response_status', p_response_status, 'route_id', p_route_id));

  return jsonb_build_object('ok', true, 'delivery_id', v_delivery_id);
end $$;

-- ============================================================
-- 9. RPC: rpc_inngest_ack_webhook (apps/api 用)
--    把 webhook callbacks 关联回事件 + 工单
-- ============================================================
create or replace function datafoundry.rpc_inngest_ack_webhook(
  p_source        text,
  p_external_event_id text,
  p_work_order_id text,
  p_result        jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
declare
  v_inbox_id bigint;
begin
  -- 把已有的 inbox 行更新 processed
  update datafoundry.fsf_webhook_inbox
  set processed = true,
      processed_at = now(),
      work_order_id = p_work_order_id,
      result = p_result
  where source = p_source and event_id = p_external_event_id
    and processed = false
  returning id into v_inbox_id;

  if v_inbox_id is null then
    -- 没找到就插入一条
    insert into datafoundry.fsf_webhook_inbox
      (source, event_id, signature, headers, payload, processed, processed_at, work_order_id, result)
    values
      (p_source, p_external_event_id, null, '{}'::jsonb, p_result, true, now(), p_work_order_id, p_result)
    returning id into v_inbox_id;
  end if;

  -- 工单状态联动：拿到 ack 后把工单 stage 推进
  if p_work_order_id is not null then
    update datafoundry.fsf_work_orders
    set agent_notes = coalesce(agent_notes, '') ||
                      E'\n[' || now()::text || '] webhook ack from ' || p_source,
        updated_at = now()
    where case_no = p_work_order_id;
  end if;

  return jsonb_build_object('ok', true, 'inbox_id', v_inbox_id, 'source', p_source);
end $$;

-- ============================================================
-- 10. 权限
-- ============================================================
revoke all on function datafoundry.rpc_inngest_dispatch_one(text)              from public;
revoke all on function datafoundry.rpc_inngest_mark_result(text, text, text)   from public;
revoke all on function datafoundry.rpc_inngest_pick_notification_route(text)   from public;
revoke all on function datafoundry.rpc_inngest_record_delivery(text, bigint, text, text, jsonb, int, text, boolean) from public;
revoke all on function datafoundry.rpc_inngest_ack_webhook(text, text, text, jsonb) from public;

grant execute on function datafoundry.rpc_inngest_dispatch_one(text)              to service_role;
grant execute on function datafoundry.rpc_inngest_mark_result(text, text, text)   to service_role;
grant execute on function datafoundry.rpc_inngest_pick_notification_route(text)   to service_role;
grant execute on function datafoundry.rpc_inngest_record_delivery(text, bigint, text, text, jsonb, int, text, boolean) to service_role;
grant execute on function datafoundry.rpc_inngest_ack_webhook(text, text, text, jsonb) to service_role;

grant select on datafoundry.fsf_notification_routes     to authenticated, service_role, anon;
grant select on datafoundry.fsf_notification_deliveries to authenticated, service_role;
grant select, insert, update on datafoundry.fsf_webhook_inbox to service_role;
grant select on datafoundry.fsf_webhook_inbox           to authenticated, service_role;

-- 事件表扩展列可见
grant select on datafoundry.fsf_inngest_events to authenticated, service_role, anon;

commit;

-- ============================================================
-- 验证 (跑完本文件后粘贴到 SQL Editor 看结果)
-- ============================================================
-- SELECT datafoundry.rpc_inngest_dispatch_one('inngest');
-- SELECT datafoundry.rpc_inngest_pick_notification_route('dingtalk');
-- SELECT channel, route_name, priority FROM datafoundry.fsf_notification_routes ORDER BY priority;
-- SELECT count(*) FROM datafoundry.fsf_notification_deliveries;
-- SELECT source, count(*) FROM datafoundry.fsf_webhook_inbox GROUP BY source;
