-- ============================================================
-- 009_corp_dingtalk.sql
-- A11: 钉钉 corp API 真实发送（agent_id / userid_list）
-- 依赖: 000 + 005 + 006
-- ============================================================

set search_path = datafoundry, public, extensions;
begin;

-- ============================================================
-- 0. HTTP helper functions（pg 16+ 内置 https.request）
-- ============================================================
create or replace function datafoundry.http_get_jsonb(u text)
returns jsonb
language plpgsql
as $$
declare
  resp text;
begin
  select content::text into resp
  from https.request(u, 'GET', null, null, null);
  return resp::jsonb;
exception when others then
  return jsonb_build_object('error', sqlerrm);
end $$;

create or replace function datafoundry.http_post_jsonb(u text, b jsonb)
returns jsonb
language plpgsql
as $$
declare
  resp text;
begin
  select content::text into resp
  from https.request(u, 'POST',
    jsonb_build_object('Content-Type', 'application/json'),
    null,
    b::text);
  return resp::jsonb;
exception when others then
  return jsonb_build_object('error', sqlerrm);
end $$;

-- ============================================================
-- 1. RPC: rpc_dingtalk_app_token
--    获取 access_token（有效期 2h，每次重新拿）
-- ============================================================
create or replace function datafoundry.rpc_dingtalk_app_token(
  p_app_key    text default null,
  p_app_secret text default null
)
returns jsonb
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
declare
  v_key    text := coalesce(p_app_key,    current_setting('app.settings.dingtalk_app_key',    true));
  v_secret text := coalesce(p_app_secret,  current_setting('app.settings.dingtalk_app_secret', true));
  v_url    text;
  v_resp   jsonb;
  v_token  text;
begin
  if v_key is null or v_secret is null then
    return jsonb_build_object('ok', false, 'error', 'DINGTALK_APP_KEY/APP_SECRET not configured');
  end if;

  v_url := 'https://oapi.dingtalk.com/gettoken?appkey=' || v_key || '&appsecret=' || v_secret;
  v_resp := datafoundry.http_get_jsonb(v_url);

  if (v_resp->>'errcode')::int != 0 then
    return jsonb_build_object('ok', false, 'error', v_resp->>'errmsg');
  end if;

  v_token := v_resp->>'access_token';
  return jsonb_build_object('ok', true, 'access_token', v_token);
end $$;

-- ============================================================
-- 2. RPC: rpc_corp_dingtalk_send
--    发钉钉企业内部消息（topapi/message/corpconversation/asyncsend_v2）
-- ============================================================
create or replace function datafoundry.rpc_corp_dingtalk_send(
  p_agent_id     int default null,
  p_userid_list   text default null,
  p_dept_id_list int  default null,
  p_msg_type     text default 'text',
  p_content      text default null,
  p_title        text default null,
  p_app_key      text default null,
  p_app_secret   text default null,
  p_correlation  jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = datafoundry, public, extensions
as $$
declare
  v_token    text;
  v_url      text;
  v_body     jsonb;
  v_resp     jsonb;
  v_task_id  bigint;
  v_errcode  int;
begin
  -- 拿 token
  v_resp := datafoundry.rpc_dingtalk_app_token(p_app_key, p_app_secret);
  if not (v_resp->>'ok')::bool then return v_resp; end if;
  v_token := v_resp->>'access_token';

  -- 构造消息体
  if p_msg_type = 'markdown' then
    v_body := jsonb_build_object(
      'msgtype', 'markdown',
      'markdown', jsonb_build_object(
        'title', coalesce(p_title, 'Food Safety Alert'),
        'text',  coalesce(p_content, '')
      )
    );
  else
    v_body := jsonb_build_object(
      'msgtype', 'text',
      'text', jsonb_build_object('content', coalesce(p_content, ''))
    );
  end if;

  -- 构造请求体
  v_body := jsonb_build_object(
    'agent_id',     coalesce(p_agent_id, 0),
    'userid_list',  p_userid_list,
    'dept_id_list', p_dept_id_list,
    'msg',          v_body
  );

  v_url := 'https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=' || v_token;
  v_resp := datafoundry.http_post_jsonb(v_url, v_body);

  v_errcode := coalesce((v_resp->>'errcode')::int, -1);

  if v_errcode != 0 then
    return jsonb_build_object(
      'ok', false,
      'error', coalesce(v_resp->>'errmsg', 'unknown'),
      'errcode', v_errcode,
      'task_id', null
    );
  end if;

  v_task_id := coalesce((v_resp->>'task_id')::bigint, 0);

  insert into datafoundry.dfd_audit_events
    (workspace_id, actor_id, category, severity, action, target, payload)
  values
    (null, null, 'corp_dingtalk_send', 'info', 'message_sent',
     coalesce(p_userid_list, 'dept:' || coalesce(p_dept_id_list, 0)::text),
     jsonb_build_object('task_id', v_task_id, 'agent_id', p_agent_id,
                        'correlation', p_correlation));

  return jsonb_build_object(
    'ok', true, 'task_id', v_task_id, 'errcode', v_errcode
  );
end $$;

-- ============================================================
-- 3. 权限
-- ============================================================
revoke all on function datafoundry.http_get_jsonb(text)           from public;
revoke all on function datafoundry.http_post_jsonb(text,jsonb)   from public;
revoke all on function datafoundry.rpc_dingtalk_app_token(text,text)      from public;
revoke all on function datafoundry.rpc_corp_dingtalk_send(int,text,int,text,text,text,text,text,jsonb) from public;

grant execute on function datafoundry.http_get_jsonb(text)           to service_role;
grant execute on function datafoundry.http_post_jsonb(text,jsonb)   to service_role;
grant execute on function datafoundry.rpc_dingtalk_app_token(text,text)      to service_role;
grant execute on function datafoundry.rpc_corp_dingtalk_send(int,text,int,text,text,text,text,text,jsonb) to service_role;

commit;