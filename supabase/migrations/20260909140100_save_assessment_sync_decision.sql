-- 修复: save_assessment 同步 contacts.screening_decision（列表徽章数据源）
create or replace function public.save_assessment(
    p_candidate_id bigint,
    p_workspace_id bigint,
    p_scene_fit text,
    p_entity_fit text,
    p_audience_evidence text,
    p_content_scale_fit text,
    p_category_experience text,
    p_decision text,
    p_reason text,
    p_evidence text,
    p_open_questions text,
    p_brief_version int,
    p_data_version int,
    p_task_type text,
    p_task_due date
) returns bigint
language plpgsql
as $$
declare
    v_assessment_id bigint;
    v_is_dnc boolean;
begin
    -- 候选归属校验
    select (do_not_contact) into v_is_dnc
      from public.contacts where id = p_candidate_id and workspace_id = p_workspace_id;
    if v_is_dnc is null then
        raise exception 'candidate % not found in workspace %', p_candidate_id, p_workspace_id;
    end if;

    -- 按结论校验必填（PRD F3）
    if p_decision = 'priority_contact' then
        if v_is_dnc then raise exception 'candidate is marked do_not_contact'; end if;
        if p_reason is null or btrim(p_reason) = ''
           or p_evidence is null or btrim(p_evidence) = ''
           or p_scene_fit is distinct from 'yes'
           or p_task_type is null or p_task_due is null then
            raise exception 'priority_contact requires reason, evidence, scene_fit=yes, next task';
        end if;
    elsif p_decision = 'needs_info' then
        if v_is_dnc then raise exception 'candidate is marked do_not_contact'; end if;
        if p_open_questions is null or btrim(p_open_questions) = ''
           or p_task_type is null or p_task_due is null then
            raise exception 'needs_info requires open question and next task';
        end if;
    elsif p_decision = 'paused' then
        if p_reason is null or btrim(p_reason) = '' then
            raise exception 'paused requires reason';
        end if;
    else
        raise exception 'invalid decision %', p_decision;
    end if;

    -- 关闭原有 open 任务（取消，记录原因）
    update public.tasks
       set cancelled_at = now(),
           cancel_reason = 'replaced by new assessment (' || p_decision || ')'
     where contact_id = p_candidate_id
       and done_date is null and cancelled_at is null;

    -- 追加判断版本
    insert into public.assessment
        (candidate_id, workspace_id, scene_fit, entity_fit, audience_evidence,
         content_scale_fit, category_experience, decision, reason, evidence,
         open_questions, brief_version, data_version)
    values
        (p_candidate_id, p_workspace_id, p_scene_fit, p_entity_fit, p_audience_evidence,
         p_content_scale_fit, p_category_experience, p_decision, p_reason, p_evidence,
         p_open_questions, p_brief_version, p_data_version)
    returning id into v_assessment_id;

    -- 同步列表展示字段（contacts.screening_decision 为展示用冗余）
    update public.contacts
       set screening_decision = p_decision
     where id = p_candidate_id and workspace_id = p_workspace_id;

    -- 创建新 open 任务（暂缓不建任务；停止联系仅允许 review）
    if p_task_type is not null and p_task_due is not null then
        if v_is_dnc and p_task_type in ('first_contact', 'follow_up') then
            raise exception 'cannot create contact task for do_not_contact candidate';
        end if;
        insert into public.tasks (contact_id, type, text, due_date)
        values (p_candidate_id, p_task_type, coalesce(p_reason, ''), p_task_due::timestamptz);
    end if;

    return v_assessment_id;
end;
$$;
