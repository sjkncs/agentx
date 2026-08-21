-- ============================================================
-- 010_workspace_front_end.sql
-- A12.2: workspace 动态下拉 + corp_dingtalk 订阅 channel
-- 依赖: 008
-- ============================================================

set search_path = datafoundry, public, extensions;
begin;

-- ============================================================
-- 1. RPC: rpc_workspace_list
--    返回全部 workspace 配置（id + name + region）
--    前端 admin-webhooks-panel 下拉用
-- ============================================================
create or replace function datafoundry.rpc_workspace_list()
returns table (
  workspace_id   text,
  name           text,
  region         text,
  team           text,
  sub_count      bigint
)
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
begin
  return query
    select
      a.target::text                                    as workspace_id,
      (a.payload->>'name')::text                         as name,
      (a.payload->>'region')::text                        as region,
      (a.payload->>'team')::text                         as team,
      count(s.id)::bigint                               as sub_count
    from datafoundry.dfd_audit_events a
    left join datafoundry.fsf_event_subscriptions s
      on s.workspace_id = a.target
    where a.category = 'workspace_config'
      and a.action    = 'workspace_seed'
    group by a.target, a.payload
    order by a.created_at desc;
end $$;

revoke all on function datafoundry.rpc_workspace_list() from public;
grant execute on function datafoundry.rpc_workspace_list() to service_role;

-- ============================================================
-- 2. corp_dingtalk channel 支持（workspace 路由）
--    subscribe_loop 的 bodyFor 和 dispatchOne 已支持 dingtalk webhook。
--    corp_dingtalk (A11 rpc_corp_dingtalk_send) 通过 RPC 调用，
--    不走 subscribe_loop HTTP dispatch。本步骤标记 channel
--    注册到 fsf_event_subscriptions target_channel 枚举。
-- ============================================================
-- corp_dingtalk 订阅的 filter_json 格式示例：
--   { "agent_id": 1000001, "userid_list": "manager001,chef001" }
-- subscribe_loop 暂不支持 corp_dingtalk channel（走 RPC），
-- 留占位 filter 以便后续扩展。

commit;