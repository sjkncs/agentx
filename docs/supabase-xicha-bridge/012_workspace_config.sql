-- ============================================================
-- 012_workspace_config.sql
-- A17.2: workspace config CRUD + retry辅助 RPC
-- 依赖: 007_event_subscriptions.sql（fsf_subscription_deliveries 已存在）
-- ============================================================

set search_path = datafoundry, public, extensions;
begin;

-- ============================================================
-- 1. rpc_workspace_config_get
--    读取单个 workspace 配置项（供 subscribe_loop 退避参数使用）
--    subscribe_loop.ts: fetchRetryConfig() 调此 RPC
-- ============================================================
create or replace function datafoundry.rpc_workspace_config_get(
  p_workspace_id text,
  p_key         text
)
returns jsonb
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
declare
  v_rec record;
begin
  select payload->>p_key as value
  into v_rec
  from datafoundry.dfd_audit_events
  where target         = p_workspace_id
    and category      = 'workspace_config'
    and action         = 'workspace_seed'
    and payload ? p_key
  order by created_at desc
  limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object('key', p_key, 'value', v_rec.value);
end;
$$;

revoke all on function datafoundry.rpc_workspace_config_get(text, text) from public;
grant  execute on function datafoundry.rpc_workspace_config_get(text, text) to service_role;

-- ============================================================
-- 2. rpc_workspace_config_set
--    写入 workspace 配置（upsert via latest event row）
--    用于 admin-workspace-config.tsx 保存配置
-- ============================================================
create or replace function datafoundry.rpc_workspace_config_set(
  p_workspace_id text,
  p_key         text,
  p_value       text
)
returns jsonb
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
declare
  v_exists boolean;
begin
  -- 检查是否已存在 workspace_config event
  select exists(
    select 1 from datafoundry.dfd_audit_events
    where target   = p_workspace_id
      and category = 'workspace_config'
      and action    = 'workspace_seed'
  ) into v_exists;

  if v_exists then
    -- 更新 latest workspace_seed event 的 payload
    update datafoundry.dfd_audit_events
    set payload = jsonb_set(
      coalesce(payload, '{}'),
      array[p_key],
      to_jsonb(p_value)
    )
    where target    = p_workspace_id
      and category  = 'workspace_config'
      and action    = 'workspace_seed'
    returning payload;
  else
    -- 插入新 workspace_config seed
    insert into datafoundry.dfd_audit_events (
      category, action, source, severity, target, payload
    ) values (
      'workspace_config', 'workspace_seed', 'rpc_workspace_config_set',
      'info', p_workspace_id,
      jsonb_build_object(p_key, p_value)
    );
  end if;

  return jsonb_build_object('ok', true, 'workspace_id', p_workspace_id, 'key', p_key);
end;
$$;

revoke all on function datafoundry.rpc_workspace_config_set(text, text, text) from public;
grant  execute on function datafoundry.rpc_workspace_config_set(text, text, text) to service_role;

-- ============================================================
-- 3. rpc_workspace_config_list
--    返回 workspace 全部配置（JSONB key-value map）
--    admin-workspace-config.tsx 列表用
-- ============================================================
create or replace function datafoundry.rpc_workspace_config_list(
  p_workspace_id text default 'default'
)
returns table (
  workspace_id   text,
  config_key    text,
  config_value  text,
  updated_at     timestamptz
)
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
begin
  return query
  with latest as (
    select
      target,
      payload,
      created_at,
      row_number() over (partition by target, jsonb_object_keys(coalesce(payload,'{}')) order by created_at desc) as rn
    from datafoundry.dfd_audit_events
    where target   = p_workspace_id
      and category = 'workspace_config'
      and action    = 'workspace_seed'
  )
  select
    l.target::text                    as workspace_id,
    kv.key::text                     as config_key,
    kv.value::text                   as config_value,
    l.created_at                     as updated_at
  from latest l
  cross join lateral jsonb_each_text(l.payload) as kv
  where l.rn = 1
  order by kv.key;
end;
$$;

revoke all on function datafoundry.rpc_workspace_config_list(text) from public;
grant  execute on function datafoundry.rpc_workspace_config_list(text) to service_role;

-- ============================================================
-- 4. rpc_subscription_poll_retries
--    subscribe_loop.ts 扫描 pending 重试（resend_requested_at 已设置但 status=pending）
-- ============================================================
create or replace function datafoundry.rpc_subscription_poll_retries(
  p_workspace_id text default 'default',
  p_limit        int  default 20
)
returns table (
  event_id          text,
  event_name        text,
  payload           jsonb,
  subscription_id   bigint,
  target_channel    text,
  target_id         text,
  work_order_id     text,
  attempts          int
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
    d.subscription_id,
    d.target_channel,
    d.target_id,
    (d.payload->>'work_order_id')::text as work_order_id,
    d.attempts
  from datafoundry.fsf_subscription_deliveries d
  join datafoundry.fsf_inngest_events e on e.event_id = d.event_id
  where d.status              = 'pending'
    and d.resend_requested_at is not null
    and d.resend_requested_at < now()   -- cooldown 已过
  order by d.resend_requested_at asc
  limit p_limit;
end;
$$;

revoke all on function datafoundry.rpc_subscription_poll_retries(text, int) from public;
grant  execute on function datafoundry.rpc_subscription_poll_retries(text, int) to service_role;

-- ============================================================
-- 5. rpc_subscription_get_attempt_count
--    获取某 (event_id, subscription_id) 的投递次数
-- ============================================================
create or replace function datafoundry.rpc_subscription_get_attempt_count(
  p_event_id        text,
  p_subscription_id  bigint
)
returns table (attempt int)
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
begin
  return query
  select
    coalesce(max(d.attempts), 0)::int as attempt
  from datafoundry.fsf_subscription_deliveries d
  where d.event_id        = p_event_id
    and d.subscription_id = p_subscription_id;
end;
$$;

revoke all on function datafoundry.rpc_subscription_get_attempt_count(text, bigint) from public;
grant  execute on function datafoundry.rpc_subscription_get_attempt_count(text, bigint) to service_role;

-- ============================================================
-- 6. rpc_subscription_get_latest_delivery
--    获取最新 delivery id（供 subscribe_loop 重发用）
-- ============================================================
create or replace function datafoundry.rpc_subscription_get_latest_delivery(
  p_event_id        text,
  p_subscription_id  bigint
)
returns table (id bigint, status text, attempts int)
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
begin
  return query
  select d.id, d.status, d.attempts
  from datafoundry.fsf_subscription_deliveries d
  where d.event_id        = p_event_id
    and d.subscription_id = p_subscription_id
  order by d.created_at desc
  limit 1;
end;
$$;

revoke all on function datafoundry.rpc_subscription_get_latest_delivery(text, bigint) from public;
grant  execute on function datafoundry.rpc_subscription_get_latest_delivery(text, bigint) to service_role;

commit;

-- ============================================================
-- 验证（A17 quick smoke）
-- ============================================================
-- select datafoundry.rpc_workspace_config_set('default', 'retry_dingtalk', '{"max_attempts":5,"base_delay_s":10,"max_delay_s":300,"backoff_multiplier":2.0}');
-- select * from datafoundry.rpc_workspace_config_get('default', 'retry_dingtalk');
-- select * from datafoundry.rpc_workspace_config_list('default');
-- select * from datafoundry.rpc_subscription_poll_retries('default', 5);
