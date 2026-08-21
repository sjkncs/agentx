-- ============================================================
-- 008_verify_workspace_events.sql
-- A10 验收：跨 workspace + WO→event 触发 + 钉钉签名 + 订阅创建
-- 依赖: 008_event_workspace_subscription.sql
-- ============================================================

set search_path = datafoundry, public, extensions;

-- 1. workspace seeds 存在
select '1) workspace seeds' as step,
  count(*) as workspace_count,
  string_agg(action, ', ') as actions
from datafoundry.dfd_audit_events
where category = 'workspace_config';

-- 2. 跨 workspace 订阅种子
select '2) cross-workspace subs' as step,
  workspace_id,
  subscription_name,
  event_name,
  target_channel
from datafoundry.fsf_event_subscriptions
where workspace_id != 'default'
order by workspace_id;

-- 3. 手动 enqueue 一个 WO 事件
select '3) WO enqueue' as step,
  datafoundry.rpc_work_order_enqueue_event(
    'FSW-A10-TEST', 'work_order.status_change',
    'heytea-bj', '外源性异物', 'high', 'A10 verify test'
  ) as result;

-- 4. trigger 自动入队（status 变）
update datafoundry.fsf_work_orders
set status = 'investigating'
where case_no = 'FSW-20260820-001'
returning case_no, status;

-- 5. inngest_events 中的 WO trigger 行
select '5) WO trigger rows' as step,
  event_id,
  event_name,
  source,
  payload->>'work_order_id' as wo_id,
  payload->>'workspace_id' as ws_id,
  status
from datafoundry.fsf_inngest_events
where source = 'work_order_trigger'
order by created_at desc
limit 3;

-- 6. rpc_subscription_poll_match workspace 参数化
select '6) poll_match heytea-bj' as step,
  count(*) as matched_rows,
  (select string_agg(event_name, ', ') from
    datafoundry.rpc_subscription_poll_match('verify', 'heytea-bj')) as events
from datafoundry.rpc_subscription_poll_match('verify', 'heytea-bj');

-- 7. rpc_workspace_list_active_subscriptions
select '7) heytea-bj active subs' as step,
  count(*) as active_count,
  string_agg(subscription_name, ', ') as sub_names
from datafoundry.fsf_event_subscriptions
where workspace_id = 'heytea-bj' and enabled = true;

-- 8. 全 workspace SUMMARY
select '8) SUMMARY' as step,
  (select count(distinct workspace_id) from datafoundry.fsf_event_subscriptions) as workspaces,
  (select count(*) from datafoundry.fsf_event_subscriptions) as total_subs,
  (select count(*) from datafoundry.fsf_event_subscriptions where enabled) as enabled_subs,
  (select count(*) from datafoundry.fsf_inngest_events where source = 'work_order_trigger') as wo_trigger_events,
  (select count(*) from datafoundry.fsf_inngest_events where status = 'queued') as queued_events,
  (select count(*) from datafoundry.fsf_subscription_deliveries) as total_deliveries;