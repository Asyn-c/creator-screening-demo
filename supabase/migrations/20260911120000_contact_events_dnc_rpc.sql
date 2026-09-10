-- M3/建联 UI: 联系事件记录/撤销 RPC + 停止联系设置/解除 RPC
-- 规则来源 PRD F4:
--   - 联系事件不接受未来时间; 撤销保留撤销时间, 统计排除已撤销记录
--   - 停止联系必须填原因; 自动取消未完成的联系/跟进任务(保留补资料/复核类)
--   - 停止联系期间仍允许补记历史事实(事件是事实, 不受 DNC 限制)
--   - 解除标记需再次填原因(界面确认; 原因用于确认动作本身, 历史事件已保留审计)

-- ============ 1. 记录联系事件 ============
create or replace function public.record_contact_event(
    p_candidate_id bigint,
    p_workspace_id bigint,
    p_type text,
    p_occurred_at timestamptz,
    p_note text
) returns bigint
language plpgsql
as $$
declare
    v_event_id bigint;
begin
    if p_type not in ('sent', 'replied') then
        raise exception 'invalid event type %', p_type;
    end if;
    if p_occurred_at is null then
        raise exception 'occurred_at is required';
    end if;
    if p_occurred_at > now() then
        raise exception 'future times are not accepted';
    end if;

    if not exists (
        select 1 from public.contacts
         where id = p_candidate_id and workspace_id = p_workspace_id
    ) then
        raise exception 'candidate % not found in workspace %', p_candidate_id, p_workspace_id;
    end if;

    insert into public.contact_events (candidate_id, workspace_id, type, occurred_at, note)
    values (p_candidate_id, p_workspace_id, p_type, p_occurred_at, p_note)
    returning id into v_event_id;
    return v_event_id;
end;
$$;

-- ============ 2. 撤销联系事件（幂等） ============
create or replace function public.void_contact_event(
    p_event_id bigint,
    p_candidate_id bigint,
    p_workspace_id bigint
) returns void
language plpgsql
as $$
begin
    update public.contact_events
       set voided_at = now()
     where id = p_event_id
       and candidate_id = p_candidate_id
       and workspace_id = p_workspace_id
       and voided_at is null;
end;
$$;

-- ============ 3. 设置停止联系（原因必填 + 取消联系/跟进类 open 任务） ============
create or replace function public.set_do_not_contact(
    p_candidate_id bigint,
    p_workspace_id bigint,
    p_reason text
) returns void
language plpgsql
as $$
begin
    if p_reason is null or btrim(p_reason) = '' then
        raise exception 'do_not_contact requires a reason';
    end if;

    update public.contacts
       set do_not_contact = true,
           do_not_contact_reason = p_reason,
           do_not_contact_at = now()
     where id = p_candidate_id and workspace_id = p_workspace_id;
    if not found then
        raise exception 'candidate % not found in workspace %', p_candidate_id, p_workspace_id;
    end if;

    -- 取消未完成的联系/跟进任务; 保留补资料/复核类（PRD F4）
    update public.tasks
       set cancelled_at = now(),
           cancel_reason = 'do_not_contact set'
     where contact_id = p_candidate_id
       and done_date is null and cancelled_at is null
       and type in ('first_contact', 'follow_up');
end;
$$;

-- ============ 4. 解除停止联系（再次确认 + 原因必填） ============
create or replace function public.unset_do_not_contact(
    p_candidate_id bigint,
    p_workspace_id bigint,
    p_reason text
) returns void
language plpgsql
as $$
begin
    if p_reason is null or btrim(p_reason) = '' then
        raise exception 'unsetting do_not_contact requires a reason';
    end if;

    update public.contacts
       set do_not_contact = false,
           do_not_contact_reason = null,
           do_not_contact_at = null
     where id = p_candidate_id and workspace_id = p_workspace_id;
    if not found then
        raise exception 'candidate % not found in workspace %', p_candidate_id, p_workspace_id;
    end if;
end;
$$;
