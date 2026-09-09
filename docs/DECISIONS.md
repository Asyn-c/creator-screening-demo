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

1. workspace 隔离机制：双 sales 身份 vs 新 workspace 表 + RLS 策略（影响全部业务表的查询作用域）
2. channel_id 唯一约束从全局升级为 workspace 级（部分唯一索引改造）
3. assessment 版本追加表 + 「单 open 任务」部分唯一索引（M1 数据迁移一并做）
4. contacts_summary 视图如再加列，记得同步重建（迁移文件内成对出现）
