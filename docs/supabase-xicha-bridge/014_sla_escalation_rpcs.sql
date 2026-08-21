-- ============================================================
-- 014_sla_escalation_rpcs.sql — A22.1 SLA 超时检测 + 工单升级
--
-- 依赖: 003_food_safety_schema.sql（fsf_work_orders.sla_* 字段已存在）
--       005_inngest_gate_rpcs.sql（fsf_inngest_events 表已存在）
--
-- 规则（SLA 3 级）：
--   high   → resolution_hours = 2h  (fsf_sla_config)
--   medium → resolution_hours = 8h
--   low    → resolution_hours = 24h
--
-- SLA 状态机：
--   ok(ok) → warning(剩余 < 20%) → breached(sla_deadline < now)
--   breached → 自动设置 escalated_at + status='escalated'
--   → 触发 fsf_inngest_events (event_name='work_order.escalated')
--   → rpc_subscription_poll_match 匹配订阅 → 投递钉钉
-- ============================================================

set search_path = datafoundry, public, extensions;
begin;

-- ============================================================
-- 1. rpc_sla_check_and_escalate
--
--   调用方：verify-loop.ts（每 30s 执行一次）
--   逻辑：
--     - 扫描所有 sla_status != 'breached' 的 open/investigating 工单
--     - deadline < now        → status='breached', 自动 escalated
--     - deadline < now + 20% → status='warning'
--     - 返回受影响行数 + 列表
-- ============================================================
create or replace function datafoundry.rpc_sla_check_and_escalate()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_updated      int := 0;
  v_breached     int := 0;
  v_warning      int := 0;
  v_now          timestamptz := now();
  v_report       jsonb;
begin
  -- Phase 1: 更新所有超时的 → breached + escalated
  with updated as (
    update datafoundry.fsf_work_orders
    set sla_status   = 'breached',
        escalated_at = case when escalated_at is null then v_now else escalated_at end,
        status       = case when status not in ('resolved','closed') then 'escalated' else status end,
        updated_at   = v_now
    where sla_status != 'breached'
      and sla_deadline is not null
      and sla_deadline < v_now
      and status not in ('resolved', 'closed')
    returning id
  )
  select count(*) into v_breached from updated;

  -- Phase 2: 更新所有预警的 → warning
  with updated2 as (
    update datafoundry.fsf_work_orders
    set sla_status = 'warning',
        updated_at  = v_now
    where sla_status = 'ok'
      and sla_deadline is not null
      and sla_deadline < v_now + ((extract(epoch from (sla_deadline - sla_start)) / 3600 * 0.2) || ' seconds')::interval
      and status not in ('resolved', 'closed')
    returning id
  )
  select count(*) into v_warning from updated2;

  v_updated := v_breached + v_warning;

  -- 对每个新 breached 工单插入事件
  if v_breached > 0 then
    insert into datafoundry.fsf_inngest_events
      (event_id, event_name, source, status, payload)
    select
      gen_random_uuid()::text,
      'work_order.escalated',
      'rpc_sla_check_and_escalate',
      'pending',
      jsonb_build_object(
        'work_order_id',  id,
        'case_no',       case_no,
        'sla_status',    'breached',
        'escalated_at',  v_now,
        'trigger',       'sla_breach'
      )
    from datafoundry.fsf_work_orders
    where sla_status = 'breached'
      and updated_at >= v_now - interval '5 seconds';
  end if;

  v_report := jsonb_build_object(
    'checked_at',   v_now,
    'total_updated', v_updated,
    'breached',     v_breached,
    'warning',      v_warning,
    'ok',           0
  );

  return v_report;
end;
$$;

revoke all on function datafoundry.rpc_sla_check_and_escalate() from public;
grant execute on function datafoundry.rpc_sla_check_and_escalate() to authenticated, service_role;

-- ============================================================
-- 2. rpc_work_order_escalate
--
--   调用方：前端「升级」按钮（admin-wo-stage-dialog.tsx）
--   手动升级，不依赖 SLA 时间
-- ============================================================
create or replace function datafoundry.rpc_work_order_escalate(
  p_case_no   text,
  p_reason    text default null,
  p_escalate_to text default null   -- 'hq' | 'manager' | 'quality_team'
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_wo_id      bigint;
  v_payload    jsonb;
  v_now        timestamptz := now();
begin
  -- 验证工单存在
  select id into v_wo_id
  from datafoundry.fsf_work_orders
  where case_no = p_case_no
    and status not in ('resolved', 'closed');

  if v_wo_id is null then
    return jsonb_build_object('ok', false, 'error', 'work order not found or already closed');
  end if;

  -- 更新工单
  update datafoundry.fsf_work_orders
  set status       = 'escalated',
      escalated_at = case when escalated_at is null then v_now else escalated_at end,
      sla_status   = 'breached',
      updated_at   = v_now
  where case_no = p_case_no;

  -- 插入事件
  insert into datafoundry.fsf_inngest_events
    (event_id, event_name, source, status, payload)
  values (
    gen_random_uuid()::text,
    'work_order.escalated',
    'rpc_work_order_escalate',
    'pending',
    jsonb_build_object(
      'work_order_id', v_wo_id,
      'case_no',       p_case_no,
      'escalated_at',  v_now,
      'reason',        p_reason,
      'escalate_to',   p_escalate_to,
      'trigger',       'manual'
    )
  );

  -- 审计日志
  insert into datafoundry.dfd_audit_events
    (workspace_id, actor_id, category, severity, action, target, payload, created_at)
  values (
    'heytea-bj',
    null,
    'fsf_work_order',
    'critical',
    'work_order.escalated',
    p_case_no,
    jsonb_build_object(
      'reason',      p_reason,
      'escalate_to', p_escalate_to,
      'trigger',     'manual'
    ),
    v_now
  );

  return jsonb_build_object('ok', true, 'case_no', p_case_no, 'escalated_at', v_now);
end;
$$;

revoke all on function datafoundry.rpc_work_order_escalate(text, text, text) from public;
grant execute on function datafoundry.rpc_work_order_escalate(text, text, text) to authenticated, service_role;

-- ============================================================
-- 3. rpc_work_order_stage_advance
--
--   调用方：前端 stage 流转表单（admin-wo-stage-dialog.tsx）
--   stage 推进：reported → triage → investigation → resolution → closed
--   每个 stage 变更同步更新 status
-- ============================================================
create or replace function datafoundry.rpc_work_order_stage_advance(
  p_case_no    text,
  p_stage      text,        -- 'triage' | 'investigation' | 'resolution' | 'closed'
  p_notes      text default null,
  p_resolution text default null,
  p_handler_id bigint default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_wo_id      bigint;
  v_new_status text;
  v_now        timestamptz := now();
begin
  -- 验证 stage
  if p_stage not in ('triage', 'investigation', 'resolution', 'closed') then
    return jsonb_build_object('ok', false, 'error', 'invalid stage: ' || p_stage);
  end if;

  -- stage → status 映射
  v_new_status := case p_stage
    when 'triage'         then 'open'
    when 'investigation'  then 'investigating'
    when 'resolution'     then 'resolved'
    when 'closed'         then 'closed'
    else 'open'
  end;

  -- 验证工单
  select id into v_wo_id
  from datafoundry.fsf_work_orders
  where case_no = p_case_no;

  if v_wo_id is null then
    return jsonb_build_object('ok', false, 'error', 'work order not found');
  end if;

  -- 更新工单
  update datafoundry.fsf_work_orders
  set stage        = p_stage,
      status      = v_new_status,
      handler_id  = coalesce(p_handler_id, handler_id),
      resolution  = coalesce(p_resolution, resolution),
      resolved_at = case when p_stage in ('resolution', 'closed') then v_now else resolved_at end,
      updated_at  = v_now
  where case_no = p_case_no;

  -- 记录 AI 备注
  if p_notes is not null and p_notes != '' then
    update datafoundry.fsf_work_orders
    set agent_notes = concat(coalesce(agent_notes, ''), E'\n---\n', v_now::text, ' [', p_stage, ']: ', p_notes)
    where case_no = p_case_no;
  end if;

  -- 插入事件
  insert into datafoundry.fsf_inngest_events
    (event_id, event_name, source, status, payload)
  values (
    gen_random_uuid()::text,
    'work_order.stage_changed',
    'rpc_work_order_stage_advance',
    'pending',
    jsonb_build_object(
      'work_order_id', v_wo_id,
      'case_no',       p_case_no,
      'stage',         p_stage,
      'status',        v_new_status,
      'handler_id',    p_handler_id,
      'resolution',    p_resolution
    )
  );

  return jsonb_build_object(
    'ok',      true,
    'case_no', p_case_no,
    'stage',   p_stage,
    'status',  v_new_status
  );
end;
$$;

revoke all on function datafoundry.rpc_work_order_stage_advance(text, text, text, text, bigint) from public;
grant execute on function datafoundry.rpc_work_order_stage_advance(text, text, text, text, bigint) to authenticated, service_role;

-- ============================================================
-- 4. rpc_work_order_list_with_sla
--
--   工单列表（含 SLA 预警统计）
--   用于 admin-wo-stage-dialog 加载时显示当前 SLA 状态
-- ============================================================
create or replace function datafoundry.rpc_work_order_list_with_sla(
  p_workspace_id   text default 'heytea-bj',
  p_status_filter  text default null,  -- null = all
  p_limit          int  default 100,
  p_offset         int  default 0
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_rows jsonb;
begin
  with base as (
    select
      wo.id, wo.case_no, wo.category, wo.risk_level, wo.status, wo.stage,
      wo.sla_status, wo.sla_deadline, wo.sla_start, wo.sla_target_hours,
      wo.handler_id, wo.resolution, wo.compensation_type, wo.compensation_detail,
      wo.escalated_at, wo.resolved_at, wo.created_at, wo.updated_at,
      (
        select count(*)::int
        from datafoundry.fsf_inngest_events ev
        where ev.payload->>'work_order_id' = wo.id::text
          and ev.event_name in ('work_order.created', 'work_order.stage_changed',
                                'work_order.escalated', 'work_order.resolved')
      ) as event_count
    from datafoundry.fsf_work_orders wo
    where (p_status_filter is null or wo.status = p_status_filter)
      and wo.status not in ('closed')
    order by
      case wo.sla_status when 'breached' then 0 when 'warning' then 1 else 2 end,
      wo.sla_deadline asc nulls last,
      wo.created_at desc
    limit p_limit
    offset p_offset
  ),
  stats as (
    select
      count(*) filter (where sla_status = 'breached')  as breached_count,
      count(*) filter (where sla_status = 'warning')   as warning_count,
      count(*) filter (where status = 'open')         as open_count,
      count(*) filter (where status = 'investigating')as investigating_count,
      count(*) filter (where status = 'escalated')    as escalated_count,
      count(*)                                        as total_count
    from base
  )
  select jsonb_build_object(
    'rows',  to_jsonb(base),
    'stats', to_jsonb(stats)
  ) into v_rows
  from base, stats;

  return coalesce(v_rows, '{"rows":[],"stats":{}}'::jsonb);
end;
$$;

revoke all on function datafoundry.rpc_work_order_list_with_sla(text, text, int, int) from public;
grant execute on function datafoundry.rpc_work_order_list_with_sla(text, text, int, int) to authenticated, service_role;

-- ============================================================
-- 5. Index: SLA 监控查询优化
-- ============================================================
create index if not exists idx_fsfwo_sla_monitor
  on datafoundry.fsf_work_orders (sla_status, status, sla_deadline)
  where sla_status != 'breached' and status not in ('resolved', 'closed');

commit;
