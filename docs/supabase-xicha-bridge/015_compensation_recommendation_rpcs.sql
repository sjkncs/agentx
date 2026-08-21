-- ============================================================
-- 015_compensation_recommendation_rpcs.sql — A23.2 补偿方案推荐
--
-- 依赖: 003_food_safety_schema.sql（fsf_compensation_matrix 表已存在）
--       003_food_safety_schema.sql（fsf_work_orders 表已存在）
--
-- 规则：
--   rpc_compensation_recommend → 基于 (category, sub_category, risk_level) 查矩阵
--                               → 推荐 (recommended_type, min_amount, max_amount)
--   rpc_compensation_approve   → 管理员确认补偿后写入 wo + 审计日志
-- ============================================================

set search_path = datafoundry, public, extensions;
begin;

-- ============================================================
-- 1. rpc_compensation_recommend
--
--   输入: p_category, p_sub_category, p_risk_level, p_severity_score
--   输出: 推荐补偿方案 + 补偿区间 + 话术模板
--
--   逻辑:
--     ① 精确匹配 (category, sub_category, risk_level)
--     ② fallback: (category, risk_level)
--     ③ fallback: (category) 取风险最高那条
--     ④ 补充话术（来自 fsf_script_library）
-- ============================================================
create or replace function datafoundry.rpc_compensation_recommend(
  p_category      text,
  p_sub_category  text default null,
  p_risk_level    text default 'medium',
  p_severity_score int default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_row       record;
  v_script    text;
  v_amount    numeric;
  v_rec_type  text;
  v_reason    text;
  v_level     text;
begin
  -- ① 精确匹配
  select * into v_row
  from datafoundry.fsf_compensation_matrix m
  where m.category   = p_category
    and (p_sub_category is null or m.sub_category = p_sub_category)
    and m.risk_level = p_risk_level
    and m.active = true
  order by m.severity_score desc
  limit 1;

  -- ② fallback: category + risk_level
  if not found then
    select * into v_row
    from datafoundry.fsf_compensation_matrix m
    where m.category   = p_category
      and m.risk_level = p_risk_level
      and m.active = true
    order by m.severity_score desc
    limit 1;
  end if;

  -- ③ fallback: category
  if not found then
    select * into v_row
    from datafoundry.fsf_compensation_matrix m
    where m.category = p_category
      and m.active = true
    order by m.severity_score desc
    limit 1;
  end if;

  -- ④ fallback: default apology
  if not found then
    return jsonb_build_object(
      'ok',           true,
      'recommended',  false,
      'type',         'apology',
      'min_amount',   0,
      'max_amount',   0,
      'reason',       'no matching compensation rule — default apology',
      'script',       '非常抱歉给您带来不好的体验，我们会认真对待每一起反馈。'
    );
  end if;

  -- 取推荐话术（stage=compensate）
  begin
    select script_text into v_script
    from datafoundry.fsf_script_library
    where category = p_category and stage = 'compensate' and active = true
    limit 1;
  exception when others then
    v_script := null;
  end;

  -- 计算金额（可注入 severity_score 加权）
  v_rec_type := v_row.recommended_type;
  if p_severity_score is not null and p_severity_score > v_row.severity_score then
    v_amount := round(
      (v_row.min_amount + v_row.max_amount) / 2.0 * (1 + (p_severity_score - v_row.severity_score) * 0.1),
      2
    );
    v_amount := least(v_amount, (v_row.max_amount * 1.5)::numeric);
  else
    v_amount := (v_row.min_amount + v_row.max_amount) / 2.0;
  end if;

  v_reason := format(
    '%s 风险 %s，建议 %s 补偿 %.2f 元 (%s — %s)',
    p_category, p_risk_level, v_rec_type, v_amount,
    v_row.description, v_row.category
  );

  return jsonb_build_object(
    'ok',           true,
    'recommended',  true,
    'type',         v_rec_type,
    'min_amount',   v_row.min_amount,
    'max_amount',   v_row.max_amount,
    'recommended_amount', v_amount,
    'severity_score',    v_row.severity_score,
    'reason',       v_reason,
    'description',  v_row.description,
    'script',       v_script
  );
end;
$$;

revoke all on function datafoundry.rpc_compensation_recommend(text, text, text, int) from public;
grant execute on function datafoundry.rpc_compensation_recommend(text, text, text, int)
  to authenticated, service_role;

-- ============================================================
-- 2. rpc_compensation_approve
--
--   调用方：admin-wo-stage-dialog.tsx（resolution 阶段确认补偿方案）
--   输入: p_case_no, p_compensation_type, p_compensation_amount, p_resolution, p_handler_id
--   效果: 更新 wo + 写审计日志
-- ============================================================
create or replace function datafoundry.rpc_compensation_approve(
  p_case_no             text,
  p_compensation_type   text,       -- 'voucher' | 'redelivery' | 'refund' | 'apology' | 'none'
  p_compensation_amount numeric default null,
  p_resolution          text default null,
  p_handler_id          bigint default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_wo_id bigint;
  v_now   timestamptz := now();
begin
  -- 验证工单
  select id into v_wo_id
  from datafoundry.fsf_work_orders
  where case_no = p_case_no;

  if v_wo_id is null then
    return jsonb_build_object('ok', false, 'error', 'work order not found: ' || p_case_no);
  end if;

  -- 更新工单
  update datafoundry.fsf_work_orders
  set compensation_type = p_compensation_type,
      compensation_detail = jsonb_build_object(
        'amount',    p_compensation_amount,
        'approved_at', v_now,
        'approved_by', p_handler_id
      ),
      resolution = coalesce(p_resolution, resolution),
      stage      = 'resolution',
      status     = 'resolved',
      resolved_at = v_now,
      updated_at  = v_now
  where case_no = p_case_no;

  -- 审计日志
  insert into datafoundry.dfd_audit_events
    (workspace_id, actor_id, category, severity, action, target, payload, created_at)
  values (
    'heytea-bj',
    p_handler_id,
    'fsf_work_order',
    'warning',
    'compensation.approved',
    p_case_no,
    jsonb_build_object(
      'compensation_type',  p_compensation_type,
      'compensation_amount', p_compensation_amount,
      'resolution',         p_resolution
    ),
    v_now
  );

  -- 插入事件
  insert into datafoundry.fsf_inngest_events
    (event_id, event_name, source, status, payload)
  values (
    gen_random_uuid()::text,
    'work_order.compensation_approved',
    'rpc_compensation_approve',
    'pending',
    jsonb_build_object(
      'work_order_id', v_wo_id,
      'case_no',       p_case_no,
      'compensation_type',  p_compensation_type,
      'amount',         p_compensation_amount,
      'handler_id',    p_handler_id
    )
  );

  return jsonb_build_object(
    'ok',         true,
    'case_no',    p_case_no,
    'amount',     p_compensation_amount,
    'approved_at', v_now
  );
end;
$$;

revoke all on function datafoundry.rpc_compensation_approve(text, text, numeric, text, bigint) from public;
grant execute on function datafoundry.rpc_compensation_approve(text, text, numeric, text, bigint)
  to authenticated, service_role;

-- ============================================================
-- 3. rpc_compensation_stats
--
--   统计报表：各 category/risk_level 的补偿金额分布
--   用于 admin dashboard
-- ============================================================
create or replace function datafoundry.rpc_compensation_stats(
  p_workspace_id text default 'heytea-bj',
  p_days         int  default 30
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_result jsonb;
begin
  with stats as (
    select
      wo.category,
      wo.risk_level,
      wo.compensation_type,
      count(*)                                           as wo_count,
      count(*) filter (where wo.compensation_detail->>'amount' is not null) as comp_with_amount,
      avg((wo.compensation_detail->>'amount')::numeric) as avg_amount,
      sum((wo.compensation_detail->>'amount')::numeric) as total_amount
    from datafoundry.fsf_work_orders wo
    where wo.created_at >= now() - (p_days || ' days')::interval
      and wo.status in ('resolved', 'closed')
      and wo.compensation_type is not null
    group by cube (wo.category, wo.risk_level, wo.compensation_type)
    order by total_amount desc nulls last
  )
  select jsonb_agg(row_to_json(stats)) into v_result from stats;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

revoke all on function datafoundry.rpc_compensation_stats(text, int) from public;
grant execute on function datafoundry.rpc_compensation_stats(text, int) to authenticated, service_role;

commit;
