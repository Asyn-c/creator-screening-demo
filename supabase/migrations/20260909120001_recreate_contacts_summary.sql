-- M0/T02: contacts 加列后重建 contacts_summary 视图
-- 视图列集在创建时固定，co.* 不会自动包含后加的列（本仓库惯例见 20240807082449）
-- 定义与上游 20240807082449 保持一致，仅因新增列而重建

drop view if exists "public"."contacts_summary";

create view "public"."contacts_summary"
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
