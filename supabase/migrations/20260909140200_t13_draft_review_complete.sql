-- M1/T13+T14: 草稿持久化、评估版本去重、任务语义修正、完成任务 RPC
-- 1) contacts.assessment_draft: 用户草稿与已提交评估分离；提交成功由 RPC 清除；
--    草稿不触碰 screening_decision / 不进入可行动名单（PRD §4.1 补充约定）
-- 2) save_assessment v3:
--    - 内容与最新版本完全一致且非显式复核时不追加版本（PRD F3：未改变内容的重复保存不创建新版本）
--    - 任务语义修正:未提供新任务时保留原 open 任务（修复「确认仍适用」会失败/误取消任务的两个缺陷）；
--      仅暂缓取消 open 任务；提供新任务时仍为「取消旧+建新」原子替换
--    - 提交成功清除草稿
-- 3) complete_task: 完成当前 open 任务 + 可选下一步（同事务；重复请求幂等）
-- 4) contacts_summary 重建（contacts 加列必须重建视图，列集创建时定死，见 DECISIONS D2），
--    并恢复 security_invoker = on（与声明式 schema 03_views.sql 对齐）

-- ============ 1. 草稿列 ============
alter table "public"."contacts"
  add column if not exists "assessment_draft" jsonb;

-- ============ 2. save_assessment v3 ============
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
    p_task_due date,
    p_force_version boolean default false
) returns bigint
language plpgsql
as $$
declare
    v_assessment_id bigint;
    v_is_dnc boolean;
    v_latest public.assessment;
    v_open_task public.tasks;
    v_is_duplicate boolean;
begin
    -- 候选归属校验
    select (do_not_contact) into v_is_dnc
      from public.contacts where id = p_candidate_id and workspace_id = p_workspace_id;
    if v_is_dnc is null then
        raise exception 'candidate % not found in workspace %', p_candidate_id, p_workspace_id;
    end if;

    if p_task_type is not null and p_task_type not in ('collect_info','first_contact','follow_up','review') then
        raise exception 'invalid task type %', p_task_type;
    end if;
    if p_task_type is not null and p_task_due is null then
        raise exception 'task type % requires due date', p_task_type;
    end if;

    -- 当前 open 任务与最新已提交版本
    select * into v_open_task from public.tasks
     where contact_id = p_candidate_id and done_date is null and cancelled_at is null
     order by id limit 1;
    select * into v_latest from public.assessment
     where candidate_id = p_candidate_id
     order by created_at desc, id desc
     limit 1;

    -- 按结论校验必填（PRD F3）。下一步任务：提供即校验完整；未提供时要求已有 open 任务兜底
    if p_decision = 'priority_contact' then
        if v_is_dnc then raise exception 'candidate is marked do_not_contact'; end if;
        if p_reason is null or btrim(p_reason) = ''
           or p_evidence is null or btrim(p_evidence) = ''
           or p_scene_fit is distinct from 'yes' then
            raise exception 'priority_contact requires reason, evidence, scene_fit=yes';
        end if;
        if p_task_type is null and v_open_task.id is null then
            raise exception 'priority_contact requires next task';
        end if;
    elsif p_decision = 'needs_info' then
        if v_is_dnc then raise exception 'candidate is marked do_not_contact'; end if;
        if p_open_questions is null or btrim(p_open_questions) = '' then
            raise exception 'needs_info requires open question';
        end if;
        if p_task_type is null and v_open_task.id is null then
            raise exception 'needs_info requires next task';
        end if;
    elsif p_decision = 'paused' then
        if p_reason is null or btrim(p_reason) = '' then
            raise exception 'paused requires reason';
        end if;
    else
        raise exception 'invalid decision %', p_decision;
    end if;

    -- 版本追加判定：内容与最新已提交版本完全一致且非显式复核 → 不追加（PRD F3）
    -- 注意:组合类型 `IS NOT NULL` 要求所有字段非空(evidence 可为 null),必须用主键判存在
    v_is_duplicate := v_latest.id is not null
       and not p_force_version
       and v_latest.decision = p_decision
       and v_latest.scene_fit is not distinct from p_scene_fit
       and v_latest.entity_fit is not distinct from p_entity_fit
       and v_latest.audience_evidence is not distinct from p_audience_evidence
       and v_latest.content_scale_fit is not distinct from p_content_scale_fit
       and v_latest.category_experience is not distinct from p_category_experience
       and v_latest.reason is not distinct from p_reason
       and v_latest.evidence is not distinct from p_evidence
       and v_latest.open_questions is not distinct from p_open_questions
       and v_latest.brief_version is not distinct from p_brief_version
       and v_latest.data_version is not distinct from p_data_version;

    -- 任务处理：
    --   暂缓 → 取消原 open 任务（PRD F3 暂缓联动）
    --   提供新任务 → 与现有 open 任务(type+日期)相同则不动，否则取消旧+建新（原子替换）
    --   未提供任务 → 保留原 open 任务（不动）
    if p_decision = 'paused' then
        if v_open_task.id is not null then
            update public.tasks
               set cancelled_at = now(),
                   cancel_reason = 'assessment paused'
             where id = v_open_task.id;
        end if;
    elsif p_task_type is not null and p_task_due is not null then
        if v_open_task.id is null
           or v_open_task.type is distinct from p_task_type
           or (v_open_task.due_date at time zone 'utc')::date is distinct from p_task_due then
            if v_open_task.id is not null then
                update public.tasks
                   set cancelled_at = now(),
                       cancel_reason = 'replaced by new assessment (' || p_decision || ')'
                 where id = v_open_task.id;
            end if;
            if v_is_dnc and p_task_type in ('first_contact', 'follow_up') then
                raise exception 'cannot create contact task for do_not_contact candidate';
            end if;
            insert into public.tasks (contact_id, type, text, due_date)
            values (p_candidate_id, p_task_type, coalesce(p_reason, ''), p_task_due::timestamptz);
        end if;
    end if;

    -- 内容未变：清草稿、同步展示字段，不追加版本也不重置任务
    if v_is_duplicate then
        update public.contacts
           set screening_decision = p_decision,
               assessment_draft = null
         where id = p_candidate_id and workspace_id = p_workspace_id;
        return v_latest.id;
    end if;

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

    -- 同步列表展示字段并清除草稿（提交成功）
    update public.contacts
       set screening_decision = p_decision,
           assessment_draft = null
     where id = p_candidate_id and workspace_id = p_workspace_id;

    return v_assessment_id;
end;
$$;

-- ============ 3. complete_task（完成任务 + 可选下一步，同事务；幂等） ============
create or replace function public.complete_task(
    p_task_id bigint,
    p_candidate_id bigint,
    p_workspace_id bigint,
    p_next_type text default null,
    p_next_due date default null,
    p_next_note text default null
) returns void
language plpgsql
as $$
declare
    v_is_dnc boolean;
begin
    -- 候选归属校验
    select (do_not_contact) into v_is_dnc
      from public.contacts where id = p_candidate_id and workspace_id = p_workspace_id;
    if v_is_dnc is null then
        raise exception 'candidate % not found in workspace %', p_candidate_id, p_workspace_id;
    end if;

    -- 任务必须属于该候选且处于 open 状态；否则幂等返回（双击/网络重试不产生第二次变更）
    if not exists (
        select 1 from public.tasks
         where id = p_task_id and contact_id = p_candidate_id
           and done_date is null and cancelled_at is null
    ) then
        return;
    end if;

    if p_next_type is not null then
        if p_next_type not in ('collect_info','first_contact','follow_up','review') then
            raise exception 'invalid task type %', p_next_type;
        end if;
        if p_next_due is null then
            raise exception 'next task type % requires due date', p_next_type;
        end if;
        if v_is_dnc and p_next_type in ('first_contact', 'follow_up') then
            raise exception 'cannot create contact task for do_not_contact candidate';
        end if;
    end if;

    update public.tasks set done_date = now() where id = p_task_id;

    if p_next_type is not null and p_next_due is not null then
        insert into public.tasks (contact_id, type, text, due_date)
        values (p_candidate_id, p_next_type, coalesce(p_next_note, ''), p_next_due::timestamptz);
    end if;
end;
$$;

-- ============ 4. contacts_summary 重建（加列后必须重建；恢复 security_invoker） ============
drop view if exists "public"."contacts_summary";

create view "public"."contacts_summary" with (security_invoker = on)
as
select
    co.*,
    c.name as company_name,
    count(distinct t.id) as nb_tasks
from
    "public"."contacts" co
left join
    "public"."tasks" t on co.id = t.contact_id
left join
    "public"."companies" c on co.company_id = c.id
group by
    co.id, c.name;
