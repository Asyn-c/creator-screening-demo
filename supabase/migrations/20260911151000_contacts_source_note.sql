-- 方案A/Nox CSV 桥: contacts.source_note 来源备注列
-- 用途: 外部工具(Nox/Modash等)导出的结论性数据以备注形式挂到候选，不进原始缓存
-- PRD F1: 再导入已有候选不覆盖评估；新增来源备注需用户确认追加
-- F5 导出 17 字段中 source_note 列由本列填充（此前恒为空）
-- 加列必须重建 contacts_summary（D2 惯例，保持 security_invoker=on）

alter table "public"."contacts"
  add column if not exists "source_note" text;

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
