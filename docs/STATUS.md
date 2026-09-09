# STATUS

当前基线：atomic-crm @ 7186af6d4cf18cbc928cdf57d2390e4d67fd65c（MIT）；PRD·达人初筛助手 Demo v1.0（2026-09-09 交接修订版）；开发计划 v2026-09-09
当前里程碑：M0 完成；M1-T11/T12 完成，待 T13/T14/T15
日期：2026-09-09（M1 部分更新）

## 已完成（M0）

- T00：环境核验（Docker Desktop 启动、Node v26.7 实测兼容、make/git）；仓库克隆至 `~/dev/creator-screening-demo`，锁定 commit 7186af6，LICENSE 核对（MIT）
- T01：原版运行验证——`npm run dev`（Vite 5173）+ `npx supabase start`（23 迁移 + seed）；UI 登录（m0test@example.com，本地注册）→ 创建 3 条联系人（M0-Alpha/Beta/Gamma, id 1-3）→ Alpha 加任务（Follow-up, due+7d）与备注 → Beta 加备注 → 列表 Export 下载 CSV（654B，3 候选齐全）→ 整栈 stop/start + Docker 容器级重建后数据完整恢复（浏览器验证 + psql 直查双确认）
- T02：最小迁移 `20260909120000`（contacts + channel_input/channel_id/screening_decision/screening_reason，唯一索引，回填）与 `20260909120001`（重建 contacts_summary 视图）；UI：types.ts + ContactInputs（4 输入）+ ContactListContent（行内展示）；Playwright 验证：表单填写保存 → DB 落库 → 列表展示 ✅
- T03：数据映射完成（见 DECISIONS D1/D2 与开发计划 §3）；原生 tasks 无取消列/无单 open 约束、contactNotes 语义不符、supabase/functions 为服务端扩展点——均已记录
- T04：本文件与 DECISIONS.md

## 验证证据

- `evidence/M0/01-initial.png ~ 16-list-with-channel-fields.png`（登录/建记录/表单/任务/导出/重启/新字段全流程截图）
- `evidence/M0/contacts-export-T01.csv`（原版导出能力实证）
- DB 直查：auth.users 1 行、contacts 3 行且新字段值正确（迁移后 + 保存后两次验证）

## M1 已完成（T11/T12，2026-09-09）

- 前置迁移 `20260909140000`：workspace 表（real/demo 双空间）、contacts.workspace_id 归属、频道唯一性升级为空间级、assessment/contact_events/api_cache 三表、tasks 取消列 + 单 open 部分唯一索引、save_assessment RPC（校验+版本追加+任务替换事务）
- 修复迁移 `20260909140100`：save_assessment 同步 contacts.screening_decision（列表徽章数据源），由 T12 验证发现的缺陷
- T11 种子：`demo-data/synthetic-candidates.sql`（幂等），10 位合成候选覆盖 §7.2 全部场景（demo:01-10），channel_id 使用 demo: 前缀
- T12 UI：`candidates/WorkbenchPage.tsx`（工作台列表/工具栏/任务背景设置面板/模式切换/空态入口）+ `CandidateDetailSidebar.tsx`（资料区/五项检查/判断卡/联系时间线/待复核与确认仍适用）+ 路由与导航注册
- 验证（Playwright + 证据截图 evidence/M1/）：demo 模式 10 种子可见、侧栏资料与视频、五项检查保存 priority_contact+first_contact 任务成功、刷新持久化、真实/示例切换无串数据（真实空间 M0 记录完好）、demo:10 待复核徽章+确认仍适用、demo:09 停止联系徽章+历史保留

## 未完成 / 阻塞

- M1 剩余：T13 残余（草稿持久化、未保存切换提示）、T14（今日/逾期/之后分组、提醒逻辑 UI）、T15（系统化重启回归）
- M2 真实接入需要 YouTube API Key（待用户配置）
- 增强表格对照、访谈、计时（M5）未开始

## 决定

- 见 DECISIONS.md（D1 采用 Atomic；D2 迁移与视图重建惯例；D3 环境注意事项；D4 M1 待决）

## 下一步

- M1-T10：领域类型与 workspace 作用域迁移（含 D4-1/2/3 三个待决项落地）
- M1-T11：独立真实空间 + 10 条合成种子（demo:01–demo:10，规格见开发计划 §7.2）
