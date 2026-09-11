-- A20: 单条删除候选（确认范围 + 级联清理 + 空间隔离）
-- PRD §6.3: 明确列出将删除的内容并确认；事务内删除资料/判断/任务/事件；
-- assessment/contact_events/api_cache/tasks 对 contacts 均有 ON DELETE CASCADE，
-- 单条 DELETE 即原子完成级联；本 RPC 负责作用域校验并返回删除清单供 UI 提示。

create or replace function public.delete_candidate(
    p_candidate_id bigint,
    p_workspace_id bigint
) returns jsonb
language plpgsql
as $$
declare
    v_counts jsonb;
begin
    -- 作用域校验：跨空间/不存在的 id 一律拒绝
    if not exists (
        select 1 from public.contacts
         where id = p_candidate_id and workspace_id = p_workspace_id
    ) then
        raise exception 'candidate % not found in workspace %', p_candidate_id, p_workspace_id;
    end if;

    select jsonb_build_object(
        'assessments',    (select count(*) from public.assessment     where candidate_id = p_candidate_id),
        'contact_events', (select count(*) from public.contact_events where candidate_id = p_candidate_id),
        'tasks',          (select count(*) from public.tasks          where contact_id  = p_candidate_id),
        'api_cache',      (select count(*) from public.api_cache      where candidate_id = p_candidate_id)
    ) into v_counts;

    delete from public.contacts
     where id = p_candidate_id and workspace_id = p_workspace_id;

    return v_counts;
end;
$$;
