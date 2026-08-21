-- ============================================================
-- 007_verify_event_subscriptions.sql
-- A9 验收：订阅 → 事件 → 投递 → inbox → 重发
-- 依赖: 007_event_subscriptions.sql + 006_inngest_callback_and_channel_routes.sql + 005_inngest_gate_rpcs.sql
-- ============================================================

set search_path = datafoundry, public, extensions;

-- 1. 看 3 条 seed 订阅是否在位
select '1) seeded subs' as step, count(*) as total,
       bool_and(enabled) as all_enabled
from datafoundry.fsf_event_subscriptions
where workspace_id = 'default';

-- 2. 入队一条 notification.dispatch（会触发 audit webhook 订阅）
select '2) enqueue' as step,
       datafoundry.rpc_inngest_enqueue_notification(
         'WO-A9-VERIFY', 'A9 verify', 'verify-event-subs', 'dingtalk', 'high'
       ) as result;

-- 3. 入队一条 compensation.generate（会触发 brand_hq 订阅）
select '3) enqueue comp' as step,
       datafoundry.rpc_inngest_enqueue_compensation(
         'WO-A9-VERIFY', '外源性异物', '金属', 'high'
       ) as result;

-- 4. worker 一次 poll_match 应该返回多条匹配（brand_hq + audit）
select '4) poll_match' as step,
       event_name, subscription_id, target_channel, work_order_id
from datafoundry.rpc_subscription_poll_match('verify');

-- 5. 看匹配后事件状态（应该是 dispatched）
select '5) event status' as step,
       event_name, status, dispatched_to, attempts
from datafoundry.fsf_inngest_events
order by created_at desc
limit 4;

-- 6. 手动 record_delivery 模拟 worker 完成
select '6) record_delivery' as step,
       datafoundry.rpc_subscription_record_delivery(
         (select event_id from datafoundry.fsf_inngest_events
          where status='dispatched' order by created_at desc limit 1),
         (select id from datafoundry.fsf_event_subscriptions
          where subscription_name = 'comp_all_brand_hq' limit 1),
         'dingtalk', 'https://oapi.dingtalk.com/robot/send?access_token=DEMO',
         jsonb_build_object('verify', true, 'work_order_id', 'WO-A9-VERIFY'),
         200, 'verify ok', true, 'WO-A9-VERIFY'
       ) as result;

-- 7. deliveries 列表（前端 inbox 用的数据）
select '7) inbox rows' as step,
       subscription_name, target_channel, status, attempts, sent_at
from datafoundry.rpc_subscription_list_deliveries('default', 20, null);

-- 8. 失败重发：把一条 delivery 标记 failed → 再 resend
update datafoundry.fsf_subscription_deliveries
set status = 'failed', failed_at = now(), last_error = 'simulated'
where status = 'sent'
limit 1;

select '8a) failed row' as step, id, status, last_error
from datafoundry.fsf_subscription_deliveries
where status = 'failed' limit 1;

select '8b) resend' as step,
       datafoundry.rpc_subscription_delivery_resend(
         (select id from datafoundry.fsf_subscription_deliveries
          where status = 'failed' limit 1)
       ) as result;

-- 9. 总结
select '9) SUMMARY' as step,
  (select count(*) from datafoundry.fsf_event_subscriptions) as subs,
  (select count(*) from datafoundry.fsf_event_subscriptions where enabled) as enabled_subs,
  (select count(*) from datafoundry.fsf_subscription_deliveries) as total_deliveries,
  (select count(*) from datafoundry.fsf_subscription_deliveries where status='sent') as sent,
  (select count(*) from datafoundry.fsf_subscription_deliveries where status='failed') as failed,
  (select count(*) from datafoundry.fsf_subscription_deliveries where status='pending') as pending,
  (select sum(trigger_count) from datafoundry.fsf_event_subscriptions) as total_triggers;