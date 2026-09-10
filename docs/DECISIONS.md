# DECISIONS — 达人初筛助手 Demo

## 2026-09-09 · M0 底座验证

### D1: 采用 Atomic CRM 作为底座（主路径确认）

- **上游**: https://github.com/marmelab/atomic-crm @ `7186af6d4cf18cbc928cdf57d2390e4d67fd65c`（2026-09-08），MIT License 已核对
- **运行证据**: `make install`（npm install）→ `npx supabase start`（23 个迁移全部应用 + seed）→ `npm run dev`（Vite 5173，HTTP 200）→ UI 登录/建 3 条联系人/加任务/加备注/导出 CSV/整栈重启持久化，全部通过（截图见 `evidence/M0/`）
- **M0 五问回答**:
  1. 原版可启动 ✅（本地 Supabase + 前端；重启数据不丢——容器级重建 + 数据卷恢复后记录完整）
  2. 原生联系人可承载频道 ✅（迁移 `20260909120000` 新增 4 列，未动主数据层，未伪造邮箱/公司）
  3. 任务/导出可复用 ✅（原生 tasks 表 + 列表 Export 按钮产出含 3 候选的 CSV；频控语义改造点已识别）
  4. 示例/真实隔离方案 ✅（原生按 sales_id 隔离；M1 用 workspace 概念实现，数据访问层执行）
  5. 服务端 API 可接 ✅（`supabase/functions/` Deno Edge Functions 为现成服务端扩展点，Key 可放服务端环境）

### D2: 迁移与改造路径（T02 验证结论）

- 迁移 `20260909120000_candidate_screening_fields.sql`: contacts 加 `channel_input / channel_id / screening_decision / screening_reason`，channel_id 非空唯一索引，存量回填 unassessed
- 迁移 `20260909120001_recreate_contacts_summary.sql`: **加列后必须重建视图**——`contacts_summary` 视图列集在创建时固定，`co.*` 不自动含新列（本仓库惯例：20240807082449 同款操作）。此坑已验证并修复（列表不显示 → 重建视图 → 通过）
- UI 改造点: `types.ts`（Contact 类型）+ `ContactInputs.tsx`（4 个输入：channel_input/channel_id/decision 选择器/reason）+ `ContactListContent.tsx`（行内展示 channel_id · decision）
- React 表单为 react-admin + shadcn：SelectInput 是 Radix 组件（非原生 select），自动化测试需用 role=combobox/option 交互

### D3: 环境注意事项（不阻塞开发，但影响操作习惯）

- 本机 Docker 走系统代理（127.0.0.1:7890），大镜像拉取易 TLS 中断。解决方案：小文件走代理，**大镜像用 crane 直连拉取**（public.ecr.aws / ghcr.io 直连可达且快 4 倍），`crane pull --format=tarball` + `docker load`
- 强杀 Docker Desktop（pkill）会连带移除运行中的 supabase 容器；数据卷 + stop 备份可恢复（本次已实证）。操作 Docker 前先正常退出 supabase 栈
- 本机 Node v26.7（仓库要求 22 LTS）：实测 npm install / vite dev / supabase CLI 均正常，无 engines 强制

### D4: M1 待决事项（进入 M1 前定）

1. workspace 隔离机制：双 sales 身份 vs 新 workspace 表 + RLS 策略（影响全部业务表的查询作用域）→ 已定：workspace 表 + 应用层作用域（迁移 20260909140000），RLS 加固属 P2
2. channel_id 唯一约束从全局升级为 workspace 级（部分唯一索引改造）→ 已定：contacts_workspace_channel_uniq
3. assessment 版本追加表 + 「单 open 任务」部分唯一索引（M1 数据迁移一并做）→ 已定：均落地
4. contacts_summary 视图如再加列，记得同步重建（迁移文件内成对出现）→ 已执行两次（120001、140200）

## 2026-09-10 · M1 T13/T14 语义决策

### D5: 草稿、版本去重与任务语义

- **草稿持久化在 contacts.assessment_draft（jsonb 单列）**而非独立表：单人本地 Demo 只需「每候选一份编辑中草稿」，提交成功由 save_assessment 清除；不触碰 screening_decision，不进入可行动名单。独立草稿历史表无需求支撑
- **评估版本去重判定放服务端（RPC 内逐字段 IS NOT DISTINCT FROM）**：前端禁用按钮挡不住并发与重试；「确认仍适用」走 p_force_version=true 显式追加。注意 plpgsql 组合类型 `v_latest IS NOT NULL` 语义是"全字段非空"（evidence 可空导致恒假），存在性判断必须用 `v_latest.id IS NOT NULL`
- **任务语义修正**（相对 140000 版行为）：未提供新任务时保留原 open 任务（否则「确认仍适用」必然失败或误取消任务）；暂缓才取消 open 任务（PRD F3：暂缓联动）；提供新任务时 type+due 与现有 open 任务相同则不动（避免重复保存 churn 任务历史）
- **needs_info/priority_contact 的任务校验放宽为「表单新任务 或 已有 open 任务」二选一**：侧栏已有「下一步任务」展示区，用户对已有任务候选无需被迫重复填写
- **侧栏切换守卫实现**：父级持 SidebarHandle（isDirty/saveDraftNow），CandidateDetailSidebar 加 key={selected.id} 强制按候选重建表单（防串数据）；ref 必须用 useImperativeHandle 托管——直接给 ref.current 赋值在组件卸载后残留，导致守卫读取已卸载组件的脏状态误弹（E2E 发现）
- **时区**：待办分组按 Asia/Shanghai 自然日（workbenchApi.dateInTz，Intl 实现）；提醒阈值 168h 恰好不触发、第 5 次恰好触发，单测以注入时钟锁定边界
- **verify-t13-t14.mjs 是可重复执行的验证脚本**（非 e2e/ 下的 test runner 用例，那套 fixtures 会清库不能用于含真实 M0 数据的库）：断言 18 项，含 DB 直查（版本去重计数）；运行前需重置种子并把 demo:10 任务改为昨日以构造逾期
