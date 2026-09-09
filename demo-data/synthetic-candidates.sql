-- T11: 示例体验模式种子——10 位合成候选（demo workspace）
-- 全部数据为自制演示材料：channel_id 使用 demo: 前缀，绝不请求 YouTube 接口
-- 幂等：可重复执行（先清 demo 空间业务数据）

DO $$
DECLARE
    v_demo_ws bigint;
    v_sales_id bigint;
    v_c01 bigint; v_c02 bigint; v_c03 bigint; v_c04 bigint; v_c05 bigint;
    v_c06 bigint; v_c07 bigint; v_c08 bigint; v_c09 bigint; v_c10 bigint;
BEGIN
    SELECT id INTO v_demo_ws FROM public.workspace WHERE mode = 'demo' LIMIT 1;
    SELECT sales_id INTO v_sales_id FROM public.workspace WHERE id = v_demo_ws;

    -- 清理旧演示数据（幂等）
    DELETE FROM public.api_cache WHERE workspace_id = v_demo_ws;
    DELETE FROM public.contact_events WHERE workspace_id = v_demo_ws;
    DELETE FROM public.assessment WHERE workspace_id = v_demo_ws;
    DELETE FROM public.tasks WHERE contact_id IN (SELECT id FROM public.contacts WHERE workspace_id = v_demo_ws);
    DELETE FROM public.contacts WHERE workspace_id = v_demo_ws;

    -- 任务背景升版：制造 demo:10 的「待复核」场景
    UPDATE public.workspace SET brief_version = 2, product = '激光水平仪/测距仪',
        scene = 'DIY、装修、测量', market = '美国/加拿大' WHERE id = v_demo_ws;

    -- ========== 10 位合成候选 ==========
    INSERT INTO public.contacts (workspace_id, sales_id, first_name, channel_input, channel_id, screening_decision)
    VALUES (v_demo_ws, v_sales_id, '【演示】山林工坊 DIY', 'demo:01', 'demo:01', 'unassessed') RETURNING id INTO v_c01;
    INSERT INTO public.contacts (workspace_id, sales_id, first_name, channel_input, channel_id, screening_decision)
    VALUES (v_demo_ws, v_sales_id, '【演示】Builder 小站', 'demo:02', 'demo:02', 'unassessed') RETURNING id INTO v_c02;
    INSERT INTO public.contacts (workspace_id, sales_id, first_name, channel_input, channel_id, screening_decision)
    VALUES (v_demo_ws, v_sales_id, '【演示】ProTool 官方频道', 'demo:03', 'demo:03', 'unassessed') RETURNING id INTO v_c03;
    INSERT INTO public.contacts (workspace_id, sales_id, first_name, channel_input, channel_id, screening_decision)
    VALUES (v_demo_ws, v_sales_id, '【演示】工具测评实验室', 'demo:04', 'demo:04', 'unassessed') RETURNING id INTO v_c04;
    INSERT INTO public.contacts (workspace_id, sales_id, first_name, channel_input, channel_id, screening_decision)
    VALUES (v_demo_ws, v_sales_id, '【演示】老屋改造记', 'demo:05', 'demo:05', 'unassessed') RETURNING id INTO v_c05;
    INSERT INTO public.contacts (workspace_id, sales_id, first_name, channel_input, channel_id, screening_decision)
    VALUES (v_demo_ws, v_sales_id, '【演示】美食厨房日记', 'demo:06', 'demo:06', 'paused') RETURNING id INTO v_c06;
    INSERT INTO public.contacts (workspace_id, sales_id, first_name, channel_input, channel_id, screening_decision)
    VALUES (v_demo_ws, v_sales_id, '【演示】周末修理工', 'demo:07', 'demo:07', 'unassessed') RETURNING id INTO v_c07;
    INSERT INTO public.contacts (workspace_id, sales_id, first_name, channel_input, channel_id, screening_decision)
    VALUES (v_demo_ws, v_sales_id, '【演示】创客工坊 Max', 'demo:08', 'demo:08', 'unassessed') RETURNING id INTO v_c08;
    INSERT INTO public.contacts (workspace_id, sales_id, first_name, channel_input, channel_id, screening_decision, do_not_contact, do_not_contact_reason, do_not_contact_at)
    VALUES (v_demo_ws, v_sales_id, '【演示】海外工具哥', 'demo:09', 'demo:09', 'needs_info', true, '【演示】过往合作条款分歧，暂停触达', now() - interval '10 days') RETURNING id INTO v_c09;
    INSERT INTO public.contacts (workspace_id, sales_id, first_name, channel_input, channel_id, screening_decision)
    VALUES (v_demo_ws, v_sales_id, '【演示】新晋工具Up主', 'demo:10', 'demo:10', 'needs_info') RETURNING id INTO v_c10;

    -- ========== api_cache 合成资料（source 全部标注 synthetic） ==========
    -- demo:01 场景适配证据充分，受众/报价未知
    INSERT INTO public.api_cache (candidate_id, workspace_id, kind, raw, source, fetched_at, expires_at)
    VALUES (v_c01, v_demo_ws, 'channel', '{"title":"山林工坊 DIY","description":"每周更新木工与装修实测视频","subscriber_count":32000,"country":"US"}', 'synthetic', now() - interval '1 day', now() + interval '30 days');
    INSERT INTO public.api_cache (candidate_id, workspace_id, kind, raw, source, fetched_at, expires_at)
    VALUES (v_c01, v_demo_ws, 'video', ('{"title":"挂墙找平实测：激光水平仪 3 个使用技巧","published_at":"' || (now() - interval '5 days')::text || '","view_count":12000,"like_count":740,"comment_count":96}')::jsonb, 'synthetic', now() - interval '1 day', now() + interval '30 days');
    INSERT INTO public.api_cache (candidate_id, workspace_id, kind, raw, source, fetched_at, expires_at)
    VALUES (v_c01, v_demo_ws, 'video', ('{"title":"车库改造 Vlog：全屋家具自制","published_at":"' || (now() - interval '19 days')::text || '","view_count":8600,"like_count":410,"comment_count":52}')::jsonb, 'synthetic', now() - interval '1 day', now() + interval '30 days');

    -- demo:02 主体和受众资料不足（订阅数缺失=未知）
    INSERT INTO public.api_cache (candidate_id, workspace_id, kind, raw, source, fetched_at, expires_at)
    VALUES (v_c02, v_demo_ws, 'channel', '{"title":"Builder 小站","description":"内容较杂：装修/搬家/生活记录","country":null}', 'synthetic', now() - interval '1 day', now() + interval '30 days');

    -- demo:03 品牌自营频道（描述明示官方，人工判断不自动淘汰）
    INSERT INTO public.api_cache (candidate_id, workspace_id, kind, raw, source, fetched_at, expires_at)
    VALUES (v_c03, v_demo_ws, 'channel', '{"title":"ProTool 官方频道","description":"ProTools 品牌官方频道，发布产品官方演示","subscriber_count":150000,"country":"US"}', 'synthetic', now() - interval '1 day', now() + interval '30 days');

    -- demo:04 部分统计缺失 + 原始 0 值（未知与 0 分开展示）
    INSERT INTO public.api_cache (candidate_id, workspace_id, kind, raw, source, fetched_at, expires_at)
    VALUES (v_c04, v_demo_ws, 'channel', '{"title":"工具测评实验室","subscriber_count":42000,"country":"US"}', 'synthetic', now() - interval '1 day', now() + interval '30 days');
    INSERT INTO public.api_cache (candidate_id, workspace_id, kind, raw, source, fetched_at, expires_at)
    VALUES (v_c04, v_demo_ws, 'video', ('{"title":"五款激光水平仪横评","published_at":"' || (now() - interval '9 days')::text || '","view_count":0,"like_count":0}')::jsonb, 'synthetic', now() - interval '1 day', now() + interval '30 days');
    INSERT INTO public.api_cache (candidate_id, workspace_id, kind, raw, source, fetched_at, expires_at)
    VALUES (v_c04, v_demo_ws, 'video', ('{"title":"测距仪开箱","published_at":"' || (now() - interval '24 days')::text || '","view_count":7300}')::jsonb, 'synthetic', now() - interval '1 day', now() + interval '30 days');

    -- demo:05 没有可展示的近期视频（0 条内容）
    INSERT INTO public.api_cache (candidate_id, workspace_id, kind, raw, source, fetched_at, expires_at)
    VALUES (v_c05, v_demo_ws, 'channel', '{"title":"老屋改造记","subscriber_count":18000,"country":"US"}', 'synthetic', now() - interval '1 day', now() + interval '30 days');

    -- demo:06 场景不适配（美食内容）——已保存暂缓判断
    INSERT INTO public.api_cache (candidate_id, workspace_id, kind, raw, source, fetched_at, expires_at)
    VALUES (v_c06, v_demo_ws, 'channel', '{"title":"美食厨房日记","description":"家常菜谱与烘焙教程","subscriber_count":96000,"country":"US"}', 'synthetic', now() - interval '2 days', now() + interval '30 days');
    INSERT INTO public.assessment (candidate_id, workspace_id, scene_fit, entity_fit, audience_evidence, content_scale_fit, category_experience, decision, reason, brief_version)
    VALUES (v_c06, v_demo_ws, 'no', 'unknown', 'unknown', 'unknown', 'no', 'paused', '【演示】内容为美食烘焙场景，与测量工具品类不适配', 2);

    -- demo:07 最近一次发信距今 2 天（<168h，间隔提醒）
    INSERT INTO public.contact_events (candidate_id, workspace_id, type, occurred_at, note)
    VALUES (v_c07, v_demo_ws, 'sent', now() - interval '2 days', '【演示】首封开发信（Review Invitation）');

    -- demo:08 累计 5 次有效发信 + 1 条已撤销（次数提醒 + 撤销重算）
    INSERT INTO public.contact_events (candidate_id, workspace_id, type, occurred_at, note)
    VALUES (v_c08, v_demo_ws, 'sent', now() - interval '20 days', '【演示】首触'),
           (v_c08, v_demo_ws, 'sent', now() - interval '18 days', '【演示】跟进1'),
           (v_c08, v_demo_ws, 'sent', now() - interval '15 days', '【演示】跟进2'),
           (v_c08, v_demo_ws, 'sent', now() - interval '12 days', '【演示】跟进3'),
           (v_c08, v_demo_ws, 'sent', now() - interval '9 days', '【演示】跟进4'),
           (v_c08, v_demo_ws, 'sent', now() - interval '5 days', '【演示】误记的重复邮件');
    UPDATE public.contact_events SET voided_at = now() - interval '4 days'
     WHERE workspace_id = v_demo_ws AND note = '【演示】误记的重复邮件';

    -- demo:09 停止联系，但保留历史 sent/replied 事实
    INSERT INTO public.contact_events (candidate_id, workspace_id, type, occurred_at, note)
    VALUES (v_c09, v_demo_ws, 'sent', now() - interval '35 days', '【演示】历史开发信'),
           (v_c09, v_demo_ws, 'replied', now() - interval '33 days', '【演示】对方回复：暂不考虑');

    -- demo:10 旧判断（brief_version=1 < 当前 2）→ 待复核场景 + 1 个 open 任务
    INSERT INTO public.assessment (candidate_id, workspace_id, scene_fit, entity_fit, audience_evidence, content_scale_fit, category_experience, decision, reason, open_questions, brief_version, data_version)
    VALUES (v_c10, v_demo_ws, 'unknown', 'yes', 'unknown', 'yes', 'unknown', 'needs_info', '【演示】频道较新，先核实内容方向与受众地区', '受众地区是否以美国为主？', 1, 1);
    INSERT INTO public.tasks (contact_id, type, text, due_date)
    VALUES (v_c10, 'collect_info', '【演示】核实受众地区', (now() + interval '3 days')::date::timestamptz);

    -- demo:01 / demo:02 各带 1 个 open 任务（供待办演示；demo:01 询问合作条件）
    INSERT INTO public.tasks (contact_id, type, text, due_date)
    VALUES (v_c01, 'first_contact', '【演示】询问合作条件与受众数据', (now() + interval '2 days')::date::timestamptz);
    INSERT INTO public.tasks (contact_id, type, text, due_date)
    VALUES (v_c02, 'collect_info', '【演示】补齐主体与受众资料', (now() + interval '5 days')::date::timestamptz);

    RAISE NOTICE 'demo seeds loaded: workspace %, 10 candidates', v_demo_ws;
END $$;
