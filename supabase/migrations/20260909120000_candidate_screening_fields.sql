-- M0/T02: 达人初筛字段（单操作者演示版）
-- 依据: 开发计划§3「一对一领域扩展」最小实现——M0 先直接扩展 contacts 表验证改造路径，
-- M1 落 workspace/api_cache/assessment 时再评估是否拆一对一扩展表（见 docs/DECISIONS.md）。

alter table "public"."contacts"
  add column if not exists "channel_input" text,
  add column if not exists "channel_id" text,
  add column if not exists "screening_decision" text default 'unassessed',
  add column if not exists "screening_reason" text;

comment on column "public"."contacts"."channel_input" is '原始导入入口(频道URL/handle/ID)，M0 验证字段';
comment on column "public"."contacts"."channel_id" is '规范频道ID(UC...)，演示期全局唯一，正式候选必须有';
comment on column "public"."contacts"."screening_decision" is '初筛结论: unassessed|priority_contact|needs_info|paused';
comment on column "public"."contacts"."screening_reason" is '初筛理由/证据摘要(人工填写)';

-- 同一频道只允许一条候选记录（channel_id 非空时唯一）
create unique index if not exists contacts_channel_id_uniq
  on public.contacts (channel_id) where channel_id is not null;

-- 存量记录回填默认结论
update public.contacts set screening_decision = 'unassessed' where screening_decision is null;
