# STATUS

当前基线：atomic-crm @ 8389aaaddda4c766a0e4dc8162cf8d98dcdc55b3（MIT）；PRD·达人初筛助手 Demo v1.0（2026-09-09 交接修订版）；开发计划 v2026-09-09
当前里程碑：M0 完成；M1-T11/T12/T13/T14 完成，待 T15（系统化重启回归）
日期：2026-09-10（M1-T13/T14 更新）

## 已完成（M0）

- T00：环境核验（Docker Desktop 启动、Node v26.7 实测兼容、make/git）；仓库克隆至 `~/dev/creator-screening-demo`，锁定 commit 7186af6，LICENSE 核对（MIT）
- T01：原版运行验证——`npm run dev`（Vite 5173）+ `npx supabase start`（23 迁移 + seed）；UI 登录（m0test@example.com，本地注册）→ 创建 3 条联系人（M0-Alpha/Beta/Gamma, id 1-3）→ Alpha 加任务（Follow-up, due+7d）与备注 → Beta 加备注 → 列表 Export 下载 CSV（654B，3 候选齐全）→ 整栈 stop/start + Docker 容器级重建后数据完整恢复（浏览器验证 + psql 直查双确认）
- T02：最小迁移 `20260909120000`（contacts + channel_input/channel_id/screening_decision/screening_reason，唯一索引，回填）与 `20260909120001`（重建 contacts_summary 视图）；UI：types.ts + ContactInputs（4 输入）+ ContactListContent（行内展示）；Playwright 验证：表单填写保存 → DB 落库 → 列表展示 ✅
- T03：数据映射完成（见 DECISIONS D1/D2 与开发计划 §3）；原生 tasks 无取消列/无单 open 约束、contactNotes 语义不符、supabase/functions 为服务端扩展点——均已记录
- T04：本文件与 DECISIONS.md

## 验证证据（M0）

- `evidence/M0/01-initial.png ~ 16-list-with-channel-fields.png`（登录/建记录/表单/任务/导出/重启/新字段全流程截图）
- `evidence/M0/contacts-export-T01.csv`（原版导出能力实证）
- DB 直查：auth.users 1 行、contacts 3 行且新字段值正确（迁移后 + 保存后两次验证）

## M1 已完成（T11/T12，2026-09-09）

- 前置迁移 `20260909140000`：workspace 表（real/demo 双空间）、contacts.workspace_id 归属、频道唯一性升级为空间级、assessment/contact_events/api_cache 三表、tasks 取消列 + 单 open 部分唯一索引、save_assessment RPC（校验+版本追加+任务替换事务）
- 修复迁移 `20260909140100`：save_assessment 同步 contacts.screening_decision（列表徽章数据源），由 T12 验证发现的缺陷
- T11 种子：`demo-data/synthetic-candidates.sql`（幂等），10 位合成候选覆盖 §7.2 全部场景（demo:01-10），channel_id 使用 demo: 前缀
- T12 UI：`candidates/WorkbenchPage.tsx`（工作台列表/工具栏/任务背景设置面板/模式切换/空态入口）+ `CandidateDetailSidebar.tsx`（资料区/五项检查/判断卡/联系时间线/待复核与确认仍适用）+ 路由与导航注册
- 验证（Playwright + 证据截图 evidence/M1/）：demo 模式 10 种子可见、侧栏资料与视频、五项检查保存 priority_contact+first_contact 任务成功、刷新持久化、真实/示例切换无串数据（真实空间 M0 记录完好）、demo:10 待复核徽章+确认仍适用、demo:09 停止联系徽章+历史保留

## M1 已完成（T13/T14 + T12 验收缺陷修复，2026-09-10）

- 迁移 `20260909140200_t13_draft_review_complete.sql`：
  - contacts.assessment_draft jsonb 草稿列（草稿与已提交评估分离；提交成功由 RPC 清除；不触碰 screening_decision、不进入可行动名单）
  - save_assessment v3：①内容与最新版本完全一致且非显式复核时不追加版本（PRD F3 去重）②任务语义修正——未提供新任务时保留原 open 任务（修复「确认仍适用」误报缺任务缺陷）、暂缓才取消 open 任务、提供新任务且 type+due 与现有一致时不 churn ③提交成功清草稿并同步 decision ④新增 p_force_version（显式复核追加版本）
  - complete_task RPC：完成任务 + 可选下一步同事务；任务不属于该候选或已关闭时幂等返回（双击/重试安全）
  - contacts_summary 重建（加列必须重建视图）并恢复 security_invoker=on（修复 M0 重建时的漂移）
- T13 UI：侧栏草稿恢复横幅+「保存草稿/放弃草稿」按钮；提交校验改为「表单新任务或已有 open 任务二选一」；服务失败保留输入（A19）
- T14 UI：待办视图（逾期/今天/之后三组，组内 due+id 排序，今天不算逾期，时区 dateInTz Asia/Shanghai）；完成任务对话框（可选新动作+日期+说明）；行内 ⏰提醒徽章 + 侧栏提醒横幅（5 次/168h 两条规则，恰好 168h 不触发）；提醒开关（设置面板 Checkbox，localStorage 持久化，关闭仅影响展示）
- T12 验收缺陷修复：①decision 不同步（140100 已修，本轮回归）②侧栏切换串数据（根因：侧栏无 key 且父级 ref 句柄在卸载后残留——isDirty() 读已卸载组件状态导致守卫误弹；修复：CandidateDetailSidebar 加 key={selected.id} + useImperativeHandle 托管 ref 生命周期）③typecheck 两处错误（WorkbenchPage 缺 TaskType 导入、workspace 可空传给行组件；fakerest contacts 生成器缺新字段——既有错误一并修复）
- 单元测试：`workbenchApi.test.ts` 10 用例（时区换算/恰好168h与4次5次边界/撤销排除/补录重算/三组分组跨午夜/完成与取消任务排除/组内排序），时钟注入 vi.setSystemTime
- 端到端验证：`scripts/verify-t13-t14.mjs`（可重复执行）**18/18 通过**——登录、demo 种子、待办三组（含昨日逾期红色标注）、保存优先联系+徽章同步、未保存守卫三选、草稿刷新持久化、确认仍适用（不再误报）、完成任务后待办移除、提醒徽章/横幅/开关、保存失败保留输入、真实空间隔离（M0-Alpha 在、演示 0 串）、内容不变重复保存版本数不变（DB 直查）

## 验证证据（T13/T14）

- `evidence/M1/t14-01 ~ t14-11`（工作台/待办分组/优先联系/守卫/草稿恢复/确认复核/完成任务/提醒横幅/提醒关闭/失败保留输入/真实隔离）
- 全量检查：`npm run typecheck` ✅ `npm run lint` ✅ `vitest --project app` 167 passed ✅

## 未完成 / 阻塞

- M1 剩余：T15（系统化重启回归：刷新页面/重启服务/容器重建后数据仍在）
- M2 真实接入需要 YouTube API Key（待用户配置）
- 增强表格对照、访谈、计时（M5）未开始
- 已知限制： remind 时间线只读（记录/撤销按钮按计划在 M3）；due_date 分组使用浏览器本地时区（与 Asia/Shanghai 一致的环境下正确，见 workbenchApi.BUSINESS_TZ）

## 决定

- 见 DECISIONS.md（D1 采用 Atomic；D2 迁移与视图重建惯例；D3 环境注意事项；D4 M1 待决；D5 T13/T14 语义决策）

## 下一步

- M1-T15：系统化重启回归（页面刷新、dev 重启、supabase stop/start、容器重建四档），复跑 verify-t13-t14.mjs 前后对比
- M2-T20/T21：导入预检与服务端 Key 状态（Key 就绪后）
