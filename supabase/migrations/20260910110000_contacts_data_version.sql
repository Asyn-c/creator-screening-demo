-- M2/最小接入: contacts.data_version（外部资料版本，刷新成功递增）
-- 旧判断复核规则: assessment.data_version < contacts.data_version → 待复核
-- 加列必须同步重建 contacts_summary（列集创建时定死，DECISIONS D2），并保持 security_invoker=on

alter table "public"."contacts"
  add column if not exists "data_version" int not null default 0;

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
