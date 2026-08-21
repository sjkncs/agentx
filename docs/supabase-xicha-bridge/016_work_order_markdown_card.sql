-- ============================================================
-- 016_work_order_markdown_card.sql — A24.1 钉钉 Markdown 卡片 RPC
--
-- 依赖: 003_food_safety_schema.sql（fsf_work_orders 表已存在）
--       014_sla_escalation_rpcs.sql（fsf_inngest_events 已存在）
--
-- 生成格式化的 Markdown 文本，用于钉钉 Markdown 消息卡片。
-- 直接嵌入 subscribe_loop 的 bodyFor()。
-- ============================================================

set search_path = datafoundry, public, extensions;
begin;

-- ============================================================
-- 1. rpc_work_order_markdown_card
--
--   输入: p_case_no
--   输出: 钉钉 Markdown 格式字符串（title + sections）
--
--   样式规范：
--     ## 标题
--     > 关键信息（风险等级、状态）
--     | 字段 | 值 |
--     | 字段 | 值 |
--     ### 时间线
--     ### 门店信息
-- ============================================================
create or replace function datafoundry.rpc_work_order_markdown_card(
  p_case_no text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_wo record;
  v_cat_label  text;
  v_risk_icon  text;
  v_sla_icon   text;
  v_stage_icon text;
  v_md_title   text;
  v_md_sections text[];
  v_now        timestamptz := now();
begin
  select * into v_wo
  from datafoundry.fsf_work_orders wo
  where wo.case_no = p_case_no;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'work order not found: ' || p_case_no);
  end if;

  -- 标签映射
  v_cat_label := case v_wo.category
    when 'foreign_object_external' then '外源性异物（外部）'
    when 'foreign_object_internal' then '外源性异物（内部）'
    when 'spoilage'               then '变质'
    when 'body_discomfort'        then '身体不适'
    when 'taste_issue'            then '口味问题'
    else v_wo.category
  end;

  v_risk_icon := case v_wo.risk_level
    when 'high'   then '🔴 高风险'
    when 'medium' then '🟡 中风险'
    when 'low'    then '🟢 低风险'
    else '⚪ ' || v_wo.risk_level
  end;

  v_sla_icon := case v_wo.sla_status
    when 'breached' then '⏰ SLA 已超时！'
    when 'warning'  then '⚠️ SLA 预警'
    when 'ok'       then '✅ SLA 正常'
    else '⚪ ' || coalesce(v_wo.sla_status, 'n/a')
  end;

  v_stage_icon := case v_wo.stage
    when 'reported'      then '📋 已报告'
    when 'triage'        then '🔍 分诊中'
    when 'investigation' then '⚙️ 调查中'
    when 'resolution'    then '✅ 补偿处理'
    when 'closed'        then '🔒 已关闭'
    else '📝 ' || coalesce(v_wo.stage, 'n/a')
  end;

  v_md_title := case v_wo.status
    when 'escalated'   then '🚨 【紧急升级】食品安全工单'
    when 'breached'    then '⏰ 【SLA 超时】食品安全工单'
    when 'warning'     then '⚠️ 【SLA 预警】食品安全工单'
    when 'investigating' then '🔍 【处理中】食品安全工单'
    when 'resolved'    then '✅ 【已解决】食品安全工单'
    when 'closed'      then '🔒 【已关闭】食品安全工单'
    else '📋 食品安全工单'
  end;

  -- 组装 sections
  v_md_sections := array[
    -- 基础信息
    '## ' || v_md_title,
    '',
    '> **' || v_wo.case_no || '**  |  ' || v_risk_icon || '  |  ' || v_stage_icon,
    '',

    -- 摘要表格
    '| 项目 | 内容 |',
    '|---|---|',
    '| 工单号 | **' || v_wo.case_no || '** |',
    '| 问题类别 | ' || v_cat_label || coalesce(' / ' || v_wo.sub_category, '') || ' |',
    '| 风险等级 | ' || v_risk_icon || ' |',
    '| 当前阶段 | ' || v_stage_icon || ' |',
    '| SLA 状态 | ' || v_sla_icon || ' |',
    '| 创建时间 | ' || to_char(v_wo.created_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') || ' |',
    coalesce('| SLA 截止 | ' || to_char(v_wo.sla_deadline at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI'), '| SLA 截止 | — |'),
    coalesce('| 升级时间 | ' || to_char(v_wo.escalated_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI'), '| 升级时间 | — |'),
    coalesce('| 解决时间 | ' || to_char(v_wo.resolved_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI'), '| 解决时间 | — |'),
    '',

    -- 问题描述
    '### 问题描述',
    v_wo.description,
    ''
  ]::text[];

  -- 门店/订单信息
  if v_wo.store_info is not null then
    v_md_sections := v_md_sections ||
      array[
        '### 门店信息',
        '| 门店 ID | ' || coalesce((v_wo.store_info->>'store_id')::text, '—') || ' |',
        '| 门店名称 | ' || coalesce((v_wo.store_info->>'store_name')::text, '—') || ' |',
        coalesce('| 区域 | ' || (v_wo.store_info->>'region')::text, '| 区域 | — |'),
        coalesce('| 地址 | ' || (v_wo.store_info->>'address')::text, '| 地址 | — |'),
        ''
      ];
  end if;

  if v_wo.order_info is not null then
    v_md_sections := v_md_sections ||
      array[
        '### 订单信息',
        '| 订单号 | ' || coalesce((v_wo.order_info->>'order_no')::text, '—') || ' |',
        coalesce('| 金额 | ¥' || (v_wo.order_info->>'amount')::text, '| 金额 | — |'),
        coalesce('| 购买时间 | ' || (v_wo.order_info->>'created_at')::text, '| 购买时间 | — |'),
        ''
      ];
  end if;

  -- 补偿信息
  if v_wo.compensation_type is not null then
    v_md_sections := v_md_sections ||
      array[
        '### 补偿方案',
        '| 补偿方式 | ' || v_wo.compensation_type || ' |',
        coalesce('| 补偿金额 | ¥' || (v_wo.compensation_detail->>'amount')::text || ' |', '| 补偿金额 | — |'),
        coalesce('| 处理结果 | ' || v_wo.resolution, '| 处理结果 | — |'),
        ''
      ];
  end if;

  -- AI 备注
  if v_wo.agent_notes is not null then
    v_md_sections := v_md_sections ||
      array[
        '### AI 处理备注',
        '> ' || replace(v_wo.agent_notes, E'\n', E'\n> ') || '',
        ''
      ];
  end if;

  -- footer
  v_md_sections := v_md_sections || array[
    '---',
    '> DataFoundry × 喜茶食安系统 | ' || to_char(v_now at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS')
  ];

  return jsonb_build_object(
    'ok',         true,
    'case_no',    p_case_no,
    'title',      v_md_title,
    'markdown',   array_to_string(v_md_sections, E'\n')
  );
end;
$$;

revoke all on function datafoundry.rpc_work_order_markdown_card(text) from public;
grant execute on function datafoundry.rpc_work_order_markdown_card(text)
  to authenticated, service_role;

-- ============================================================
-- 2. rpc_work_order_digest_card  (简洁摘要，用于通知标题)
--
--   单行摘要，适合钉钉通知摘要行
-- ============================================================
create or replace function datafoundry.rpc_work_order_digest_card(
  p_case_no text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_wo      record;
  v_cat_label text;
  v_risk_icon text;
  v_summary text;
begin
  select * into v_wo
  from datafoundry.fsf_work_orders
  where case_no = p_case_no;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not found');
  end if;

  v_cat_label := case v_wo.category
    when 'foreign_object_external' then '外源异物'
    when 'foreign_object_internal' then '内源异物'
    when 'spoilage'               then '变质'
    when 'body_discomfort'        then '身体不适'
    when 'taste_issue'           then '口味问题'
    else v_wo.category
  end;

  v_risk_icon := case v_wo.risk_level
    when 'high'   then '🔴'
    when 'medium' then '🟡'
    when 'low'    then '🟢'
    else '⚪'
  end;

  v_summary := format(
    '%s %s [%s] — %s %s %s',
    case v_wo.status
      when 'escalated'   then '🚨 升级'
      when 'breached'    then '⏰ 超时'
      when 'warning'     then '⚠️ 预警'
      when 'resolved'    then '✅ 已解决'
      else '📋'
    end,
    v_risk_icon,
    v_cat_label,
    v_wo.case_no,
    coalesce(v_wo.sub_category || ' ', ''),
    v_wo.description
  );

  return jsonb_build_object(
    'ok',      true,
    'case_no', p_case_no,
    'summary', v_summary
  );
end;
$$;

revoke all on function datafoundry.rpc_work_order_digest_card(text) from public;
grant execute on function datafoundry.rpc_work_order_digest_card(text)
  to authenticated, service_role;

commit;
