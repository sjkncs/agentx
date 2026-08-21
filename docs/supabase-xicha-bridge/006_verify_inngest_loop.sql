-- ============================================================
-- 006_verify_inngest_loop.sql
-- A8 闭环验收：worker -> dispatcher -> delivery 一条龙
-- 依赖: 006_inngest_callback_and_channel_routes.sql 跑完
-- ============================================================

set search_path = datafoundry, public, extensions;

-- ────────────────────────────────────────────────────────────
-- 1. enqueue 一条 notification 事件
-- ────────────────────────────────────────────────────────────
select '1) enqueue' as step,
       datafoundry.rpc_inngest_enqueue_notification(
         'WO-A8-VERIFY', 'A8 verify', 'verify-loop', 'dingtalk', 'normal'
       ) as result;

-- ────────────────────────────────────────────────────────────
-- 2. dispatch_one 抢占（FOR UPDATE SKIP LOCKED）
-- ────────────────────────────────────────────────────────────
select '2) dispatch_one' as step,
       datafoundry.rpc_inngest_dispatch_one('verify') as row;

-- ────────────────────────────────────────────────────────────
-- 3. 选一条 dingtalk route
-- ────────────────────────────────────────────────────────────
select '3) pick_route' as step,
       datafoundry.rpc_inngest_pick_notification_route('dingtalk') as route;

-- ────────────────────────────────────────────────────────────
-- 4. 看事件状态（应是 dispatched）
-- ────────────────────────────────────────────────────────────
select '4) event state' as step,
       event_id, event_name, status, attempts, dispatched_to
from datafoundry.fsf_inngest_events
order by created_at desc
limit 3;

-- ────────────────────────────────────────────────────────────
-- 5. 手动 mark succeeded，模拟 worker 完成
-- ────────────────────────────────────────────────────────────
select '5) mark_result' as step,
       datafoundry.rpc_inngest_mark_result(
         (select event_id from datafoundry.fsf_inngest_events
          where status='dispatched' order by created_at desc limit 1),
         'succeeded',
         null
       ) as result;

-- ────────────────────────────────────────────────────────────
-- 6. 投递日志（worker 真实跑起来后会有，这里先看列）
-- ────────────────────────────────────────────────────────────
select '6) deliveries count' as step,
       (select count(*) from datafoundry.fsf_notification_deliveries) as total,
       (select count(*) from datafoundry.fsf_notification_deliveries where delivered_at is not null) as delivered,
       (select count(*) from datafoundry.fsf_notification_deliveries where failed_at    is not null) as failed;

-- ────────────────────────────────────────────────────────────
-- 7. webhook inbox（apps/api 入站后会写）
-- ────────────────────────────────────────────────────────────
select '7) inbox' as step,
       source, count(*),
       bool_or(processed) as all_processed
from datafoundry.fsf_webhook_inbox
group by source;

-- ────────────────────────────────────────────────────────────
-- 8. queue 健康（worker 跑了之后 queued=0 dispatched>0）
-- ────────────────────────────────────────────────────────────
select '8) queue health' as step,
       status, count(*)
from datafoundry.fsf_inngest_events
group by status;

-- ────────────────────────────────────────────────────────────
-- 9. 验收总结（5 字段）
-- ────────────────────────────────────────────────────────────
select
  '9) SUMMARY' as step,
  (select count(*) from datafoundry.fsf_notification_routes)      as routes,
  (select count(*) from datafoundry.fsf_notification_deliveries)  as deliveries,
  (select count(*) from datafoundry.fsf_webhook_inbox)            as inbox_rows,
  (select count(*) from datafoundry.fsf_inngest_events where status='succeeded') as ok_events,
  (select count(*) from datafoundry.fsf_inngest_events where status='failed')   as bad_events;
