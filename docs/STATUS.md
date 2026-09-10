# STATUS

当前基线：atomic-crm @ 404e3c160ed85ea4d317c39ae40ceaf87ec92fd6（MIT）；PRD·达人初筛助手 Demo v1.0（2026-09-09 交接修订版）；开发计划 v2026-09-09
当前里程碑：M0 完成；M1 全部完成（含 T15 回归）；M2 最小接入完成（导入/资料获取/导出，真实 Key 验收仍 blocked）
日期：2026-09-10（M2 最小接入 + T15 更新）

## 已完成（M0 + M1）

- M0：底座验证、频道字段迁移+视图重建、数据映射、文档（详见 git 历史 7186af6..8389aaa）
- M1-T11/T12：workspace 双空间、assessment/contact_events/api_cache、save_assessment RPC、工作台+详情侧栏、10 条合成种子
- M1-T13/T14：草稿持久化、评估版本服务端去重、任务语义修正（保留/替换/暂缓取消）、complete_task RPC、待办三组视图（Asia/Shanghai）、完成任务对话框、未保存守卫、提醒（5 次/168h）+ 开关、T12 三缺陷修复
- M1-T15（2026-09-10）：系统化重启回归——数据指纹（contacts/assessment/导入/M0 计数）在 `supabase stop` + `start` 前后完全一致；重启后复跑 verify-t13-t14.mjs **18/18**、verify-m2.mjs **8/8**。页面刷新已在两脚本内覆盖；dev server 无状态（数据全在 DB）；容器级重建按 D3 风险约定跳过（stop/start 已验证同一 volume 持久化路径）

## M2 最小接入已完成（2026-09-10，个人可用范围）

- 迁移 `20260910110000`：contacts.data_version（外部资料版本）+ contacts_summary 第三次重建（保持 security_invoker）
- **导入（F1 最小版）**：`normalizeChannelInput` 归一化（UC ID 大小写敏感 / @handle / www·m 域名+末尾斜杠+查询参数；视频/短链//c//user/ 明确报不支持）；`parseImportText` 逐行预检（新增/已存在/本批重复/无效 互斥计数）；20 行/1MB 上限；模板下载；确认导入直接建候选（未配 Key 时身份未核实，列表显示「未核实」状态）
- **资料获取（F2 最小版）**：Edge Function `youtube-fetch`（Key 只读服务端环境；channels.list→playlistItems(≤10)→videos.list→写 api_cache（30 天）→递增 data_version→旧判断待复核）；`TESTKEY` 受控测试 provider 返回固定夹具（0 值/缺失/隐藏订阅数三种形态），不耗真实配额；demo: 前缀拒绝请求；失败保留旧资料并提示原因（mapper 把 keyInvalid/quota/权限/404/5xx 分译成可读文案）；UI 侧栏「更新资料」按钮 + 状态（未核实/待获取/已获取/部分缺失/待更新）
- **导出（F5 最小版）**：17 字段固定列；两范围（可行动名单=§4.3 条件 / 当前筛选结果）+ 数量预览 + 零条提示；UTF-8 BOM；引号/逗号/换行转义；=+-@ 前缀公式防护；demo 空间文件名加 DEMO、行 data_mode=synthetic
- 测试：workbenchApi.test.ts 增至 18 用例（归一化边界/导入互斥计数/导出 BOM+转义+公式防护+模式标记+可行动过滤）；youtube-fetch/mapper.test.ts 5 用例
- 端到端：`scripts/verify-m2.mjs` **8/8**（导入预检计数、重复导入不覆盖不重复建档、TESTKEY 获取、0 与缺失分显、demo 拒绝、真实空间 CSV BOM+表头+real 标记、demo DEMO 文件名+synthetic）
- 验收定位：**演示版可用 + 本地个人可用闭环**（手动/粘贴导入 → TESTKEY 或真实 Key 获取资料 → 人工判断 → 导出）。真实 YouTube Key 的 A02–A07 验收仍 blocked（待用户配置 Key）

## 验证证据

- `evidence/M0/`（M0 全流程）、`evidence/M1/`（T12 8 张 + t14-01~11）、`evidence/M2/`（m2-01~05 截图 + export-sample.csv + export-demo.csv）
- 全量检查（最终态）：typecheck ✅ lint ✅ vitest app 175 passed ✅ functions 113 passed ✅

## 未完成 / 阻塞

- 真实 Key 配置后的 A02–A07（10 真实频道、混合输入、部分失败恢复）——需用户在 `supabase/functions/.env` 设置真实 `YOUTUBE_API_KEY`（该文件已 gitignore）
- M3 剩余：联系事件记录/撤销 UI（数据层与提醒已就绪）、停止联系设置入口（demo:09 有种子）
- source_note 独立列未建（导出该列为空，PRD 允许留空）
- 已知限制：导入的身份未经官方接口核实（未配 Key）；Edge Function 本地 serve 需独立进程（`npx supabase functions serve --env-file supabase/functions/.env`）

## 决定

- 见 DECISIONS.md（D1–D5 不变；D6 最小接入范围）

## 下一步

- 用户配置真实 YouTube Key → 冒烟 A02/A06/A07 → 把 M2 验收从 blocked 转 passed
- 或按需启动 M3（联系记录 UI + 停止联系入口 + 导出增强）
