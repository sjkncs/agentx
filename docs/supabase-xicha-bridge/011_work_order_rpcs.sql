-- ============================================================
-- 011_work_order_rpcs.sql
-- A16.1: 工单 CRUD RPC
--   1. rpc_work_order_create  — 创建工单，生成 case_no
--   2. rpc_work_order_list    — 工单列表（带 summary stats）
-- 依赖: 003_food_safety_schema.sql（fsf_work_orders 表已存在）
-- ============================================================

set search_path = datafoundry, public, extensions;
begin;

-- ============================================================
-- 1. rpc_work_order_create
--    调用方：前端「新建工单」表单 → callRpc
--    逻辑：
--      - 生成 WO-{YYYYMMDD}-{4位随机} case_no
--      - 插入 fsf_work_orders（sla_deadline = now + SLA_HOURS）
--      - 插入 fsf_inngest_events（source='admin_create'）
--    A16 SLA 规则：
--      high   → 2小时   = 2 * 3600 s
--      medium → 8小时
--      low    → 24小时
-- ============================================================
create or replace function datafoundry.rpc_work_order_create(
  p_category         text,
  p_description      text,
  p_risk_level       text,        -- 'high' | 'medium' | 'low'
  p_store_id         text default null,
  p_store_name       text default null,
  p_order_no         text default null,
  p_reporter_email   text default null,
  p_evidence_urls    jsonb default null  -- e.g. '["url1","url2"]'
)
returns jsonb
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
declare
  v_case_no    text;
  v_date_str   text;
  v_rand4      text;
  v_sla_hours  int;
  v_wo_id      bigint;
  v_payload    jsonb;
  v_event_id   text;
begin
  -- SLA hours
  v_sla_hours := case p_risk_level
    when 'high'   then 2
    when 'medium' then 8
    else              24
  end;

  -- Generate case_no
  v_date_str := to_char(now(), 'YYYYMMDD');
  v_rand4    := lpad(floor(random() * 9999)::text, 4, '0');
  v_case_no  := 'WO-' || v_date_str || '-' || v_rand4;

  -- store_info JSONB
  v_payload := jsonb_build_object(
    'store_id',   p_store_id,
    'store_name', p_store_name,
    'order_no',   p_order_no
  );

  -- Insert work order
  insert into datafoundry.fsf_work_orders (
    case_no, category, description, risk_level,
    status, sla_deadline, sla_start, sla_status,
    sla_target_hours, store_info,
    compensation_type, resolution, stage,
    handler_id, agent_notes, evidence_urls,
    user_id
  ) values (
    v_case_no,
    p_category,
    p_description,
    p_risk_level,
    'open',                                   -- status
    now() + (v_sla_hours || ' hours')::interval,
    now(),                                    -- sla_start
    'ok',                                     -- initial sla_status
    v_sla_hours,
    case when p_store_id is not null then v_payload else null end,
    null, null, 'reported',                   -- compensation_type, resolution, stage
    null,                                     -- handler_id
    null,                                     -- agent_notes
    p_evidence_urls,
    0                                        -- user_id (system-admin)
  )
  returning id into v_wo_id;

  -- Emit creation event
  insert into datafoundry.fsf_inngest_events (
    event_id, event_name, source, status, payload
  ) values (
    gen_random_uuid()::text,
    'work_order.created',
    'admin_create',
    'processed',
    jsonb_build_object(
      'work_order_id', v_case_no,
      'category',      p_category,
      'risk_level',    p_risk_level,
      'sla_deadline',  (now() + (v_sla_hours || ' hours')::interval)::text,
      'reporter_email', p_reporter_email
    )
  );

  return jsonb_build_object(
    'ok',       true,
    'case_no',  v_case_no,
    'id',       v_wo_id,
    'sla_hours', v_sla_hours
  );
end;
$$;

revoke all on function datafoundry.rpc_work_order_create(text,text,text,text,text,text,text,jsonb) from public;
grant  execute on function datafoundry.rpc_work_order_create(text,text,text,text,text,text,text,jsonb) to service_role;

-- ============================================================
-- 2. rpc_work_order_list
--    返回全部工单（支持 category / status / risk_level 过滤）
--    用于前端列表 + 导出
-- ============================================================
create or replace function datafoundry.rpc_work_order_list(
  p_category   text default null,
  p_status     text default null,
  p_risk_level text default null,
  p_limit      int  default 200
)
returns table (
  id                  bigint,
  case_no             text,
  category            text,
  sub_category        text,
  description         text,
  risk_level          text,
  status              text,
  stage               text,
  sla_status          text,
  sla_deadline        timestamptz,
  sla_hours           int,
  store_info          jsonb,
  order_info          jsonb,
  compensation_type   text,
  resolution          text,
  evidence_urls       jsonb,
  agent_notes         text,
  handler_id          bigint,
  escalated_at        timestamptz,
  resolved_at        timestamptz,
  created_at          timestamptz,
  updated_at          timestamptz,
  -- computed summary
  event_count         bigint,
  last_event_at       timestamptz
)
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
begin
  return query
  select
    wo.id,
    wo.case_no,
    wo.category,
    wo.sub_category,
    wo.description,
    wo.risk_level,
    wo.status,
    wo.stage,
    wo.sla_status,
    wo.sla_deadline,
    wo.sla_target_hours as sla_hours,
    wo.store_info,
    wo.order_info,
    wo.compensation_type,
    wo.resolution,
    wo.evidence_urls,
    wo.agent_notes,
    wo.handler_id,
    wo.escalated_at,
    wo.resolved_at,
    wo.created_at,
    wo.updated_at,
    count(e.event_id)::bigint    as event_count,
    max(e.created_at)           as last_event_at
  from datafoundry.fsf_work_orders wo
  left join datafoundry.fsf_inngest_events e
    on e.payload->>'work_order_id' = wo.case_no
  where (p_category   is null or wo.category   = p_category)
    and (p_status     is null or wo.status     = p_status)
    and (p_risk_level is null or wo.risk_level = p_risk_level)
  group by wo.id
  order by wo.created_at desc
  limit p_limit;
end;
$$;

revoke all on function datafoundry.rpc_work_order_list(text,text,text,int) from public;
grant  execute on function datafoundry.rpc_work_order_list(text,text,text,int) to service_role;

commit;

-- ============================================================
-- 验证（A16.1 quick smoke）
-- ============================================================
-- select datafoundry.rpc_work_order_create(
--   p_category     => 'foreign_object_external',
--   p_description  => 'A16 SMOKE TEST — 餐具中发现塑料片',
--   p_risk_level   => 'medium',
--   p_store_name   => '测试门店-A16'
-- );

-- select case_no, status, risk_level, sla_deadline
-- from datafoundry.fsf_work_orders
-- where source = 'admin'
-- order by created_at desc limit 3;

-- select datafoundry.rpc_work_order_list(null, null, null, 3);
